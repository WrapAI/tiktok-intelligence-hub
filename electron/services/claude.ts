import type { JsonStore } from "../db.js";
import { requestAgentTask } from "./tiktokAgent.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

/** @deprecated All LLM work routes through the TikTok managed agent. */
export async function callClaude(
  store: JsonStore,
  system: string,
  user: string,
  _model = DEFAULT_MODEL
): Promise<string> {
  const { reply } = await requestAgentTask(store, "custom", system, user);
  return reply;
}
