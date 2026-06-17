/** Anthropic API list pricing — verified June 15, 2026 (USD per 1M tokens). */
export const PRICING_AS_OF = "2026-06-15";

export type ModelRate = {
  label: string;
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWrite5mPerM: number;
  /** Fast mode multiplier when speed=fast (Opus 4.8). */
  fastMultiplier?: number;
};

export const MODEL_RATES: Record<string, ModelRate> = {
  "claude-haiku-4-5": {
    label: "Haiku 4.5",
    inputPerM: 1.0,
    outputPerM: 5.0,
    cacheReadPerM: 0.1,
    cacheWrite5mPerM: 1.25,
  },
  "claude-sonnet-4-6": {
    label: "Sonnet 4.6",
    inputPerM: 3.0,
    outputPerM: 15.0,
    cacheReadPerM: 0.3,
    cacheWrite5mPerM: 3.75,
  },
  "claude-sonnet-4-5": {
    label: "Sonnet 4.5",
    inputPerM: 3.0,
    outputPerM: 15.0,
    cacheReadPerM: 0.3,
    cacheWrite5mPerM: 3.75,
  },
  "claude-opus-4-8": {
    label: "Opus 4.8",
    inputPerM: 5.0,
    outputPerM: 25.0,
    cacheReadPerM: 0.5,
    cacheWrite5mPerM: 6.25,
    fastMultiplier: 2,
  },
  "claude-opus-4-7": {
    label: "Opus 4.7",
    inputPerM: 5.0,
    outputPerM: 25.0,
    cacheReadPerM: 0.5,
    cacheWrite5mPerM: 6.25,
  },
  "claude-opus-4-6": {
    label: "Opus 4.6",
    inputPerM: 5.0,
    outputPerM: 25.0,
    cacheReadPerM: 0.5,
    cacheWrite5mPerM: 6.25,
  },
  "claude-fable-5": {
    label: "Fable 5",
    inputPerM: 10.0,
    outputPerM: 50.0,
    cacheReadPerM: 1.0,
    cacheWrite5mPerM: 12.5,
  },
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreation5mTokens?: number;
};

export type AgentCostBreakdown = {
  pricingAsOf: string;
  modelId: string;
  modelLabel: string;
  usage: TokenUsage;
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  totalUsd: number;
  estimated: boolean;
};

export type AgentActionEstimateParams = {
  action: "generate_script" | "generate_daily_plan" | "agent_chat" | "agent_task";
  messageChars?: number;
  totalVideos?: number;
  durationSeconds?: number;
};

const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Rough token count (~3.5 chars/token for English). */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

export function resolveModelRate(modelId?: string, speed?: string): ModelRate {
  const key = (modelId || DEFAULT_MODEL).toLowerCase();
  const rate = MODEL_RATES[key] || MODEL_RATES[DEFAULT_MODEL];
  if (speed === "fast" && rate.fastMultiplier) {
    return {
      ...rate,
      inputPerM: rate.inputPerM * rate.fastMultiplier,
      outputPerM: rate.outputPerM * rate.fastMultiplier,
      label: `${rate.label} (fast)`,
    };
  }
  return rate;
}

export function calculateUsageCost(
  usage: TokenUsage,
  modelId?: string,
  speed?: string,
  estimated = false
): AgentCostBreakdown {
  const rate = resolveModelRate(modelId, speed);
  const cacheRead = usage.cacheReadInputTokens || 0;
  const cacheWrite = usage.cacheCreation5mTokens || 0;
  const billableInput = Math.max(0, usage.inputTokens - cacheRead);

  const inputUsd = (billableInput / 1_000_000) * rate.inputPerM;
  const cacheReadUsd = (cacheRead / 1_000_000) * rate.cacheReadPerM;
  const cacheWriteUsd = (cacheWrite / 1_000_000) * rate.cacheWrite5mPerM;
  const outputUsd = (usage.outputTokens / 1_000_000) * rate.outputPerM;

  return {
    pricingAsOf: PRICING_AS_OF,
    modelId: modelId || DEFAULT_MODEL,
    modelLabel: rate.label,
    usage,
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheWriteUsd,
    totalUsd: inputUsd + cacheReadUsd + cacheWriteUsd + outputUsd,
    estimated,
  };
}

export function diffUsage(before: TokenUsage, after: TokenUsage): TokenUsage {
  return {
    inputTokens: Math.max(0, after.inputTokens - before.inputTokens),
    outputTokens: Math.max(0, after.outputTokens - before.outputTokens),
    cacheReadInputTokens: Math.max(0, (after.cacheReadInputTokens || 0) - (before.cacheReadInputTokens || 0)),
    cacheCreation5mTokens: Math.max(0, (after.cacheCreation5mTokens || 0) - (before.cacheCreation5mTokens || 0)),
  };
}

