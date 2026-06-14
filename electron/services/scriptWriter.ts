import { randomUUID } from "node:crypto";
import type { JsonStore } from "../db.js";
import { findPacingReference, formatPacingBlock } from "./pacingReference.js";
import { formatHookMemoryBlock, HOOK_GUIDE, listHookTypesForScripts } from "./hookTypes.js";
import { callClaude } from "./claude.js";

export type ScriptRequest = {
  hookType: string;
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

  const hookType = req.hookType?.trim();
  if (!hookType) throw new Error("Select a hook type.");

  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === req.productId);
  if (!product) throw new Error("Product not found.");

  const hookOptions = listHookTypesForScripts(store);
  const selected = hookOptions.find((h) => h.id === hookType) || hookOptions[0];
  const guide = HOOK_GUIDE[hookType] || selected?.guide || HOOK_GUIDE["bold claim"];

  const memoryBlock = formatHookMemoryBlock(store, hookType);
  const pacingRef = findPacingReference(store, req.referenceLibraryId);
  const pacingBlock = formatPacingBlock(pacingRef);
  const duration = req.durationSeconds || 45;

  const system = `You are an expert TikTok Shop affiliate scriptwriter for UK creators.
Write spoken-word voiceover scripts optimized for ElevenLabs recording.
You must write in the specified HOOK TYPE mechanics — do not ask the creator for inspiration; use the memory data provided.
Combine patterns from ALL winning memory entries, prioritising the selected hook type.
When reference pacing is provided, mirror the same timestamp rhythm (pauses, fast/slow beats).
Output format:
# Script title

## Voiceover script
(spoken lines with [VISUAL: ...] cues where helpful)

## Hook (first 3 seconds)
(exact opening line — must match the hook type)

## CTA
(closing shop link push)

\`\`\`ssml
(ElevenLabs SSML — use <break time="Xms"/> and <prosody rate="fast|slow"> matching reference pacing)
\`\`\``;

  const user = `${memoryBlock}

${pacingBlock ? `${pacingBlock}\n\n` : ""}## Product
- Name: ${product.name}
- Brand: ${product.brand || "—"}
- Price: ${product.price || "—"}
- Notes: ${product.description || "—"}

## Hook type to write: ${selected?.label || hookType}
${guide}

${selected?.exampleHooks?.length ? `### Example hooks of this type from your winning videos\n${selected.exampleHooks.map((h) => `- "${h}"`).join("\n")}` : ""}

## Target length
~${duration} seconds spoken at natural TikTok pace.

Write one complete script. Adapt winning mechanics from memory — do not copy competitor scripts verbatim.`;

  const raw = await callClaude(apiKey, system, user);
  const parsed = parseScriptResponse(raw);
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  store.upsertById("scripts", {
    id,
    product_id: req.productId,
    hook_type: hookType,
    funnel_style: hookType,
    title: parsed.title,
    script_text: parsed.script,
    ssml: parsed.ssml,
    prompt_context: JSON.stringify({
      hookType,
      referenceLibraryId: pacingRef?.libraryId || req.referenceLibraryId || null,
    }),
    reference_library_id: pacingRef?.libraryId || req.referenceLibraryId || null,
    created_at: createdAt,
  });

  return {
    id,
    title: parsed.title,
    script: parsed.script,
    ssml: parsed.ssml,
    hookType,
    productId: req.productId,
    referenceLibraryId: pacingRef?.libraryId || req.referenceLibraryId,
    createdAt,
  };
}
