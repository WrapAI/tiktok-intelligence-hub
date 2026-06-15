import Anthropic from "@anthropic-ai/sdk";
import type { JsonStore } from "../db.js";
import { buildHubMemoryDocuments } from "./hubContextSnapshot.js";
import {
  calculateUsageCost,
  diffUsage,
  normalizeSessionUsage,
  type AgentCostBreakdown,
} from "./agentPricing.js";
import { hasParseableJson, hasParseablePlanJson } from "./agentJson.js";
import {
  clearAgentSessionStatus,
  emitAgentSessionStatus,
  type AgentSessionPhase,
} from "./agentSessionStatus.js";

const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01" as const;

export const DEFAULT_AGENT_ID = "agent_01NxQdQvuQLXgJgMgXbQ1LNz";
export const DEFAULT_ENVIRONMENT_ID = "env_0139W3beYzg2rMpMX18KQ69M";
export const DEFAULT_MEMORY_STORE_ID = "memstore_01Vp97M6cAtSRivSiWnGsL67";
export const DEFAULT_SESSION_ID = "sesn_01PHBz1sPSVVM61oH2yzNQi9";

export type AgentConfig = {
  agentId: string;
  environmentId: string;
  memoryStoreId: string;
  sessionId: string;
};

export type AgentMessage = {
  role: "user" | "assistant";
  text: string;
  at: string;
  cost?: AgentCostBreakdown;
};

export type AgentCallResult = {
  sessionId: string;
  reply: string;
  cost: AgentCostBreakdown;
};

function getConfig(store: JsonStore): AgentConfig {
  return {
    agentId: store.getSetting("tiktokAgentId", DEFAULT_AGENT_ID),
    environmentId: store.getSetting("tiktokAgentEnvironmentId", DEFAULT_ENVIRONMENT_ID),
    memoryStoreId: store.getSetting("tiktokAgentMemoryStoreId", DEFAULT_MEMORY_STORE_ID),
    sessionId: store.getSetting("tiktokAgentSessionId", DEFAULT_SESSION_ID),
  };
}

/** Fill empty agent settings on first run or after upgrade. */
export function seedAgentDefaults(store: JsonStore) {
  if (!store.getSetting("tiktokAgentId")) store.setSetting("tiktokAgentId", DEFAULT_AGENT_ID);
  if (!store.getSetting("tiktokAgentEnvironmentId")) {
    store.setSetting("tiktokAgentEnvironmentId", DEFAULT_ENVIRONMENT_ID);
  }
  if (!store.getSetting("tiktokAgentMemoryStoreId")) {
    store.setSetting("tiktokAgentMemoryStoreId", DEFAULT_MEMORY_STORE_ID);
  }
  if (!store.getSetting("tiktokAgentSessionId")) {
    store.setSetting("tiktokAgentSessionId", DEFAULT_SESSION_ID);
  }
}

function requireApiKey(store: JsonStore): string {
  const apiKey = store.getSetting("anthropicApiKey");
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings first.");
  return apiKey;
}

function createClient(apiKey: string) {
  return new Anthropic({ apiKey });
}

function extractAgentText(event: { type?: string; content?: Array<{ type?: string; text?: string }> }): string {
  if (event.type !== "agent.message" || !event.content?.length) return "";
  return event.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n")
    .trim();
}

export function getAgentStatus(store: JsonStore) {
  const config = getConfig(store);
  return {
    configured: Boolean(config.agentId && config.environmentId),
    memoryConfigured: Boolean(config.memoryStoreId),
    agentId: config.agentId,
    environmentId: config.environmentId,
    memoryStoreId: config.memoryStoreId,
    sessionId: config.sessionId || null,
    hasApiKey: Boolean(store.getSetting("anthropicApiKey")),
  };
}

