import Anthropic from "@anthropic-ai/sdk";
import type { JsonStore } from "../db.js";
import {
  calculateUsageCost,
  MODEL_RATES,
  type AgentCostBreakdown,
} from "./agentPricing.js";
import {
  emitAgentSessionStatus,
} from "./agentSessionStatus.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 4096;
const CLIENT_TIMEOUT_MS = 180_000;

export type DirectClaudeResult = {
  reply: string;
  cost: AgentCostBreakdown;
};

function requireClient(store: JsonStore) {
  const apiKey = store.getSetting("anthropicApiKey");
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings first.");
  return new Anthropic({ apiKey, timeout: CLIENT_TIMEOUT_MS });
}

export function resolveAnthropicModel(store: JsonStore, override?: string): string {
  const candidate = (override || store.getSetting("anthropicModel", DEFAULT_MODEL) || DEFAULT_MODEL).trim();
  if (MODEL_RATES[candidate]) return candidate;
  return DEFAULT_MODEL;
}

function formatApiError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const body = err.error;
    const detail =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: string }).message || "")
        : "";
    return detail ? `Claude API error (${err.status}): ${detail}` : `Claude API error (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function recordSpend(store: JsonStore, cost: AgentCostBreakdown) {
  const prev = Number(store.getSetting("agentSpendUsdTotal", "0")) || 0;
  store.setSetting("agentSpendUsdTotal", String(prev + cost.totalUsd));
  store.setSetting("agentLastCostUsd", String(cost.totalUsd));
  store.setSetting("agentLastCostAt", new Date().toISOString());
}

/** Direct Messages API — no managed-agent bash tools or memory-store grep. */
export async function callClaudeDirect(
  store: JsonStore,
  system: string,
  user: string,
  options: {
    task?: string;
    maxTokens?: number;
    model?: string;
  } = {}
): Promise<DirectClaudeResult> {
  const task = options.task;
  const client = requireClient(store);
  const model = resolveAnthropicModel(store, options.model);

  try {
    emitAgentSessionStatus({
      active: true,
      phase: "running",
      message: "Calling Claude API…",
      task,
      at: new Date().toISOString(),
    });

    const response = await client.messages.create({
      model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    });

    if (response.stop_reason === "max_tokens") {
      throw new Error("Claude hit the token limit before finishing — try again or shorten the request.");
    }

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();

    if (!reply) {
      throw new Error("Claude returned an empty response — try again.");
    }

    const cost = calculateUsageCost(
      {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreation5mTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      model,
      undefined,
      false
    );

    recordSpend(store, cost);

    emitAgentSessionStatus({
      active: false,
      phase: "done",
      message: "Script ready",
      task,
      at: new Date().toISOString(),
    });

    return { reply, cost };
  } catch (err) {
    const msg = formatApiError(err);
    emitAgentSessionStatus({
      active: false,
      phase: "error",
      message: msg,
      task,
      at: new Date().toISOString(),
    });
    throw new Error(msg);
  }
}

/** @deprecated Prefer callClaudeDirect for structured tasks. */
export async function callClaude(
  store: JsonStore,
  system: string,
  user: string,
  _model = DEFAULT_MODEL
): Promise<string> {
  const { reply } = await callClaudeDirect(store, system, user);
  return reply;
}
