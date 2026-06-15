import type { JsonStore } from "../db.js";
import { computeEngagementScore } from "./libraryPerformance.js";
import { formatInspirationRules } from "./referenceAdaptation.js";

export type FunnelBucket = "top" | "middle" | "bottom";

export type FunnelReference = {
  libraryId: string;
  funnelLabel: string;
  bucket: FunnelBucket;
  hookType: string;
  hookText: string;
  visualHook: string;
  primaryReason: string;
  replicationNotes: string;
  visualTactics: string[];
  videoArc: string[];
  engagementScore: number;
  replicationScore: number;
};

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function normalizeFunnelBucket(funnel: string): FunnelBucket {
  const f = funnel.toLowerCase();
  if (f.includes("bottom")) return "bottom";
  if (f.includes("top") && !f.includes("middle") && !f.includes("mid")) return "top";
  if (f.includes("top") && (f.includes("mid") || f.includes("middle"))) return "top";
  if (f.includes("middle") && f.includes("bottom")) return "bottom";
  if (f.includes("middle") || f.includes("mid")) return "middle";
  return "middle";
}

export function funnelBucketLabel(bucket: FunnelBucket): string {
  if (bucket === "top") return "Top Funnel";
  if (bucket === "middle") return "Middle Funnel";
  return "Bottom Funnel";
}

function extractVisualTactics(item: Record<string, unknown>): string[] {
  const tactics: string[] = [];
  const flat = item.visual_tactics;
  if (Array.isArray(flat)) {
    for (const t of flat) tactics.push(String(t));
  }
  const detail = item.visual_tactics_detail as Record<string, unknown> | undefined;
  if (detail && Array.isArray(detail.tactics)) {
    for (const t of detail.tactics) {
      if (typeof t === "string") tactics.push(t);
      else if (t && typeof t === "object" && "description" in t) {
        tactics.push(String((t as { description: string }).description));
      }
    }
  }
  return tactics.filter(Boolean).slice(0, 6);
}

function extractVideoArc(item: Record<string, unknown>): string[] {
  const arc = item.video_arc;
  if (!Array.isArray(arc)) return [];
  return arc
    .map((beat) => {
      if (typeof beat === "string") return beat;
      if (beat && typeof beat === "object") {
        const b = beat as Record<string, unknown>;
        const time = b.timestamp || b.time || "";
        const action = b.action || b.description || b.beat || "";
        return time ? `${time}: ${action}` : String(action);
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function buildFunnelKnowledge(store: JsonStore): Record<FunnelBucket, FunnelReference[]> {
  const rows = store.list<{
    id: string;
    payload_json: string;
    hook_type: string | null;
    funnel_category: string | null;
  }>("library_items");

  const byBucket: Record<FunnelBucket, FunnelReference[]> = {
    top: [],
    middle: [],
    bottom: [],
  };

  for (const row of rows) {
    const item = parsePayload(row.payload_json);
    const funnelLabel = String(row.funnel_category || item.funnel_category || item.funnel_class || "");
    const bucket = normalizeFunnelBucket(funnelLabel);
    const hookDetail = (item.hook_detail as Record<string, unknown>) || {};
    const wtw = (item.why_this_worked as Record<string, unknown>) || {};
    const videoData = (item.videoData as Record<string, unknown>) || {};
    const stats = (videoData.stats as Record<string, unknown>) || videoData;

    const views = Number(stats.views ?? item.view_count_at_scan ?? 0) || 0;
    const likes = Number(stats.likes ?? 0) || 0;
    const comments = Number(stats.comments ?? 0) || 0;
    const shares = Number(stats.shares ?? stats.reposts ?? 0) || 0;
    const saves = Number(stats.saves ?? 0) || 0;

    byBucket[bucket].push({
      libraryId: row.id,
      funnelLabel: funnelLabel || funnelBucketLabel(bucket),
      bucket,
      hookType: String(row.hook_type || item.hook_type || hookDetail.hook_type || ""),
      hookText: String(hookDetail.text || item.hook || "").trim(),
      visualHook: String(hookDetail.visual_action || "").trim(),
      primaryReason: String(wtw.primary_reason || ""),
      replicationNotes: String(wtw.replication_notes || ""),
      visualTactics: extractVisualTactics(item),
      videoArc: extractVideoArc(item),
      engagementScore: computeEngagementScore({ views, likes, comments, shares, saves }),
      replicationScore: Number(wtw.replication_score) || 0,
    });
  }

  for (const bucket of Object.keys(byBucket) as FunnelBucket[]) {
    byBucket[bucket].sort(
      (a, b) => b.engagementScore - a.engagementScore || b.replicationScore - a.replicationScore
    );
  }

  return byBucket;
}

export function pickReference(
  knowledge: Record<FunnelBucket, FunnelReference[]>,
  bucket: FunnelBucket,
  index: number
): FunnelReference | null {
  const pool = knowledge[bucket];
  if (!pool.length) {
    const fallback = (["bottom", "middle", "top"] as FunnelBucket[]).find((b) => knowledge[b].length);
    if (!fallback) return null;
    const alt = knowledge[fallback];
    return alt[index % alt.length] || alt[0];
  }
  return pool[index % pool.length] || pool[0];
}

export function formatFunnelKnowledgeBlock(knowledge: Record<FunnelBucket, FunnelReference[]>): string {
  const lines: string[] = [
    formatInspirationRules(),
    "",
    "## Competitor video patterns from your library analyses (by funnel)",
    "Use these for hook structure and visual technique only — always with YOUR product, not theirs.",
  ];
  for (const bucket of ["top", "middle", "bottom"] as FunnelBucket[]) {
    const label = funnelBucketLabel(bucket);
    const refs = knowledge[bucket].slice(0, 4);
    lines.push("", `### ${label}`);
    if (!refs.length) {
      lines.push("(No library videos tagged for this funnel yet — import library.json)");
      continue;
    }
    refs.forEach((ref, i) => {
      lines.push(
        `${i + 1}. Hook (${ref.hookType}): ${ref.hookText || ref.visualHook || "visual hook"}`,
        `   Why it worked: ${ref.primaryReason.slice(0, 180) || ref.replicationNotes.slice(0, 180)}`,
        ref.visualTactics.length ? `   Visual tactics: ${ref.visualTactics.slice(0, 3).join("; ")}` : ""
      );
    });
  }
  return lines.filter(Boolean).join("\n");
}