export async function createAgentSession(store: JsonStore, forceNew = false) {
  const apiKey = requireApiKey(store);
  const config = getConfig(store);

  if (!config.agentId) throw new Error("Set your TikTok Agent ID in Settings.");
  if (!config.environmentId) throw new Error("Set your Agent environment ID in Settings.");

  if (config.sessionId && !forceNew) {
    try {
      const client = createClient(apiKey);
      const existing = await client.beta.sessions.retrieve(config.sessionId, {
        betas: [MANAGED_AGENTS_BETA],
      });
      if (existing.status !== "terminated") {
        return { sessionId: existing.id, status: existing.status, reused: true };
      }
    } catch {
      // create fresh session below
    }
  }

  const client = createClient(apiKey);
  const resources = config.memoryStoreId
    ? [
        {
          type: "memory_store" as const,
          memory_store_id: config.memoryStoreId,
          access: "read_write" as const,
          instructions:
            "TikTok Intelligence Hub context lives under /hub/*.md. Read these before planning scripts, daily posts, or product strategy. They mirror the creator's local database.",
        },
      ]
    : undefined;

  const session = await client.beta.sessions.create({
    agent: config.agentId,
    environment_id: config.environmentId,
    title: "TikTok Intelligence Hub",
    resources,
    betas: [MANAGED_AGENTS_BETA],
  });

  store.setSetting("tiktokAgentSessionId", session.id);
  store.setSetting("tiktokAgentSessionCreatedAt", new Date().toISOString());

  return { sessionId: session.id, status: session.status, reused: false };
}

export async function syncHubContextToMemoryStore(store: JsonStore, dataDir: string, dbDir: string) {
  const apiKey = requireApiKey(store);
  const config = getConfig(store);
  if (!config.memoryStoreId) {
    throw new Error("Set your Agent memory store ID in Settings (memstore_…).");
  }

  const client = createClient(apiKey);
  const docs = buildHubMemoryDocuments(store, dataDir, dbDir);
  const existing = new Map<string, string>();

  for await (const item of client.beta.memoryStores.memories.list(config.memoryStoreId, {
    betas: [MANAGED_AGENTS_BETA],
  })) {
    if ("id" in item && item.path) existing.set(item.path, item.id);
  }

  let uploaded = 0;
  for (const doc of docs) {
    const memoryId = existing.get(doc.path);
    if (memoryId) {
      await client.beta.memoryStores.memories.update(memoryId, {
        memory_store_id: config.memoryStoreId,
        content: doc.content,
        betas: [MANAGED_AGENTS_BETA],
      });
    } else {
      await client.beta.memoryStores.memories.create(config.memoryStoreId, {
        path: doc.path,
        content: doc.content,
        betas: [MANAGED_AGENTS_BETA],
      });
    }
    uploaded += 1;
  }

  store.setSetting("tiktokAgentLastMemorySyncAt", new Date().toISOString());
  store.appendLog("agent_memory", "ok", `Synced ${uploaded} hub context files to memory store`);

  return { uploaded, paths: docs.map((d) => d.path) };
}

async function collectNewAgentReplies(
  client: Anthropic,
  sessionId: string,
  before: Set<string>
): Promise<string[]> {
  const replies: string[] = [];
  for await (const event of client.beta.sessions.events.list(sessionId, { betas: [MANAGED_AGENTS_BETA] })) {
    if (before.has(event.id)) continue;
    const text = extractAgentText(event as { type?: string; content?: Array<{ type?: string; text?: string }> });
    if (text) replies.push(text);
  }
  return replies;
}

type WaitForReplyOptions = {
  timeoutMs: number;
  waitForJson?: boolean | "plan";
  task?: string;
  sessionId: string;
};

function publishSessionStatus(
  sessionId: string,
  task: string | undefined,
  phase: AgentSessionPhase,
  message: string,
  sessionStatus?: string
) {
  emitAgentSessionStatus({
    active: phase !== "done" && phase !== "error",
    phase,
    message,
    sessionStatus,
    task,
    sessionId,
    at: new Date().toISOString(),
  });
}

