import { randomUUID } from "node:crypto";
import type { JsonStore } from "../db.js";
import { findPacingReference, formatPacingBlock } from "./pacingReference.js";
import { formatLibraryPerformanceForPrompt, getScriptInsights } from "./libraryPerformance.js";
import { callClaude } from "./claude.js";

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
};

function parseScriptResponse(raw: string): { title: string; script: string; ssml: string } {
  const titleMatch = raw.match(/^#\s*(.+)$/m);
  const title = titleMatch?.[1]?.trim() || "Untitled script";
  const ssmlMatch = raw.match(/```ssml\n([\s\S]*?)```/i);
  const ssml = ssmlMatch?.[1]?.trim() || "";
  let script = raw;
  if (ssmlMatch) script = script.replace(ssmlMatch[0], "").trim();
  script = script.replace(/^#\s*.+\n?/m, "").trim();
  return { title, script, ssml };
}

export async function generateScript(store: JsonStore, req: ScriptRequest): Promise<ScriptResult> {
  const apiKey = store.getSetting("anthropicApiKey");
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings first.");

  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === req.productId);
  if (!product) throw new Error("Product not found.");

  const insights = getScriptInsights(store);
  const referenceId = req.referenceLibraryId || insights.recommendedReferenceId || undefined;
  const pacingRef = findPacingReference(store, referenceId);
  const performanceBlock = formatLibraryPerformanceForPrompt(store);
  const pacingBlock = formatPacingBlock(pacingRef);
  const duration = req.durationSeconds || 45;
  const inferredHookType = insights.recommendedHookType;

  const system = `You are an expert TikTok Shop affiliate scriptwriter for UK creators.
Write spoken-word voiceover scripts optimized for ElevenLabs TTS.

Rules:
- Read the library performance stats (views, likes, comments, shares, saves) and infer the best hook structure yourself.
- Do NOT ask the creator to choose a hook type — decide from the data.
- Mirror the reference video's speaking SPEED and pause rhythm in your SSML (same beat structure, new words).
- SSML must use ElevenLabs-compatible tags: <break time="Xms"/>, <prosody rate="fast|slow|medium">, <emphasis level="strong">.
- Match timestamp pacing from the reference when provided — same gaps between beats, same fast/slow sections.

Output format:
# Script title

## Voiceover script
(spoken lines with [VISUAL: ...] cues where helpful)

## Hook (first 3 seconds)
(exact opening line — derived from top-performing library patterns)

## CTA
(closing shop link push)

\`\`\`ssml
(Full ElevenLabs SSML for the entire script — pacing must match the reference video speed)
\`\`\``;

  const user = `${performanceBlock}

${pacingBlock ? `${pacingBlock}\n\n` : ""}## Product to sell
- Name: ${product.name}
- Brand: ${product.brand || "—"}
- Price: ${product.price || "—"}
- Notes: ${product.description || "—"}

## Target length
~${duration} seconds at the same speaking pace as the reference video.

Write one complete script for this product using the highest-performing patterns from the library stats.
Adapt tactics — do not copy competitor scripts verbatim.`;

  const model = store.getSetting("anthropicModel", "claude-sonnet-4-6");
  const raw = await callClaude(apiKey, system, user, model);
  const parsed = parseScriptResponse(raw);
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  store.upsertById("scripts", {
    id,
    product_id: req.productId,
    hook_type: inferredHookType,
    funnel_style: inferredHookType,
    title: parsed.title,
    script_text: parsed.script,
    ssml: parsed.ssml,
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
  };
}
