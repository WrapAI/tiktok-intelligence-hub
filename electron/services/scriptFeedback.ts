import { randomUUID } from "node:crypto";
import type { JsonStore } from "../db.js";

const SECTIONS = ["audio", "on_screen_caption", "tiktok_caption", "pace"] as const;
const LABELS: Record<(typeof SECTIONS)[number], string> = {
  audio: "Audio script",
  on_screen_caption: "On-screen caption",
  tiktok_caption: "TikTok caption + hashtags",
  pace: "Pace (SSML)",
};

type ScriptFeedbackRow = {
  title?: string;
  hook_type?: string;
  created_at?: string;
  script_text?: string;
  on_screen_caption?: string;
  tiktok_caption?: string;
  ssml?: string;
  section_feedback?: Partial<
    Record<
      (typeof SECTIONS)[number],
      { rating: string; reason?: string; notes?: string }
    >
  >;
};

function sectionSnippet(script: ScriptFeedbackRow, section: (typeof SECTIONS)[number]): string {
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

function ratedScripts(store: JsonStore): ScriptFeedbackRow[] {
  return store
    .list<ScriptFeedbackRow>("scripts")
    .filter((s) => {
      const sf = s.section_feedback || {};
      return SECTIONS.some((sec) => sf[sec]?.rating);
    })
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, 6);
}

