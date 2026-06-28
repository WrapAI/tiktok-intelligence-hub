import { randomUUID } from "node:crypto";
import path from "node:path";
import { app } from "electron";
import type { JsonStore } from "../db.js";
import { findPacingReference, formatPacingBlock, pickPacingReferenceVaried } from "./pacingReference.js";
import { formatLibraryPerformanceForPrompt, getScriptInsights } from "./libraryPerformance.js";
import { callClaudeDirect } from "./claude.js";
import { buildLibraryContextBlock } from "./libraryContext.js";
import { getProductResearchContext, applyHeuristicProductPackaging } from "./productResearch.js";
import { formatProductPackagingForPrompt } from "./productPackaging.js";
import { buildScriptWriterSystemPrompt } from "./scriptSystemPrompt.js";
import { recordValidationLesson } from "./scriptFeedback.js";
import {
  buildVarietyDirectiveBlock,
  getRecentScriptContext,
  pickHookTypeForScript,
} from "./scriptVariety.js";
import { synthesizeSpeech } from "./elevenlabs.js";
import { AGENT_GUARDRAILS, revokeScriptGenerationCalls } from "./agentGuardrails.js";

export type ScriptRequest = {
  productId: string;
  durationSeconds?: number;
  referenceLibraryId?: string;
  additionalInfo?: string;
  skipDuplicateCheck?: boolean;
  bypassApiLimits?: boolean;
  /** Changes payload hash per click so intentional re-generates are not blocked as duplicates. */
  generationNonce?: number;
};

export type ScriptSection = "audio" | "on_screen_caption" | "tiktok_caption" | "pace";
export type ScriptSectionRating = "liked" | "disliked" | "keep_with_notes";

export const SCRIPT_SECTIONS: ScriptSection[] = [
  "audio",
  "on_screen_caption",
  "tiktok_caption",
  "pace",
];

export const SCRIPT_SECTION_LABELS: Record<ScriptSection, string> = {
  audio: "Audio script",
  on_screen_caption: "On-screen caption",
  tiktok_caption: "TikTok caption + hashtags",
  pace: "Pace (SSML)",
};

export type ScriptSectionFeedbackEntry = {
  rating: ScriptSectionRating;
  reason?: string;
  notes?: string;
  rated_at: string;
};

export type ScriptDetail = {
  id: string;
  title: string;
  script_text: string;
  ssml: string;
  on_screen_caption: string;
  tiktok_caption: string;
  audio_path: string;
  hook_type: string;
  product_id: string;
  created_at: string;
  section_feedback: Partial<Record<ScriptSection, ScriptSectionFeedbackEntry>>;
  awaiting_feedback: boolean;
};

export type ScriptResult = {
  id: string;
  title: string;
  script: string;
  ssml: string;
  hookType: string;
  productId: string;
  referenceLibraryId?: string;
  createdAt: string;
  onScreenCaption: string;
  tiktokCaption: string;
  audioPath?: string;
  sectionFeedback?: Partial<Record<ScriptSection, ScriptSectionFeedbackEntry>>;
  cost?: import("./agentPricing.js").AgentCostBreakdown;
  validationBlocked?: boolean;
  validationViolations?: string[];
  validationLessonSaved?: boolean;
};

export const BANNED_PHRASES = [
  "basically free",
  "for free",
  "it's free",
  "costs nothing",
  "for nothing",
  "colon reset",
  "gut cleanse",
  "lose weight",
  "burn fat",
  "boost metabolism",
  "not a single",
  "don't buy this don't buy this",
  "i had to say that out loud",
  "every. single. time",
] as const;