function describePollStatus(
  sessionStatus: string,
  waitForJson: boolean | "plan" | undefined,
  text: string,
  replyCount: number
): { message: string; phase: AgentSessionPhase } {
  const hasJson = waitForJson
    ? waitForJson === "plan"
      ? hasParseablePlanJson(text)
      : hasParseableJson(text)
    : false;

  if (sessionStatus === "running") {
    return {
      phase: "running",
      message: waitForJson
        ? "Agent is reading hub context and drafting response…"
        : "Agent is thinking…",
    };
  }

  if (waitForJson && text && !hasJson) {
    return {
      phase: "waiting_json",
      message:
        replyCount > 1
          ? "Partial reply received — waiting for final JSON…"
          : "Session idle — waiting for structured JSON output…",
    };
  }

  if (!text) {
    return {
      phase: "running",
      message: `Session ${sessionStatus} — waiting for agent reply…`,
    };
  }

  if (hasJson) {
    return { phase: "finalizing", message: "JSON received — finalizing…" };
  }

  return { phase: "running", message: "Receiving agent reply…" };
}

/**
 * Managed agents may go idle before the final JSON message lands. Keep polling events
 * until the reply stabilises (chat) or contains parseable JSON (structured tasks).
 */
async function waitForAgentReply(
  client: Anthropic,
  sessionId: string,
  before: Set<string>,
  options: WaitForReplyOptions
): Promise<string> {
  const deadline = Date.now() + options.timeoutMs;
  const pollMs = 2000;
  const stablePollsNeeded = 2;

  let lastText = "";
  let stablePolls = 0;

  while (Date.now() < deadline) {
    const session = await client.beta.sessions.retrieve(sessionId, { betas: [MANAGED_AGENTS_BETA] });
    if (session.status === "terminated") throw new Error("Agent session terminated.");

    const replies = await collectNewAgentReplies(client, sessionId, before);
    const text = replies.join("\n\n").trim();
    const isIdle = session.status === "idle";
    const { message, phase } = describePollStatus(session.status, options.waitForJson, text, replies.length);
    publishSessionStatus(sessionId, options.task, phase, message, session.status);

    if (options.waitForJson && text && isIdle) {
      const ready =
        options.waitForJson === "plan" ? hasParseablePlanJson(text) : hasParseableJson(text);
      if (ready) return text;
    }

    if (!options.waitForJson && text === lastText && text && isIdle) {
      stablePolls++;
      if (stablePolls >= stablePollsNeeded) return text;
    } else {
      stablePolls = 0;
      lastText = text;
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (lastText) {
    if (options.waitForJson) {
      const ready =
        options.waitForJson === "plan" ? hasParseablePlanJson(lastText) : hasParseableJson(lastText);
      if (ready) return lastText;
    } else {
      return lastText;
    }
  }

  throw new Error("Agent timed out waiting for a response.");
}

async function readSessionMeta(client: Anthropic, sessionId: string) {
  const session = await client.beta.sessions.retrieve(sessionId, { betas: [MANAGED_AGENTS_BETA] });
  return {
    usage: normalizeSessionUsage(session.usage),
    modelId: session.agent?.model?.id,
    speed: session.agent?.model?.speed,
  };
}

async function deliverAgentMessage(
  store: JsonStore,
  message: string,
  options: {
    recordInChat?: boolean;
    timeoutMs?: number;
    waitForJson?: boolean | "plan";
    task?: string;
  } = {}
): Promise<AgentCallResult> {
  const apiKey = requireApiKey(store);
  const client = createClient(apiKey);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const task = options.task;

  try {
    publishSessionStatus("", task, "connecting", "Connecting to agent session…");

    const session = await createAgentSession(store);
    const sessionId = session.sessionId;
    publishSessionStatus(
      sessionId,
      task,
      "connecting",
      session.reused ? "Reusing agent session…" : "Agent session created…",
      session.status
    );

    const usageBefore = await readSessionMeta(client, sessionId);

    const before = new Set<string>();
    for await (const event of client.beta.sessions.events.list(sessionId, { betas: [MANAGED_AGENTS_BETA] })) {
      before.add(event.id);
    }

    publishSessionStatus(sessionId, task, "sending", "Sending request to agent…", session.status);

    await client.beta.sessions.events.send(sessionId, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: message }],
        },
      ],
      betas: [MANAGED_AGENTS_BETA],
    });

    publishSessionStatus(sessionId, task, "running", "Agent received request — working…", "running");

    const assistantText = await waitForAgentReply(client, sessionId, before, {
      timeoutMs,
      waitForJson: options.waitForJson,
      task,
      sessionId,
    });

    publishSessionStatus(sessionId, task, "finalizing", "Response complete — saving…", "idle");

    const usageAfter = await readSessionMeta(client, sessionId);
    const delta = diffUsage(usageBefore.usage, usageAfter.usage);
    const cost = calculateUsageCost(delta, usageAfter.modelId, usageAfter.speed, false);

    if (options.recordInChat !== false) {
      const history = readChatHistory(store);
      history.push({ role: "user", text: message, at: new Date().toISOString() });
      history.push({ role: "assistant", text: assistantText, at: new Date().toISOString(), cost });
      writeChatHistory(store, history.slice(-40));
    }

    accumulateAgentSpend(store, cost);

    publishSessionStatus(sessionId, task, "done", "Done", "idle");

    return { sessionId, reply: assistantText, cost };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    publishSessionStatus("", task, "error", msg);
    throw err;
  } finally {
    clearAgentSessionStatus(task);
  }
}

