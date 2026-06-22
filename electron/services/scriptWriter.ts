import { randomUUID } from "node:crypto";
import path from "node:path";
import { app } from "electron";
import type { JsonStore } from "../db.js";
import { findPacingReference, formatPacingBlock } from "./pacingReference.js";
import { formatLibraryPerformanceForPrompt, getScriptInsights } from "./libraryPerformance.js";
import { callClaudeDirect } from "./claude.js";
import { COMPLIANCE_RULES } from "./hubContextSnapshot.js";
import { mergeCosts, type AgentCostBreakdown } from "./agentPricing.js";
import { formatInspirationRules } from "./referenceAdaptation.js";
import { buildLibraryContextBlock } from "./libraryContext.js";
import { getProductResearchContext, researchProduct } from "./productResearch.js";
import { formatProductPackagingForPrompt, PACKAGING_KNOWLEDGE } from "./productPackaging.js";
import { synthesizeSpeech } from "./elevenlabs.js";
import { emitAgentSessionStatus } from "./agentSessionStatus.js";
import { extractJsonFromAgentReply } from "./agentJson.js";

export type ScriptRequest = {
  productId: string;
  durationSeconds?: number;
  referenceLibraryId?: string;
  additionalInfo?: string;
};

import { formatVideoOutcomesForPrompt } from "./videoOutcomes.js";

export type ScriptSection = "audio" | "on_screen_caption" | "tiktok_caption" | "pace";
export type ScriptSectionRating = "liked" | "disliked" | "keep_with_notes";
export type ScriptFeedback = "liked" | "disliked";

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
};

type ScriptRow = ScriptDetail & {
  feedback?: ScriptFeedback | null;
  feedback_reason?: string;
  feedback_at?: string;
  drive_mp4_path?: string;
  drive_uploaded_at?: string;
};

function sectionSnippet(script: ScriptRow, section: ScriptSection): string {
  switch (section) {
    case "audio":
      return String(script.script_text || "").slice(0, 400);
    case "on_screen_caption":
      return String(script.on_screen_caption || "").slice(0, 200);
    case "tiktok_caption":
      return String(script.tiktok_caption || "").slice(0, 300);
    case "pace":
      return String(script.ssml || "").slice(0, 400);
  }
}

function isScriptFeedbackComplete(script: ScriptRow): boolean {
  if (script.awaiting_feedback !== true) return true;
  const sf = script.section_feedback || {};
  return SCRIPT_SECTIONS.every((s) => !!sf[s]?.rating);
}

function formatScriptFeedbackForPrompt(store: JsonStore): string {
  const scripts = store
    .list<ScriptRow>("scripts")
    .filter((s) => {
      const sf = s.section_feedback || {};
      return SCRIPT_SECTIONS.some((sec) => sf[sec]?.rating);
    })
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, 6);

  if (!scripts.length) return "";

  const lines: string[] = ["## Creator script section feedback (hard constraints for future scripts)"];

  for (const script of scripts) {
    const sf = script.section_feedback || {};
    lines.push(`\n### ${script.title || "Script"} (${script.hook_type || "—"})`);
    for (const section of SCRIPT_SECTIONS) {
      const entry = sf[section];
      if (!entry?.rating) continue;
      const label = SCRIPT_SECTION_LABELS[section];
      const snippet = sectionSnippet(script, section);
      if (entry.rating === "liked") {
        lines.push(`- **${label} — LIKED** (replicate): ${snippet.slice(0, 200)}`);
      } else if (entry.rating === "disliked") {
        lines.push(
          `- **${label} — DISLIKED** (never repeat): ${entry.reason || "—"}\n  Was: ${snippet.slice(0, 150)}`
        );
      } else if (entry.rating === "keep_with_notes") {
        lines.push(`- **${label} — KEEP but note:** ${entry.notes || "—"}\n  Current: ${snippet.slice(0, 150)}`);
      }
    }
  }

  const outcomesBlock = formatVideoOutcomesForPrompt(store, 8);
  return `${lines.join("\n")}\n\n${outcomesBlock}`;
}

