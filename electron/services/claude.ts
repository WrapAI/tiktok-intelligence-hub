import Anthropic from "@anthropic-ai/sdk";
import type { JsonStore } from "../db.js";
import {
  assertAgentCallAllowed,
  checkPostCallAnomaly,
  hashAgentPayload,
  recordAgentCall,
} from "./agentGuardrails.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Lightweight direct API call — no managed agent / memory store overhead. */
export async function callClaudeDirect(
  store: JsonStore,
  system: string,
  user: string,
  model = DEFAULT_MODEL,
  task = "direct_api",
  options: { skipDuplicateCheck?: boolean; skipDirectApiLimit?: boolean } = {}
): Promise<string> {
  const payloadHash = hashAgentPayload(`${task}|${system.slice(0, 500)}|${user.slice(0, 2000)}`);
  assertAgentCallAllowed(store, "direct_api", {
    task,
    payloadHash,
    payloadChars: system.length + user.length,
    skipDuplicateCheck: options.skipDuplicateCheck,
    skipDirectApiLimit: options.skipDirectApiLimit,
  });

  const apiKey = store.getSetting("anthropicApiKey");
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings first.");

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });

  const inputTokens = msg.usage?.input_tokens || 0;
  const outputTokens = msg.usage?.output_tokens || 0;
  const outputUsd = (outputTokens / 1_000_000) * 15;
  const inputUsd = (inputTokens / 1_000_000) * 3;

  recordAgentCall(store, {
    at: new Date().toISOString(),
    kind: "direct_api",
    task,
    inputTokens,
    outputTokens,
    costUsd: inputUsd + outputUsd,
    payloadHash,
  });
  checkPostCallAnomaly(store, inputTokens, "direct_api", task);

  const block = msg.content.find((b) => b.type === "text");
  return block?.type === "text" ? block.text.trim() : "";
}