/** Internal hub tasks (scripts, auto-sync notices) — not shown in TikTok Agent chat tab. */
export async function sendAgentTask(
  store: JsonStore,
  message: string,
  options: { timeoutMs?: number; waitForJson?: boolean | "plan"; task?: string } = {}
) {
  return deliverAgentMessage(store, message, { recordInChat: false, ...options });
}

export type AgentTaskType =
  | "generate_script"
  | "generate_daily_plan"
  | "analyze_data"
  | "custom";

export async function requestAgentTask(
  store: JsonStore,
  task: AgentTaskType,
  instructions: string,
  context?: string,
  timeoutMs = 180_000
) {
  const header = `[Hub task: ${task}]
You are the TikTok Intelligence Hub managed agent. Read /hub/*.md in the attached memory store for current products, sales, library, and performance data before responding.

`;
  const body = context ? `${instructions}\n\n---\n\n${context}` : instructions;
  const waitForJson =
    task === "generate_daily_plan" ? "plan" : task === "generate_script" || task === "analyze_data" ? true : false;

  return sendAgentTask(store, header + body, { timeoutMs, waitForJson, task });
}

export async function sendAgentMessage(store: JsonStore, message: string) {
  const result = await deliverAgentMessage(store, message, { recordInChat: true, task: "agent_chat" });
  return { sessionId: result.sessionId, reply: result.reply, cost: result.cost };
}

function accumulateAgentSpend(store: JsonStore, cost: AgentCostBreakdown) {
  const prev = Number(store.getSetting("agentSpendUsdTotal", "0")) || 0;
  store.setSetting("agentSpendUsdTotal", String(prev + cost.totalUsd));
  store.setSetting("agentLastCostUsd", String(cost.totalUsd));
  store.setSetting("agentLastCostAt", new Date().toISOString());
}

export function getAgentSpendSummary(store: JsonStore) {
  return {
    totalUsd: Number(store.getSetting("agentSpendUsdTotal", "0")) || 0,
    lastUsd: Number(store.getSetting("agentLastCostUsd", "0")) || 0,
    lastAt: store.getSetting("agentLastCostAt") || null,
  };
}

function readChatHistory(store: JsonStore): AgentMessage[] {
  const raw = store.getSetting("tiktokAgentChatHistory", "[]");
  try {
    return JSON.parse(raw) as AgentMessage[];
  } catch {
    return [];
  }
}

function writeChatHistory(store: JsonStore, messages: AgentMessage[]) {
  store.setSetting("tiktokAgentChatHistory", JSON.stringify(messages));
}

export function listAgentChatHistory(store: JsonStore): AgentMessage[] {
  return readChatHistory(store);
}

export function clearAgentSession(store: JsonStore) {
  store.setSetting("tiktokAgentSessionId", "");
  store.setSetting("tiktokAgentChatHistory", "[]");
}
