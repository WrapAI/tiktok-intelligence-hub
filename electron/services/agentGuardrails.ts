import { createHash } from "node:crypto";
import type { JsonStore } from "../db.js";

export type AgentCallKind = "managed_agent" | "direct_api" | "memory_sync";

export type AgentCallLogEntry = {
  at: string;
  kind: AgentCallKind;
  task?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  payloadHash?: string;
};

export type AgentBudgetStatus = {
  circuitBreakerActive: boolean;
  circuitBreakerUntil: string | null;
  circuitBreakerReason: string | null;
  managedAgent: { hour: number; hourLimit: number; day: number; dayLimit: number };
  directApi: { hour: number; hourLimit: number; day: number; dayLimit: number };
  memorySync: { hour: number; hourLimit: number; day: number; dayLimit: number };
  spendTodayUsd: number;
  spendDayLimitUsd: number;
};

/** Hard limits — tuned for solo creator usage; blocks runaway loops like 30×250k-token calls. */
export const AGENT_GUARDRAILS = {
  managedAgentCallsPerHour: 6,
  managedAgentCallsPerDay: 12,
  directApiCallsPerHour: 12,
  directApiCallsPerDay: 40,
  memorySyncPerHour: 2,
  memorySyncPerDay: 8,
  maxDailySpendUsd: 2.5,
  /** Normal script/plan calls ≈ 18–25k input. Anything above = bug or session bloat. */
  circuitBreakerInputTokens: 30_000,
  circuitBreakerLockMs: 24 * 60 * 60_000,
  burstWindowMs: 2 * 60_000,
  burstCallLimit: 3,
  burstLockMs: 60 * 60_000,
  duplicateWindowMs: 10 * 60_000,
  maxPayloadChars: 28_000,
  /** Direct API script/plan calls — tighter than managed agent memory bloat. */
  maxDirectPayloadChars: 36_000,
} as const;

export class AgentGuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentGuardrailError";
  }
}

