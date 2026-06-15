import Anthropic from "@anthropic-ai/sdk";
import type { JsonStore } from "../db.js";
import { buildHubMemoryDocuments } from "./hubContextSnapshot.js";

const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01" as const;

const DEFAULT_AGENT_ID = "agent_01NxQdQvuQLXgJgMgXbQ1LNz";

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
};

function getConfig(store: JsonStore): AgentConfig {
  return {
    agentId: store.getSetting("tiktokAgentId", DEFAULT_AGENT_ID),
    environmentId: store.getSetting("tiktokAgentEnvironmentId"),
    memoryStoreId: store.getSetting("tiktokAgentMemoryStoreId"),
    sessionId: store.getSetting("tiktokAgentSessionId"),
  };
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

export async function sendAgentMessage(store: JsonStore, message: string) {
  const apiKey = requireApiKey(store);
  const client = createClient(apiKey);

  const session = await createAgentSession(store);
  const sessionId = session.sessionId;

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

  await waitForIdle(client, sessionId);

  const replies: string[] = [];
  for await (const event of client.beta.sessions.events.list(sessionId, { betas: [MANAGED_AGENTS_BETA] })) {
    if (before.has(event.id)) continue;
    const text = extractAgentText(event as { type?: string; content?: Array<{ type?: string; text?: string }> });
    if (text) replies.push(text);
  }

  const assistantText = replies.join("\n\n").trim() || "Agent finished but returned no text.";

  const history = readChatHistory(store);
  history.push({ role: "user", text: message, at: new Date().toISOString() });
  history.push({ role: "assistant", text: assistantText, at: new Date().toISOString() });
  writeChatHistory(store, history.slice(-40));

  return { sessionId, reply: assistantText };
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
