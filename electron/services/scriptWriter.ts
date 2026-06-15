import { randomUUID } from "node:crypto";
import path from "node:path";
import { app } from "electron";
import type { JsonStore } from "../db.js";
import { findPacingReference, formatPacingBlock } from "./pacingReference.js";
import { formatLibraryPerformanceForPrompt, getScriptInsights } from "./libraryPerformance.js";
import { requestAgentTask } from "./tiktokAgent.js";
import { formatInspirationRules } from "./referenceAdaptation.js";
import { buildLibraryContextBlock } from "./libraryContext.js";
import { getProductResearchContext, researchProduct } from "./productResearch.js";
import { formatProductPackagingForPrompt, PACKAGING_KNOWLEDGE } from "./productPackaging.js";
import { synthesizeSpeech } from "./elevenlabs.js";
import { emitAgentSessionStatus } from "./agentSessionStatus.js";

export type ScriptRequest = {
  productId: string;
  durationSeconds?: number;
  referenceLibraryId?: string;
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
  cost?: import("./agentPricing.js").AgentCostBreakdown;
};

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

  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === req.productId);
  if (!product) throw new Error("Product not found.");

  if (!product.research_completed_at) {
    emitAgentSessionStatus({
      active: true,
      phase: "running",
      message: "Researching product packaging (one-time)…",
      task: "analyze_data",
      at: new Date().toISOString(),
    });
    await researchProduct(store, req.productId);
  }

  const insights = getScriptInsights(store);
  const referenceId = req.referenceLibraryId || insights.recommendedReferenceId || undefined;
  const pacingRef = findPacingReference(store, referenceId);
  const performanceBlock = formatLibraryPerformanceForPrompt(store);
  const pacingBlock = formatPacingBlock(pacingRef);
  const libraryBlock = buildLibraryContextBlock(store, 10);
  const packagingBlock = formatProductPackagingForPrompt(product);
  const researchBlock = getProductResearchContext(store, req.productId);
  const duration = req.durationSeconds || 45;
  const inferredHookType = insights.recommendedHookType;

  const instructions = `You are an expert TikTok Shop affiliate scriptwriter for UK creators.

${formatInspirationRules()}

${PACKAGING_KNOWLEDGE}

Rules:
- Read library stats and SEPARATED hooks (on-screen, audio, visual) — adapt structure only.
- Mirror top-performing speaking PACE in SSML (breaks, prosody) from reference pacing data.
- Use correct container nouns (tub, bottle, can, bag) for this product when showing/holding it.
- Never copy competitor products, backgrounds, or props from library videos.

Return JSON only:
{
  "title": "Script title",
  "fullAudioScript": "Complete spoken voiceover word-for-word",
  "ssml": "<speak>...ElevenLabs SSML with <break time=\\"300ms\\"/> pacing from top performers...</speak>",
  "onScreenCaption": "On-screen text overlay for the video (or empty string)",
  "tiktokCaption": "Full TikTok post caption with hashtags, ready to paste"
}`;

  const context = `${performanceBlock}

${libraryBlock}

${pacingBlock ? `${pacingBlock}\n\n` : ""}## Product to sell
- Name: ${product.name}
- Brand: ${product.brand || "—"}
- Price: ${product.price || "—"}
- Notes: ${product.description || "—"}
- ${packagingBlock}
${researchBlock ? `- ${researchBlock}` : ""}

## Target length
~${duration} seconds at the same speaking pace as the reference video.`;

  const { reply: raw, cost } = await requestAgentTask(store, "generate_script", instructions, context);
  const parsed = parseScriptResponse(raw);
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  let audioPath: string | undefined;
  if (store.getSetting("elevenLabsApiKey") && store.getSetting("elevenLabsVoiceId")) {
    try {
      const audioDir = path.join(app.getPath("userData"), "audio");
      const audio = await synthesizeSpeech(store, {
        text: parsed.script,
        ssml: parsed.ssml,
        scriptId: id,
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
    cost,
  };
}