export function formatScriptFeedbackForPrompt(store: JsonStore): string {
  const scripts = ratedScripts(store);
  if (!scripts.length) return "";

  const lines: string[] = [
    "# Creator script section feedback",
    "",
    "Hard constraints from Script Writer ratings.",
    "LIKED = technique works — still vary opening lines, discount frames, and wording each new script.",
    "",
  ];

  for (const script of scripts) {
    const sf = script.section_feedback || {};
    lines.push(`## ${script.title || "Script"} (${script.hook_type || "—"})`);
    for (const section of SECTIONS) {
      const entry = sf[section];
      if (!entry?.rating) continue;
      const label = LABELS[section];
      const snippet = sectionSnippet(script, section);
      if (entry.rating === "liked") {
        lines.push(`- **${label} — LIKED** (technique validated — vary execution each time): ${snippet.slice(0, 200)}`);
      } else if (entry.rating === "disliked") {
        lines.push(
          `- **${label} — DISLIKED** (never repeat): ${entry.reason || "—"}\n  Was: ${snippet.slice(0, 150)}`
        );
      } else if (entry.rating === "keep_with_notes") {
        lines.push(`- **${label} — KEEP but note:** ${entry.notes || "—"}\n  Current: ${snippet.slice(0, 150)}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatDislikedFeedbackInject(store: JsonStore): string {
  const scripts = ratedScripts(store);
  const lines: string[] = [];

  for (const script of scripts) {
    const sf = script.section_feedback || {};
    const scriptTitle = script.title || "Script";
    for (const section of SECTIONS) {
      const entry = sf[section];
      if (entry?.rating !== "disliked") continue;
      const snippet = sectionSnippet(script, section).slice(0, 200);
      lines.push(`BANNED OUTPUT → "${snippet}"`);
      lines.push(`REASON → ${entry.reason || "—"}`);
      lines.push(`USE INSTEAD → Follow REASON — write a completely different ${LABELS[section].toLowerCase()} (${scriptTitle})`);
      lines.push("");
    }
  }

  if (!lines.length) return "(No disliked section feedback recorded yet.)";
  return lines.join("\n").trim();
}

export function formatKeepNotesInject(store: JsonStore): string {
  const scripts = ratedScripts(store);
  const lines: string[] = [];

  for (const script of scripts) {
    const sf = script.section_feedback || {};
    const scriptTitle = script.title || "Script";
    for (const section of SECTIONS) {
      const entry = sf[section];
      if (entry?.rating !== "keep_with_notes") continue;
      lines.push(`- **${LABELS[section]}** (${scriptTitle}): ${entry.notes || "—"}`);
    }
  }

  if (!lines.length) return "";
  return `### Section notes marked "keep"\n\n${lines.join("\n")}`;
}

export function formatScriptFeedbackForSystemPrompt(store: JsonStore): string {
  const disliked = formatDislikedFeedbackInject(store);
  const keep = formatKeepNotesInject(store);
  const lessons = formatValidationLessonsInject(store);
  const parts = [disliked, keep, lessons].filter(
    (p) => p && !p.startsWith("(No ")
  );
  if (!parts.length) return "";
  return parts.join("\n\n");
}

export type ValidationLessonRow = {
  id: string;
  created_at: string;
  product_id?: string;
  product_name?: string;
  title?: string;
  script_snippet: string;
  violations: string[];
};

function violationFixHint(violation: string): string {
  if (violation.startsWith("HOOK TOO LONG")) {
    return "Shorten LINE 1 to 7 words max (countdown hooks starting with Not are exempt).";
  }
  if (violation.startsWith("PRODUCT NAME REPEATED")) {
    return 'Say the full product name once, then use "it", "this", "the kit", or "the bundle".';
  }
  if (violation.startsWith("REPEATED PHRASE DETECTED")) {
    return "Cut the duplicate phrase — every 4-word sequence should appear once only.";
  }
  if (violation.includes("don't buy this")) {
    return 'Say "don\'t buy this" once only in the hook.';
  }
  return "Remove the banned language and rewrite that section.";
}

export function recordValidationLesson(
  store: JsonStore,
  input: {
    productId?: string;
    productName?: string;
    title?: string;
    scriptText: string;
    violations: string[];
  }
): void {
  const snippet = String(input.scriptText || "").slice(0, 400);
  const violations = [...new Set(input.violations.map((v) => String(v).trim()).filter(Boolean))];
  if (!snippet || !violations.length) return;

  const key = `${snippet.slice(0, 120)}::${violations.join("|")}`;
  const existing = store.list<ValidationLessonRow>("validation_lessons");
  if (
    existing.some(
      (row) =>
        `${row.script_snippet.slice(0, 120)}::${(row.violations || []).join("|")}` === key
    )
  ) {
    return;
  }

  store.upsertById("validation_lessons", {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    product_id: input.productId || "",
    product_name: input.productName || "",
    title: input.title || "",
    script_snippet: snippet,
    violations,
  });

  const sorted = store
    .list<ValidationLessonRow>("validation_lessons")
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const row of sorted.slice(20)) {
    store.deleteById("validation_lessons", row.id);
  }
}

/** Logged to validation_lessons → /hub/script_feedback.md on memory sync. */
export function recordHookFallbackLesson(
  store: JsonStore,
  input: {
    productId?: string;
    productName?: string;
    title?: string;
    originalHook: string;
    forcedHook: string;
    violations: string[];
  }
): void {
  recordValidationLesson(store, {
    productId: input.productId,
    productName: input.productName,
    title: input.title,
    scriptText: `Hook auto-fallback: "${input.originalHook.slice(0, 120)}" → "${input.forcedHook}"`,
    violations: [
      ...input.violations.filter((v) => v.startsWith("HOOK TOO LONG")),
      `HOOK FALLBACK: forced safe hook "${input.forcedHook}" after 2 failed API attempts`,
    ],
  });
}

export function formatValidationLessonsInject(store: JsonStore): string {
  const lessons = store
    .list<ValidationLessonRow>("validation_lessons")
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 12);

  if (!lessons.length) {
    return "(No auto-rejected validation lessons yet.)";
  }

  const lines: string[] = [];
  for (const lesson of lessons) {
    const snippet = lesson.script_snippet.slice(0, 200);
    lines.push(`AUTO-REJECTED BY VALIDATOR → "${snippet}"`);
    lines.push(`VIOLATIONS → ${(lesson.violations || []).join("; ")}`);
    const fixes = (lesson.violations || []).map(violationFixHint);
    lines.push(`FIX NEXT TIME → ${[...new Set(fixes)].join(" ")}`);
    if (lesson.product_name) lines.push(`PRODUCT → ${lesson.product_name}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function formatScriptFeedbackForScriptPrompt(store: JsonStore): string {
  return formatScriptFeedbackForSystemPrompt(store);
}