function readLog(store: JsonStore): AgentCallLogEntry[] {
  try {
    const raw = store.getSetting("agentGuardrailLog", "[]");
    const parsed = JSON.parse(raw) as AgentCallLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLog(store: JsonStore, entries: AgentCallLogEntry[]) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
  const pruned = entries.filter((e) => new Date(e.at).getTime() >= cutoff).slice(-500);
  store.setSetting("agentGuardrailLog", JSON.stringify(pruned));
}

function countSince(entries: AgentCallLogEntry[], kind: AgentCallKind, sinceMs: number): number {
  const since = Date.now() - sinceMs;
  return entries.filter((e) => e.kind === kind && new Date(e.at).getTime() >= since).length;
}

function spendSince(entries: AgentCallLogEntry[], sinceMs: number): number {
  const since = Date.now() - sinceMs;
  return entries
    .filter((e) => new Date(e.at).getTime() >= since)
    .reduce((sum, e) => sum + (e.costUsd || 0), 0);
}

function circuitBreakerUntil(store: JsonStore): number {
  const raw = store.getSetting("agentCircuitBreakerUntil", "");
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function tripCircuitBreaker(store: JsonStore, reason: string, lockMs = AGENT_GUARDRAILS.circuitBreakerLockMs) {
  const until = new Date(Date.now() + lockMs).toISOString();
  store.setSetting("agentCircuitBreakerUntil", until);
  store.setSetting("agentCircuitBreakerReason", reason);
  store.appendLog("agent_guardrail", "error", `Circuit breaker: ${reason} (locked until ${until})`);
}

export function hashAgentPayload(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function getAgentBudgetStatus(store: JsonStore): AgentBudgetStatus {
  const log = readLog(store);
  const until = circuitBreakerUntil(store);
  const active = until > Date.now();

  return {
    circuitBreakerActive: active,
    circuitBreakerUntil: active ? new Date(until).toISOString() : null,
    circuitBreakerReason: active ? store.getSetting("agentCircuitBreakerReason", "") || null : null,
    managedAgent: {
      hour: countSince(log, "managed_agent", 60 * 60_000),
      hourLimit: AGENT_GUARDRAILS.managedAgentCallsPerHour,
      day: countSince(log, "managed_agent", 24 * 60 * 60_000),
      dayLimit: AGENT_GUARDRAILS.managedAgentCallsPerDay,
    },
    directApi: {
      hour: countSince(log, "direct_api", 60 * 60_000),
      hourLimit: AGENT_GUARDRAILS.directApiCallsPerHour,
      day: countSince(log, "direct_api", 24 * 60 * 60_000),
      dayLimit: AGENT_GUARDRAILS.directApiCallsPerDay,
    },
    memorySync: {
      hour: countSince(log, "memory_sync", 60 * 60_000),
      hourLimit: AGENT_GUARDRAILS.memorySyncPerHour,
      day: countSince(log, "memory_sync", 24 * 60 * 60_000),
      dayLimit: AGENT_GUARDRAILS.memorySyncPerDay,
    },
    spendTodayUsd: spendSince(log, 24 * 60 * 60_000),
    spendDayLimitUsd: AGENT_GUARDRAILS.maxDailySpendUsd,
  };
}

export function resetAgentGuardrails(store: JsonStore) {
  store.setSetting("agentCircuitBreakerUntil", "");
  store.setSetting("agentCircuitBreakerReason", "");
  store.appendLog("agent_guardrail", "ok", "Agent guardrails reset by user");
}

export function assertAgentCallAllowed(
  store: JsonStore,
  kind: AgentCallKind,
  options: {
    task?: string;
    payloadHash?: string;
    payloadChars?: number;
    skipDuplicateCheck?: boolean;
    skipMemorySyncLimit?: boolean;
    skipDirectApiLimit?: boolean;
    skipDailySpendCap?: boolean;
  } = {}
) {
  const until = circuitBreakerUntil(store);
  if (until > Date.now()) {
    const reason = store.getSetting("agentCircuitBreakerReason", "Rate limit protection");
    throw new AgentGuardrailError(
      `Claude API locked until ${new Date(until).toLocaleString()} — ${reason}. Open Settings → Agent budget → Reset protection to continue.`
    );
  }

  const maxChars =
    kind === "direct_api"
      ? AGENT_GUARDRAILS.maxDirectPayloadChars
      : AGENT_GUARDRAILS.maxPayloadChars;

  if (options.payloadChars && options.payloadChars > maxChars) {
    throw new AgentGuardrailError(
      `Request too large (${options.payloadChars} chars). Max ${maxChars} — trim library context or shorten additional notes.`
    );
  }

  const log = readLog(store);
  const status = getAgentBudgetStatus(store);

  if (kind === "managed_agent") {
    if (status.managedAgent.hour >= AGENT_GUARDRAILS.managedAgentCallsPerHour) {
      throw new AgentGuardrailError(
        `Hourly agent limit reached (${AGENT_GUARDRAILS.managedAgentCallsPerHour}/hour). Wait before generating another script or plan.`
      );
    }
    if (status.managedAgent.day >= AGENT_GUARDRAILS.managedAgentCallsPerDay) {
      throw new AgentGuardrailError(
        `Daily agent limit reached (${AGENT_GUARDRAILS.managedAgentCallsPerDay}/day). Try again tomorrow or reset in Settings.`
      );
    }
    const recentManaged = log.filter(
      (e) => e.kind === "managed_agent" && Date.now() - new Date(e.at).getTime() < AGENT_GUARDRAILS.burstWindowMs
    );
    if (recentManaged.length >= AGENT_GUARDRAILS.burstCallLimit) {
      tripCircuitBreaker(
        store,
        `${AGENT_GUARDRAILS.burstCallLimit} agent calls within 2 minutes — possible runaway loop`,
        AGENT_GUARDRAILS.burstLockMs
      );
      throw new AgentGuardrailError("Too many agent calls in quick succession — locked for 1 hour to protect your budget.");
    }
  }

  if (kind === "direct_api" && !options.skipDirectApiLimit) {
    if (status.directApi.hour >= AGENT_GUARDRAILS.directApiCallsPerHour) {
      throw new AgentGuardrailError(`Hourly direct API limit reached (${AGENT_GUARDRAILS.directApiCallsPerHour}/hour).`);
    }
    if (status.directApi.day >= AGENT_GUARDRAILS.directApiCallsPerDay) {
      throw new AgentGuardrailError(`Daily direct API limit reached (${AGENT_GUARDRAILS.directApiCallsPerDay}/day).`);
    }
  }

  const skipSpendCap =
    options.skipDailySpendCap ||
    (kind === "direct_api" && options.skipDirectApiLimit);
  if (kind === "memory_sync" && !options.skipMemorySyncLimit) {
    if (status.memorySync.hour >= AGENT_GUARDRAILS.memorySyncPerHour) {
      throw new AgentGuardrailError(`Memory sync limit reached (${AGENT_GUARDRAILS.memorySyncPerHour}/hour).`);
    }
    if (status.memorySync.day >= AGENT_GUARDRAILS.memorySyncPerDay) {
      throw new AgentGuardrailError(`Daily memory sync limit reached (${AGENT_GUARDRAILS.memorySyncPerDay}/day).`);
    }
  }

  if (!skipSpendCap && status.spendTodayUsd >= AGENT_GUARDRAILS.maxDailySpendUsd) {
    throw new AgentGuardrailError(
      `Daily spend cap reached (~$${AGENT_GUARDRAILS.maxDailySpendUsd}). Reset in Settings if intentional.`
    );
  }

  if (options.payloadHash && !options.skipDuplicateCheck) {
    const dup = log.find(
      (e) =>
        e.payloadHash === options.payloadHash &&
        e.kind === kind &&
        Date.now() - new Date(e.at).getTime() < AGENT_GUARDRAILS.duplicateWindowMs
    );
    if (dup) {
      throw new AgentGuardrailError(
        "Duplicate agent request blocked — same task was sent recently. This prevents runaway loops."
      );
    }
  }
}

export function recordAgentCall(store: JsonStore, entry: AgentCallLogEntry) {
  const log = readLog(store);
  log.push(entry);
  writeLog(store, log);
}

/** Remove the most recent matching call — e.g. validator rejected the output so it should not count toward limits. */
export function revokeLastAgentCall(
  store: JsonStore,
  kind: AgentCallKind,
  task?: string
): boolean {
  const log = readLog(store);
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.kind !== kind) continue;
    if (task && entry.task !== task) continue;
    log.splice(i, 1);
    writeLog(store, log);
    return true;
  }
  return false;
}

/** Undo both generate + validation-retry calls when output is rejected — frees duplicate hash and hourly budget. */
export function revokeScriptGenerationCalls(store: JsonStore): void {
  revokeLastAgentCall(store, "direct_api", "generate_script_retry");
  revokeLastAgentCall(store, "direct_api", "generate_script");
}

export function checkPostCallAnomaly(store: JsonStore, inputTokens: number, kind: AgentCallKind, task?: string) {
  if (kind !== "managed_agent") return;
  if (inputTokens <= AGENT_GUARDRAILS.circuitBreakerInputTokens) return;

  tripCircuitBreaker(
    store,
    `Abnormal ${kind} call${task ? ` (${task})` : ""}: ${inputTokens.toLocaleString()} input tokens (max ${AGENT_GUARDRAILS.circuitBreakerInputTokens.toLocaleString()})`
  );
}
