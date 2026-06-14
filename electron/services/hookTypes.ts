import type { JsonStore } from "../db.js";
import { buildMemorySummary } from "./memoryInsights.js";

export const HOOK_TYPES = [
  "question",
  "bold claim",
  "story",
  "fear",
  "curiosity gap",
  "social proof",
  "pattern interrupt",
  "destruction",
  "reveal",
  "transformation",
  "controversy",
] as const;

export type HookType = (typeof HOOK_TYPES)[number];

export const HOOK_GUIDE: Record<string, string> = {
  question:
    "Open with a direct question that names the viewer's pain or desire. Answer it through the demo. End with shop CTA.",
  "bold claim":
    "Lead with a polarizing or surprising statement in the first second. Prove it fast with product proof. CTA with urgency.",
  story:
    "Personal mini-story in first 5 seconds (problem → discovery). Weave product naturally. Soft then hard CTA.",
  fear:
    "Agitate a mistake or missed opportunity (FOMO/regret). Present product as the fix. Strong close on why waiting costs them.",
  "curiosity gap":
    "Tease an outcome without revealing it ('wait until you see…'). Delay product reveal. Pay off curiosity then convert.",
  "social proof":
    "Lead with results, reviews, viral proof, or 'everyone is buying this'. Stack evidence. CTA as joining the crowd.",
  "pattern interrupt":
    "Unexpected visual or verbal pattern break in second 0–1. Reset attention. Quick pivot to product value.",
  destruction:
    "Call out what NOT to buy / what failed before. Position your product as the smarter alternative.",
  reveal:
    "Build to a reveal moment (unboxing, before/after, price drop). Time the product show for max impact.",
  transformation:
    "Before/after arc — show change the product enables. Emotional payoff then purchase push.",
  controversy:
    "Hot take or myth-bust hook. Back with demo facts. CTA framed as the smart contrarian move.",
};

function normalizeHookType(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function displayLabel(type: string): string {
  return type
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export type HookTypeOption = {
  id: string;
  label: string;
  wins: number;
  exampleHooks: string[];
  guide: string;
};

export function listHookTypesForScripts(store: JsonStore): HookTypeOption[] {
  const summary = buildMemorySummary(store);
  const examples: Record<string, string[]> = {};

  for (const pattern of summary.topPatterns) {
    const type = normalizeHookType(pattern.hookType || "");
    if (!type || !pattern.hook) continue;
    if (!examples[type]) examples[type] = [];
    if (examples[type].length < 3) examples[type].push(pattern.hook);
  }

  const libraryRows = store.list<{ payload_json: string; hook_type: string | null }>("library_items");
  for (const row of libraryRows) {
    let item: Record<string, unknown> = {};
    try {
      item = JSON.parse(row.payload_json);
    } catch {
      continue;
    }
    const type = normalizeHookType(String(row.hook_type || item.hook_type || ""));
    const hd = (item.hook_detail as Record<string, unknown>) || {};
    const hook = String(hd.text || item.hook || "").trim();
    if (!type || !hook) continue;
    if (!examples[type]) examples[type] = [];
    if (examples[type].length < 5 && !examples[type].includes(hook)) {
      examples[type].push(hook);
    }
  }

  const options: HookTypeOption[] = HOOK_TYPES.map((type) => {
    const key = normalizeHookType(type);
    const wins =
      summary.hookTypeWins[key] ||
      summary.hookTypeWins[type] ||
      Object.entries(summary.hookTypeWins).find(([k]) => normalizeHookType(k) === key)?.[1] ||
      0;
    return {
      id: type,
      label: displayLabel(type),
      wins,
      exampleHooks: examples[key] || examples[type] || [],
      guide: HOOK_GUIDE[type] || HOOK_GUIDE["bold claim"],
    };
  });

  options.sort((a, b) => b.wins - a.wins);
  return options;
}

export function formatHookMemoryBlock(store: JsonStore, hookType: string): string {
  const summary = buildMemorySummary(store);
  const normalized = normalizeHookType(hookType);
  const lines = [
    "## Full performance memory (use everything relevant)",
    `- Entries: ${summary.totalMemoryEntries} · Avg rating ${summary.avgRating.toFixed(1)}/5`,
    `- Avg views on your copies: ${Math.round(summary.avgMyViews).toLocaleString()}`,
    `- Avg GMV: £${summary.avgMyGmv.toFixed(2)}`,
    "",
    "## Top winning patterns across all hook types",
  ];

  summary.topPatterns.slice(0, 15).forEach((p, i) => {
    lines.push(
      `${i + 1}. [${p.hookType || "hook"}] "${p.hook}"` +
        (p.whatWorked ? ` → ${p.whatWorked}` : "") +
        (p.myGmv ? ` · £${p.myGmv} GMV` : "") +
        (p.rating ? ` · ${p.rating}/5` : "")
    );
  });

  const typeExamples = summary.topPatterns.filter(
    (p) => p.hookType && normalizeHookType(p.hookType) === normalized
  );
  if (typeExamples.length) {
    lines.push("", `## Winning "${displayLabel(normalized)}" examples from your data`);
    typeExamples.slice(0, 8).forEach((p, i) => {
      lines.push(`${i + 1}. "${p.hook}"${p.whatWorked ? ` — ${p.whatWorked}` : ""}`);
    });
  }

  return lines.join("\n");
}
