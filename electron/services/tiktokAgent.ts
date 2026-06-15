import Anthropic from "@anthropic-ai/sdk";
import type { JsonStore } from "../db.js";
import { buildHubMemoryDocuments } from "./hubContextSnapshot.js";
import {
  calculateUsageCost,
  diffUsage,
  normalizeSessionUsage,
  type AgentCostBreakdown,
} from "./agentPricing.js";

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

async function waitForIdle(client: Anthropic, sessionId: string, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const session = await client.beta.sessions.retrieve(sessionId, { betas: [MANAGED_AGENTS_BETA] });
    if (session.status === "idle") return session;
    if (session.status === "terminated") throw new Error("Agent session terminated.");
    await new Promise((r) => setTimeout(r, 1500));
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
  options: { recordInChat?: boolean; timeoutMs?: number } = {}
): Promise<AgentCallResult> {
  const apiKey = requireApiKey(store);
  const client = createClient(apiKey);
  const timeoutMs = options.timeoutMs ?? 120_000;

  const session = await createAgentSession(store);
  const sessionId = session.sessionId;
  const usageBefore = await readSessionMeta(client, sessionId);

  const before = new Set<string>();
  for await (const event of client.beta.sessions.events.list(sessionId, { betas: [MANAGED_AGENTS_BETA] })) {
    before.add(event.id);
  }

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: message }],
      },
    ],
    betas: [MANAGED_AGENTS_BETA],
  });

  await waitForIdle(client, sessionId, timeoutMs);

  const usageAfter = await readSessionMeta(client, sessionId);
  const delta = diffUsage(usageBefore.usage, usageAfter.usage);
  const cost = calculateUsageCost(delta, usageAfter.modelId, usageAfter.speed, false);

  const replies: string[] = [];
  for await (const event of client.beta.sessions.events.list(sessionId, { betas: [MANAGED_AGENTS_BETA] })) {
    if (before.has(event.id)) continue;
    const text = extractAgentText(event as { type?: string; content?: Array<{ type?: string; text?: string }> });
    if (text) replies.push(text);
  }

  const assistantText = replies.join("\n\n").trim() || "Agent finished but returned no text.";

  if (options.recordInChat !== false) {
    const history = readChatHistory(store);
    history.push({ role: "user", text: message, at: new Date().toISOString() });
    history.push({ role: "assistant", text: assistantText, at: new Date().toISOString(), cost });
    writeChatHistory(store, history.slice(-40));
  }

  accumulateAgentSpend(store, cost);

  return { sessionId, reply: assistantText, cost };
}

/** Internal hub tasks (scripts, auto-sync notices) — not shown in TikTok Agent chat tab. */
export async function sendAgentTask(
  store: JsonStore,
  message: string,
  options: { timeoutMs?: number } = {}
) {
  return deliverAgentMessage(store, message, { recordInChat: false, timeoutMs: options.timeoutMs });
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
  return sendAgentTask(store, header + body, { timeoutMs });
}

export async function sendAgentMessage(store: JsonStore, message: string) {
  const result = await deliverAgentMessage(store, message, { recordInChat: true });
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