export function validateScript(
  fullAudioScript: string,
  opts: { productName?: string } = {}
): { valid: boolean; violations: string[] } {
  const text = fullAudioScript.toLowerCase();
  const violations: string[] = [];

  for (const phrase of BANNED_PHRASES) {
    if (text.includes(phrase.toLowerCase())) violations.push(phrase);
  }

  const dontBuyMatches = fullAudioScript.match(/don't buy this/gi) || [];
  if (dontBuyMatches.length > 1) {
    violations.push('"don\'t buy this" repeated more than once in hook');
  }

  const hookLine = fullAudioScript.split(".")[0] || "";
  const hookWords = hookLine.trim().split(/\s+/).filter(Boolean).length;
  const isCountdown = hookLine.trim().toLowerCase().startsWith("not");
  if (!isCountdown && hookWords > 7) {
    violations.push(`HOOK TOO LONG: "${hookLine.trim()}" is ${hookWords} words — maximum is 7`);
  }

  const productName = opts.productName?.trim();
  if (productName) {
    const escaped = productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const productMentions = (fullAudioScript.toLowerCase().match(new RegExp(escaped, "gi")) || []).length;
    if (productMentions > 2) {
      violations.push(
        `PRODUCT NAME REPEATED ${productMentions} TIMES: "${productName}" — use pronouns after first mention`
      );
    }
  }

  const sentences = fullAudioScript.split(/[.!?]/);
  const seenPhrases = new Set<string>();
  for (const sentence of sentences) {
    const words = sentence.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for (let i = 0; i <= words.length - 4; i++) {
      const phrase = words.slice(i, i + 4).join(" ");
      if (seenPhrases.has(phrase)) {
        violations.push(`REPEATED PHRASE DETECTED: "${phrase}" — every phrase should appear once only`);
        break;
      }
      seenPhrases.add(phrase);
    }
  }

  return { valid: violations.length === 0, violations: [...new Set(violations)] };
}

export function assertScriptPassesValidation(fullAudioScript: string, productName?: string): void {
  const { valid, violations } = validateScript(fullAudioScript, { productName });
  if (!valid) {
    throw new Error(`Script blocked — banned phrases: ${violations.join(", ")}`);
  }
}

type ScriptRow = ScriptDetail & {
  feedback?: string | null;
  feedback_reason?: string;
  feedback_at?: string;
};

function isScriptFeedbackComplete(script: ScriptRow): boolean {
  if (script.awaiting_feedback !== true) return true;
  const sf = script.section_feedback || {};
  return SCRIPT_SECTIONS.every((s) => !!sf[s]?.rating);
}

export function healScriptFeedbackFlags(store: JsonStore): number {
  let healed = 0;
  for (const script of store.list<ScriptRow>("scripts")) {
    if (script.awaiting_feedback !== true) continue;
    if (!isScriptFeedbackComplete(script)) continue;
    store.upsertById("scripts", {
      ...(script as { id: string }),
      awaiting_feedback: false,
    });
    healed += 1;
  }
  return healed;
}

function findBlockingFeedbackScript(store: JsonStore): ScriptRow | null {
  healScriptFeedbackFlags(store);
  return (
    store.list<ScriptRow>("scripts").find((s) => s.awaiting_feedback === true && !isScriptFeedbackComplete(s)) ||
    null
  );
}

export function assertCanGenerateScript(store: JsonStore): void {
  if (findBlockingFeedbackScript(store)) {
    throw new Error(
      "Rate every script section (audio, on-screen caption, TikTok caption, pace) before generating another."
    );
  }
}

export function getPendingFeedbackScript(store: JsonStore): ScriptDetail | null {
  const pending = findBlockingFeedbackScript(store);
  if (!pending) return null;
  return getScriptDetail(store, pending.id);
}

export function dismissBlockingScriptFeedback(store: JsonStore): string | null {
  const pending = findBlockingFeedbackScript(store);
  if (!pending) return null;
  dismissScriptFeedback(store, pending.id);
  return pending.id;
}

export function dismissScriptFeedback(store: JsonStore, scriptId: string): void {
  const script = store.list<ScriptRow>("scripts").find((s) => s.id === scriptId);
  if (!script) throw new Error("Script not found.");
  store.upsertById("scripts", {
    ...(script as { id: string }),
    awaiting_feedback: false,
  });
}

export function getScriptDetail(store: JsonStore, scriptId: string): ScriptDetail | null {
  const script = store.list<ScriptRow>("scripts").find((s) => s.id === scriptId);
  if (!script) return null;
  return {
    id: script.id,
    title: String(script.title || ""),
    script_text: String(script.script_text || ""),
    ssml: String(script.ssml || ""),
    on_screen_caption: String(script.on_screen_caption || ""),
    tiktok_caption: String(script.tiktok_caption || ""),
    audio_path: String(script.audio_path || ""),
    hook_type: String(script.hook_type || ""),
    product_id: String(script.product_id || ""),
    created_at: String(script.created_at || ""),
    section_feedback: script.section_feedback || {},
    awaiting_feedback: script.awaiting_feedback === true,
  };
}

export function updateScriptContent(
  store: JsonStore,
  scriptId: string,
  updates: {
    title?: string;
    script_text?: string;
    ssml?: string;
    on_screen_caption?: string;
    tiktok_caption?: string;
  }
): ScriptDetail {
  const script = store.list<ScriptRow>("scripts").find((s) => s.id === scriptId);
  if (!script) throw new Error("Script not found.");
  if (updates.script_text !== undefined) {
    const product = store
      .list<Record<string, unknown>>("products")
      .find((p) => p.id === script.product_id);
    assertScriptPassesValidation(String(updates.script_text), product?.name ? String(product.name) : undefined);
  }
  store.upsertById("scripts", {
    ...(script as { id: string }),
    ...updates,
  });
  const updated = getScriptDetail(store, scriptId);
  if (!updated) throw new Error("Script not found.");
  return updated;
}

export function rateScriptSectionFeedback(
  store: JsonStore,
  scriptId: string,
  section: ScriptSection,
  rating: ScriptSectionRating,
  reason?: string,
  notes?: string
): { id: string; sectionFeedback: Partial<Record<ScriptSection, ScriptSectionFeedbackEntry>> } {
  if (!SCRIPT_SECTIONS.includes(section)) throw new Error("Invalid script section.");

  const script = store.list<ScriptRow>("scripts").find((s) => s.id === scriptId);
  if (!script) throw new Error("Script not found.");

  const trimmedReason = reason?.trim() || "";
  const trimmedNotes = notes?.trim() || "";
  if (rating === "disliked" && !trimmedReason) {
    throw new Error("Say what you didn't like — this helps future scripts improve.");
  }
  if (rating === "keep_with_notes" && !trimmedNotes) {
    throw new Error("Add notes for what to keep or adjust.");
  }

  const sectionFeedback: Partial<Record<ScriptSection, ScriptSectionFeedbackEntry>> = {
    ...(script.section_feedback || {}),
    [section]: {
      rating,
      reason: rating === "disliked" ? trimmedReason : undefined,
      notes: rating === "keep_with_notes" ? trimmedNotes : undefined,
      rated_at: new Date().toISOString(),
    },
  };

  const allRated = SCRIPT_SECTIONS.every((s) => !!sectionFeedback[s]?.rating);

  store.upsertById("scripts", {
    ...(script as { id: string }),
    section_feedback: sectionFeedback,
    awaiting_feedback: !allRated,
  });

  return { id: scriptId, sectionFeedback };
}

function assembleScriptUserContext(opts: {
  performanceBlock: string;
  libraryBlock: string;
  pacingBlock: string;
  varietyBlock: string;
  product: Record<string, unknown>;
  packagingBlock: string;
  researchBlock: string;
  duration: number;
  additionalInfo: string;
  fixBlock?: string;
}): string {
  const parts = [
    "Reference context for this script (library performance, pacing, variety, product):",
    "",
    opts.performanceBlock,
    "",
    opts.libraryBlock,
    "",
    opts.pacingBlock ? `${opts.pacingBlock}\n` : "",
    opts.varietyBlock,
    "",
    "## Product to sell",
    `- Name: ${opts.product.name}`,
    `- Brand: ${opts.product.brand || "—"}`,
    `- Price: ${opts.product.price || "—"}`,
    `- Notes: ${opts.product.description || "—"}`,
    `- ${opts.packagingBlock}`,
    opts.researchBlock ? `- ${opts.researchBlock}` : "",
    "",
    "## Target length",
    `~${opts.duration} seconds at the same speaking pace as the reference video.`,
  ];

  if (opts.additionalInfo.trim()) {
    parts.push("", "## Creator notes (read carefully — apply these to this script)", opts.additionalInfo.trim());
  }

  if (opts.fixBlock) {
    parts.push("", opts.fixBlock);
  }

  return parts.filter((line) => line !== undefined).join("\n");
}

function trimPerformanceBlockTopVideos(block: string, maxVideos: number): string {
  const lines = block.split("\n");
  const out: string[] = [];
  let videoIdx = 0;
  let skipping = false;

  for (const line of lines) {
    if (/^\d+\. \*\*/.test(line)) {
      videoIdx += 1;
      skipping = videoIdx > maxVideos;
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

function buildScriptUserContext(
  store: JsonStore,
  opts: {
    product: Record<string, unknown>;
    productId: string;
    performanceBlock: string;
    pacingBlock: string;
    varietyBlock: string;
    duration: number;
    additionalInfo: string;
    excludeLibraryIds: Set<string>;
    libraryLimit: number;
    topVideoLimit: number;
    fixBlock?: string;
  }
): string {
  const packagingBlock = formatProductPackagingForPrompt(opts.product);
  const researchBlock = getProductResearchContext(store, opts.productId);
  const performanceBlock = trimPerformanceBlockTopVideos(opts.performanceBlock, opts.topVideoLimit);
  const libraryBlock = buildLibraryContextBlock(store, opts.libraryLimit, opts.excludeLibraryIds);

  return assembleScriptUserContext({
    performanceBlock,
    libraryBlock,
    pacingBlock: opts.pacingBlock,
    varietyBlock: opts.varietyBlock,
    product: opts.product,
    packagingBlock,
    researchBlock,
    duration: opts.duration,
    additionalInfo: opts.additionalInfo,
    fixBlock: opts.fixBlock,
  });
}

function fitScriptContextToLimit(
  store: JsonStore,
  system: string,
  base: Omit<Parameters<typeof buildScriptUserContext>[1], "libraryLimit" | "topVideoLimit">
): string {
  const max = AGENT_GUARDRAILS.maxDirectPayloadChars;
  const tiers: Array<{ libraryLimit: number; topVideoLimit: number }> = [
    { libraryLimit: 5, topVideoLimit: 7 },
    { libraryLimit: 3, topVideoLimit: 5 },
    { libraryLimit: 2, topVideoLimit: 4 },
    { libraryLimit: 1, topVideoLimit: 3 },
    { libraryLimit: 0, topVideoLimit: 3 },
  ];

  for (const tier of tiers) {
    const context = buildScriptUserContext(store, { ...base, ...tier });
    if (system.length + context.length <= max) return context;
  }

  return buildScriptUserContext(store, { ...base, libraryLimit: 0, topVideoLimit: 3 });
}

import { extractJsonFromAgentReply } from "./agentJson.js";

function parseScriptResponse(raw: string): {
  title: string;
  script: string;
  ssml: string;
  onScreenCaption: string;
  tiktokCaption: string;
} {
  try {
    const parsed = extractJsonFromAgentReply(raw, "script") as Record<string, unknown>;
    return {
      title: String(parsed.title || "Untitled script").trim(),
      script: String(parsed.fullAudioScript || parsed.script || "").trim(),
      ssml: String(parsed.ssml || "").trim(),
      onScreenCaption: String(parsed.onScreenCaption || parsed.on_screen_caption || "").trim(),
      tiktokCaption: String(parsed.tiktokCaption || parsed.tiktok_caption || "").trim(),
    };
  } catch {
    const titleMatch = raw.match(/^#\s*(.+)$/m);
    const title = titleMatch?.[1]?.trim() || "Untitled script";
    const ssmlMatch = raw.match(/```ssml\n([\s\S]*?)```/i);
    const ssml = ssmlMatch?.[1]?.trim() || "";
    let script = raw;
    if (ssmlMatch) script = script.replace(ssmlMatch[0], "").trim();
    script = script.replace(/^#\s*.+\n?/m, "").trim();
    return { title, script, ssml, onScreenCaption: "", tiktokCaption: "" };
  }
}

export async function generateScript(store: JsonStore, req: ScriptRequest): Promise<ScriptResult> {
  if (!store.getSetting("anthropicApiKey")) {
    throw new Error("Add your Anthropic API key in Settings first.");
  }

  assertCanGenerateScript(store);

  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === req.productId);
  if (!product) throw new Error("Product not found.");

  if (!product.research_completed_at) {
    applyHeuristicProductPackaging(store, req.productId);
  }

  const insights = getScriptInsights(store);
  const recent = getRecentScriptContext(store, req.productId);
  const { hookType: selectedHookType, poolSize: hookPoolSize } = pickHookTypeForScript(
    insights.hookTypeStats,
    recent.hookTypes
  );
  const alternateHookTypes = insights.hookTypeStats
    .map((s) => s.hookType)
    .filter((h) => h.toLowerCase() !== selectedHookType.toLowerCase());

  const referenceId = req.referenceLibraryId || undefined;
  const pacingRef = referenceId
    ? findPacingReference(store, referenceId)
    : pickPacingReferenceVaried(store, { excludeIds: recent.pacingIds });
  const performanceBlock = formatLibraryPerformanceForPrompt(store, { selectedHookType });
  const varietyBlock = buildVarietyDirectiveBlock({
    selectedHookType,
    hookPoolSize,
    pacingRef,
    recent,
    alternateHookTypes,
  });
  const pacingBlock = formatPacingBlock(pacingRef);
  const excludeLibraryIds = new Set([
    ...insights.topVideos.slice(0, 8).map((v) => v.libraryId),
    ...(pacingRef?.libraryId ? [pacingRef.libraryId] : []),
  ]);
  const duration = req.durationSeconds || 45;

  const system = buildScriptWriterSystemPrompt(store);

  const contextBase = {
    product,
    productId: req.productId,
    performanceBlock,
    pacingBlock,
    varietyBlock,
    duration,
    additionalInfo: req.additionalInfo?.trim() || "",
    excludeLibraryIds,
  };

  const context = fitScriptContextToLimit(store, system, contextBase);
  const contextWithNonce = req.generationNonce
    ? `${context}\n\n<!-- generation:${req.generationNonce} -->`
    : context;

  const skipGuardrails = req.skipDuplicateCheck || req.bypassApiLimits;
  const callOpts = { skipDuplicateCheck: skipGuardrails, skipDirectApiLimit: req.bypassApiLimits };

  let raw = await callClaudeDirect(store, system, contextWithNonce, undefined, "generate_script", callOpts);
  let parsed = parseScriptResponse(raw);
  let validation = validateScript(parsed.script, { productName: String(product.name || "") });

  if (!validation.valid) {
    const fixBlock = `## VALIDATION FAILED — rewrite the entire script fixing ALL issues below
${validation.violations.map((v) => `- ${v}`).join("\n")}

Hook reminder: the FIRST sentence must be 1–7 words maximum. Countdown hooks starting with "Not" are exempt.
Good hooks: "Don't buy this." / "Stop." / "Do not waste your money." / "Not one, not two, but two."
Do NOT start with a long story sentence like "I used to spend..." — that will be rejected.`;

    const retryContext = fitScriptContextToLimit(store, system, { ...contextBase, fixBlock });
    const retryWithNonce = req.generationNonce
      ? `${retryContext}\n\n<!-- generation-retry:${req.generationNonce} -->`
      : retryContext;
    raw = await callClaudeDirect(store, system, retryWithNonce, undefined, "generate_script_retry", {
      ...callOpts,
      skipDuplicateCheck: true,
    });
    parsed = parseScriptResponse(raw);
    validation = validateScript(parsed.script, { productName: String(product.name || "") });
  }

  if (!validation.valid) {
    revokeScriptGenerationCalls(store);
    recordValidationLesson(store, {
      productId: req.productId,
      productName: String(product.name || ""),
      title: parsed.title,
      scriptText: parsed.script,
      violations: validation.violations,
    });
    return {
      id: "",
      title: parsed.title,
      script: parsed.script,
      ssml: parsed.ssml,
      hookType: selectedHookType,
      productId: req.productId,
      referenceLibraryId: pacingRef?.libraryId || referenceId,
      createdAt: new Date().toISOString(),
      onScreenCaption: parsed.onScreenCaption,
      tiktokCaption: parsed.tiktokCaption,
      sectionFeedback: {},
      validationBlocked: true,
      validationViolations: validation.violations,
      validationLessonSaved: true,
    };
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();

  let audioPath: string | undefined;
  if (store.getSetting("elevenLabsApiKey") && store.getSetting("elevenLabsVoiceId")) {
    try {
      const audioDir = path.join(app.getPath("userData"), "audio");
      const safeTitle = parsed.title
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 60);
      const dateStr = createdAt.slice(0, 10);
      const audio = await synthesizeSpeech(store, {
        text: parsed.script,
        ssml: parsed.ssml,
        scriptId: `${safeTitle}_${dateStr}`,
        outputDir: audioDir,
      });
      audioPath = audio.filePath;
    } catch (err) {
      console.warn("ElevenLabs auto-generate failed:", err);
    }
  }

  store.upsertById("scripts", {
    id,
    product_id: req.productId,
    hook_type: selectedHookType,
    funnel_style: selectedHookType,
    title: parsed.title,
    script_text: parsed.script,
    ssml: parsed.ssml,
    on_screen_caption: parsed.onScreenCaption,
    tiktok_caption: parsed.tiktokCaption,
    audio_path: audioPath || "",
    prompt_context: JSON.stringify({
      selectedHookType,
      referenceLibraryId: pacingRef?.libraryId || referenceId || null,
      varietyRotation: true,
    }),
    reference_library_id: pacingRef?.libraryId || referenceId || null,
    created_at: createdAt,
    awaiting_feedback: true,
    section_feedback: {},
  });

  return {
    id,
    title: parsed.title,
    script: parsed.script,
    ssml: parsed.ssml,
    hookType: selectedHookType,
    productId: req.productId,
    referenceLibraryId: pacingRef?.libraryId || referenceId,
    createdAt,
    onScreenCaption: parsed.onScreenCaption,
    tiktokCaption: parsed.tiktokCaption,
    audioPath,
    sectionFeedback: {},
  };
}