export function normalizeSessionUsage(usage?: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number };
}): TokenUsage {
  return {
    inputTokens: usage?.input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens || 0,
    cacheCreation5mTokens: usage?.cache_creation?.ephemeral_5m_input_tokens || 0,
  };
}

/** Pre-action estimates for agent buttons (includes memory-store context read).
 *
 * Token assumptions (Sonnet 4.6, verified against real calls Jun 2026):
 *
 *  Memory context (hub/*.md synced to memory store):
 *    ~18 000 total input tokens of which ~14 000 are cache-read hits (~$0.004)
 *    and ~4 000 are fresh input each call (~$0.012)
 *
 *  generate_script:
 *    task input  ~4 000  (instructions 1 500 + library block 1 200 + product/pacing 1 300)
 *    task output ~1 400  (script 500 + SSML 600 + captions 200 + JSON wrapper 100)
 *    → typical total ≈ $0.05–0.07
 *
 *  generate_daily_plan:
 *    task input  ~3 500 base + ~80 tokens per video (product lines + funnel refs)
 *    task output ~700 tokens per video (script + clips + captions JSON)
 *    → 15 videos ≈ $0.19,  30 videos ≈ $0.36
 *
 *  agent_chat:
 *    task input  ~800 base + user message
 *    task output ~700  (conversational reply)
 *    → typical ≈ $0.015
 */
export function estimateAgentActionCost(
  params: AgentActionEstimateParams,
  modelId?: string
): AgentCostBreakdown {
  const memoryContextInput =
    params.action === "generate_script" || params.action === "generate_daily_plan" ? 0 : 18_000;
  const memoryCacheRead =
    params.action === "generate_script" || params.action === "generate_daily_plan" ? 0 : 14_000;

  let taskInput = 0;
  let taskOutput = 0;

  switch (params.action) {
    case "generate_script":
      taskInput = 5_500;
      taskOutput = 1_400;
      break;
    case "generate_daily_plan": {
      const videos = params.totalVideos || 15;
      taskInput = 4_000 + videos * 80;
      taskOutput = videos * 700;
      break;
    }
    case "agent_chat":
      taskInput = 800 + estimateTokensFromText(params.messageChars ? "x".repeat(params.messageChars) : "");
      taskOutput = 700;
      break;
    case "agent_task":
      taskInput = 2_500;
      taskOutput = 1_200;
      break;
  }

  return calculateUsageCost(
    {
      inputTokens: memoryContextInput + taskInput,
      outputTokens: taskOutput,
      cacheReadInputTokens: memoryCacheRead,
    },
    modelId,
    undefined,
    true
  );
}

export function mergeCosts(a: AgentCostBreakdown, b: AgentCostBreakdown): AgentCostBreakdown {
  return {
    pricingAsOf: a.pricingAsOf,
    modelId: a.modelId,
    modelLabel: a.modelLabel,
    usage: {
      inputTokens: a.usage.inputTokens + b.usage.inputTokens,
      outputTokens: a.usage.outputTokens + b.usage.outputTokens,
      cacheReadInputTokens: (a.usage.cacheReadInputTokens || 0) + (b.usage.cacheReadInputTokens || 0),
      cacheCreation5mTokens: (a.usage.cacheCreation5mTokens || 0) + (b.usage.cacheCreation5mTokens || 0),
    },
    inputUsd: a.inputUsd + b.inputUsd,
    outputUsd: a.outputUsd + b.outputUsd,
    cacheReadUsd: a.cacheReadUsd + b.cacheReadUsd,
    cacheWriteUsd: a.cacheWriteUsd + b.cacheWriteUsd,
    totalUsd: a.totalUsd + b.totalUsd,
    estimated: a.estimated || b.estimated,
  };
}

export function formatUsd(amount: number): string {
  if (amount < 0.001) return "< $0.001";
  if (amount < 0.01) return `≈ $${amount.toFixed(3)}`;
  if (amount < 1) return `≈ $${amount.toFixed(2)}`;
  return `≈ $${amount.toFixed(2)}`;
}

export function formatCostLabel(cost: AgentCostBreakdown): string {
  const prefix = cost.estimated ? "Est. " : "";
  return `${prefix}${formatUsd(cost.totalUsd)} (${cost.modelLabel})`;
}
