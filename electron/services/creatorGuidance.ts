import { randomUUID } from "node:crypto";
import type { JsonStore } from "../db.js";

export type CreatorGuidanceKind = "rule" | "idea";

export type CreatorGuidanceEntry = {
  id: string;
  kind: CreatorGuidanceKind;
  text: string;
  created_at: string;
};

export function listCreatorGuidance(store: JsonStore): CreatorGuidanceEntry[] {
  return store
    .list<CreatorGuidanceEntry>("creator_guidance")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function addCreatorGuidance(
  store: JsonStore,
  kind: CreatorGuidanceKind,
  text: string
): CreatorGuidanceEntry {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Enter some text first.");
  const entry: CreatorGuidanceEntry = {
    id: randomUUID(),
    kind,
    text: trimmed,
    created_at: new Date().toISOString(),
  };
  store.upsertById("creator_guidance", entry);
  return entry;
}

export function deleteCreatorGuidance(store: JsonStore, id: string): void {
  store.deleteById("creator_guidance", id);
}

export function formatCreatorGuidanceMarkdown(store: JsonStore): string {
  const entries = listCreatorGuidance(store);
  if (!entries.length) {
    return "# Creator rules & ideas\n\nNo custom rules or ideas saved yet — add them in TikTok Agent.";
  }

  const rules = entries.filter((e) => e.kind === "rule");
  const ideas = entries.filter((e) => e.kind === "idea");

  const lines = [
    "# Creator rules & ideas",
    "",
    "Hard constraints and creative direction from the creator. Follow on every script, plan, and chat reply.",
    "",
  ];

  if (rules.length) {
    lines.push("## Rules (always follow)", "");
    for (const r of rules) {
      lines.push(`- ${r.text} _(added ${r.created_at.slice(0, 10)})_`);
    }
    lines.push("");
  }

  if (ideas.length) {
    lines.push("## Ideas (consider when relevant)", "");
    for (const i of ideas) {
      lines.push(`- ${i.text} _(added ${i.created_at.slice(0, 10)})_`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatCreatorGuidanceRulesInject(store: JsonStore): string {
  const entries = listCreatorGuidance(store).filter((e) => e.kind === "rule");
  if (!entries.length) return "(No creator rules saved yet — add rules in TikTok Agent.)";
  return entries.map((r) => `- ${r.text}`).join("\n");
}

export function formatCreatorGuidanceForSystemPrompt(store: JsonStore): string {
  const entries = listCreatorGuidance(store);
  if (!entries.length) return "";

  const rules = entries.filter((e) => e.kind === "rule");
  const ideas = entries.filter((e) => e.kind === "idea");

  const lines = [
    "## CREATOR RULES & IDEAS — MANDATORY",
    "",
    "Saved by the creator in TikTok Agent. Rules MUST be followed on every script.",
    "If library stats, pacing reference, or variety assignment conflict with a rule, the rule wins.",
    "",
  ];

  if (rules.length) {
    lines.push("### Rules (always follow — non-negotiable)", "");
    for (const r of rules) {
      lines.push(`- ${r.text}`);
    }
    lines.push("");
  }

  if (ideas.length) {
    lines.push("### Ideas (use when relevant to this product/script)", "");
    for (const i of ideas) {
      lines.push(`- ${i.text}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatCreatorGuidanceForPrompt(store: JsonStore): string {
  return formatCreatorGuidanceForSystemPrompt(store);
}
