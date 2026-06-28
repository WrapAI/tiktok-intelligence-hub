import type { JsonStore } from "../db.js";
import type { HookTypeStat } from "./libraryPerformance.js";
import type { PacingReference } from "./pacingReference.js";

const DISCOUNT_CUES = [
  { id: "reverse_psych", re: /\b(don'?t buy|do not buy|stop buying)\b/i, label: "reverse-psych / don't buy" },
  { id: "countdown", re: /\b(countdown|running out|won'?t last|ends tonight|limited time)\b/i, label: "countdown / limited time" },
  { id: "percent_off", re: /\b\d+%\s*off|\bhalf\s*price\b/i, label: "percentage / half price" },
  { id: "bundle", re: /\b(bundle|deal|two for|buy one get|extra free)\b/i, label: "bundle deal" },
  { id: "mistake", re: /\b(mistake|wish i knew|nobody told me|i wish)\b/i, label: "mistake confession" },
  { id: "social_proof", re: /\b(sold out|viral|everyone|trending|flying off)\b/i, label: "social proof / viral" },
  { id: "honest_urgency", re: /\b(honest(ly)?|not sure how long|while it'?s still)\b/i, label: "honest urgency" },
];

function weightedPick<T>(items: T[], weightFn: (item: T) => number): T | null {
  if (!items.length) return null;
  const weights = items.map((item) => Math.max(0.1, weightFn(item)));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function normalizeHookKey(h: string): string {
  return h.toLowerCase().replace(/_/g, " ").trim();
}

export function pickHookTypeForScript(
  stats: HookTypeStat[],
  recentHookTypes: string[]
): { hookType: string; poolSize: number } {
  if (!stats.length) {
    return { hookType: "pattern interrupt", poolSize: 0 };
  }

  const recent = new Set(recentHookTypes.map(normalizeHookKey));
  let pool = stats;
  if (stats.length > 2) {
    const fresh = stats.filter((s) => !recent.has(normalizeHookKey(s.hookType)));
    if (fresh.length) pool = fresh;
  }

  const picked = weightedPick(pool, (s) => Math.sqrt(Math.max(1, s.avgEngagement)));
  return {
    hookType: picked?.hookType || stats[0].hookType,
    poolSize: pool.length,
  };
}

export function getRecentScriptContext(
  store: JsonStore,
  productId: string,
  limit = 8
): {
  hookTypes: string[];
  pacingIds: string[];
  openings: string[];
  onScreenHooks: string[];
  discountCues: string[];
} {
  const rows = store
    .list<{
      product_id: string;
      hook_type: string;
      script_text: string;
      on_screen_caption: string;
      prompt_context: string;
      created_at: string;
    }>("scripts")
    .filter((s) => s.product_id === productId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);

  const hookTypes: string[] = [];
  const pacingIds: string[] = [];
  const openings: string[] = [];
  const onScreenHooks: string[] = [];
  const discountCueSet = new Set<string>();

  for (const row of rows) {
    if (row.hook_type) hookTypes.push(row.hook_type);
    try {
      const ctx = JSON.parse(row.prompt_context || "{}") as { referenceLibraryId?: string };
      if (ctx.referenceLibraryId) pacingIds.push(ctx.referenceLibraryId);
    } catch {
      /* ignore */
    }
    const script = String(row.script_text || "").trim();
    if (script) openings.push(script.slice(0, 120).replace(/\s+/g, " "));
    const cap = String(row.on_screen_caption || "").trim();
    if (cap) onScreenHooks.push(cap.slice(0, 80));
    const combined = `${script} ${cap}`.toLowerCase();
    for (const cue of DISCOUNT_CUES) {
      if (cue.re.test(combined)) discountCueSet.add(cue.label);
    }
  }

  return { hookTypes, pacingIds, openings, onScreenHooks, discountCues: [...discountCueSet] };
}

export function buildVarietyDirectiveBlock(opts: {
  selectedHookType: string;
  hookPoolSize: number;
  pacingRef: PacingReference | null;
  recent: ReturnType<typeof getRecentScriptContext>;
  alternateHookTypes: string[];
}): string {
  const lines = [
    "## THIS SCRIPT — variety assignment (mandatory)",
    "",
    "You are A/B testing formats for the same product. Each script must feel like a **different video type**, not a light rewrite.",
    "Creator rules and disliked feedback in the system prompt override this assignment if they conflict.",
    "",
    `**Hook approach for this script:** "${opts.selectedHookType}" (picked from ${opts.hookPoolSize || 1} performance-weighted options — not always the #1 stat).`,
  ];

  if (opts.alternateHookTypes.length) {
    lines.push(
      `Other strong hook types in library (use on future scripts, not all at once here): ${opts.alternateHookTypes.slice(0, 5).join(", ")}.`
    );
  }

  if (opts.pacingRef) {
    lines.push(
      `**Pacing reference:** match speaking speed and SSML break rhythm from the reference video — but use a **new** opening line and structure.`
    );
  }

  lines.push(
    "",
    "### Do NOT repeat from recent scripts for this product",
    "Change the hook opening, on-screen text pattern, discount frame, and story angle."
  );

  if (opts.recent.openings.length) {
    lines.push("", "**Recent audio openings (do not echo):**");
    opts.recent.openings.slice(0, 5).forEach((o, i) => lines.push(`${i + 1}. "${o}…"`));
  }
  if (opts.recent.onScreenHooks.length) {
    lines.push("", "**Recent on-screen hooks (use different wording):**");
    opts.recent.onScreenHooks.slice(0, 5).forEach((o, i) => lines.push(`${i + 1}. "${o}"`));
  }
  if (opts.recent.discountCues.length) {
    lines.push(
      "",
      `**Discount / urgency frames already used recently (pick a different one):** ${opts.recent.discountCues.join(", ")}.`
    );
    lines.push(
      "Choose a fresh frame e.g. curiosity tease, mistake confession, bundle value, social proof count, honest scarcity, question hook — not the same frame as above."
    );
  }

  if (opts.recent.hookTypes.length >= 3) {
    const same = opts.recent.hookTypes.slice(0, 3).every(
      (h) => normalizeHookKey(h) === normalizeHookKey(opts.recent.hookTypes[0])
    );
    if (same) {
      lines.push(
        "",
        `Warning: last scripts all used "${opts.recent.hookTypes[0]}" — you MUST differentiate structure and opening even within this hook type.`
      );
    }
  }

  return lines.join("\n");
}

export const SCRIPT_VARIETY_INSTRUCTIONS = `Variety rules (apply only where they do NOT conflict with creator rules or disliked script feedback above):
- Performance data guides WHICH families work — rotate hook types, discount frames, and story angles across scripts.
- "Liked" feedback means the technique works — still write a NEW opening and different discount mechanic each time.
- Never produce the same "don't buy this" / bundle / countdown script with swapped product words.
- Vary: question vs statement hooks, confession vs curiosity, demo vs story, soft tease vs hard urgency.
- On-screen caption must not reuse phrasing from recent scripts listed below.`;