export function assertCanGenerateScript(store: JsonStore): void {
  const pending = store.list<ScriptRow>("scripts").find((s) => s.awaiting_feedback === true);
  if (!pending) return;
  if (isScriptFeedbackComplete(pending)) return;
  throw new Error(
    "Rate every script section (audio, on-screen caption, TikTok caption, pace) before generating another."
  );
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

/** @deprecated use rateScriptSectionFeedback */
export function rateScriptFeedback(
  store: JsonStore,
  scriptId: string,
  feedback: ScriptFeedback,
  reason?: string
) {
  return rateScriptSectionFeedback(
    store,
    scriptId,
    "audio",
    feedback === "liked" ? "liked" : "disliked",
    reason
  );
}

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

  let scriptCost: AgentCostBreakdown | undefined;

  if (!product.research_completed_at) {
    emitAgentSessionStatus({
      active: true,
      phase: "running",
      message: "Researching product packaging (one-time)…",
      task: "analyze_data",
      at: new Date().toISOString(),
    });
    const researched = await researchProduct(store, req.productId);
    if (researched?.cost) scriptCost = researched.cost;
  }

  const insights = getScriptInsights(store);
  const referenceId = req.referenceLibraryId || insights.recommendedReferenceId || undefined;
  const pacingRef = findPacingReference(store, referenceId);
  const performanceBlock = formatLibraryPerformanceForPrompt(store);
  const pacingBlock = formatPacingBlock(pacingRef);
  const excludeLibraryIds = new Set([
    ...insights.topVideos.slice(0, 8).map((v) => v.libraryId),
    ...(pacingRef?.libraryId ? [pacingRef.libraryId] : []),
  ]);
  const libraryBlock = buildLibraryContextBlock(store, 5, excludeLibraryIds);
  const packagingBlock = formatProductPackagingForPrompt(product);
  const researchBlock = getProductResearchContext(store, req.productId);
  const duration = req.durationSeconds || 45;
  const inferredHookType = insights.recommendedHookType;

  const system = `${COMPLIANCE_RULES}

${formatInspirationRules()}

${PACKAGING_KNOWLEDGE}`;

  const instructions = `You are an expert TikTok Shop affiliate scriptwriter for UK creators.

Rules:
- Do NOT use bash, grep, or file tools — all product, sales, and library data is in this message. Reply with JSON in one turn only.
- Read library stats and SEPARATED hooks (on-screen, audio, visual) — adapt structure only.
- Mirror top-performing speaking PACE in SSML (breaks, prosody) from reference pacing data.
- Use correct container nouns (tub, bottle, can, bag) for this product when showing/holding it.
- Never copy competitor products, backgrounds, or props from library videos.
- If creator script feedback includes disliked scripts with reasons, treat those reasons as hard constraints — do not repeat those mistakes.

Return JSON only:
{
  "title": "Script title",
  "fullAudioScript": "Complete spoken voiceover word-for-word",
  "ssml": "<speak>...ElevenLabs SSML with <break time=\\"300ms\\"/> pacing from top performers...</speak>",
  "onScreenCaption": "On-screen text overlay for the video (or empty string)",
  "tiktokCaption": "Full TikTok post caption with hashtags, ready to paste"
}`;

  const feedbackBlock = formatScriptFeedbackForPrompt(store);

  const context = `${performanceBlock}

${feedbackBlock}${libraryBlock}

${pacingBlock ? `${pacingBlock}\n\n` : ""}## Product to sell
- Name: ${product.name}
- Brand: ${product.brand || "—"}
- Price: ${product.price || "—"}
- Notes: ${product.description || "—"}
- ${packagingBlock}
${researchBlock ? `- ${researchBlock}` : ""}

## Target length
~${duration} seconds at the same speaking pace as the reference video.${req.additionalInfo?.trim() ? `

## Creator notes (read carefully — apply these to this script)
${req.additionalInfo.trim()}` : ""}`;

  const { reply: raw, cost: generationCost } = await callClaudeDirect(
    store,
    system,
    `${instructions}\n\n---\n\n${context}`,
    { task: "generate_script", maxTokens: 4096 }
  );
  const cost = scriptCost ? mergeCosts(scriptCost, generationCost) : generationCost;
  const parsed = parseScriptResponse(raw);
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
    hook_type: inferredHookType,
    funnel_style: inferredHookType,
    title: parsed.title,
    script_text: parsed.script,
    ssml: parsed.ssml,
    on_screen_caption: parsed.onScreenCaption,
    tiktok_caption: parsed.tiktokCaption,
    audio_path: audioPath || "",
    prompt_context: JSON.stringify({
      inferredHookType,
      referenceLibraryId: pacingRef?.libraryId || referenceId || null,
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
    hookType: inferredHookType,
    productId: req.productId,
    referenceLibraryId: pacingRef?.libraryId || referenceId,
    createdAt,
    onScreenCaption: parsed.onScreenCaption,
    tiktokCaption: parsed.tiktokCaption,
    audioPath,
    sectionFeedback: {},
    cost,
  };
}
