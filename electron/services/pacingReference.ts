import type { JsonStore } from "../db.js";
import { computeEngagementScore } from "./libraryPerformance.js";

export type PacingReference = {
  libraryId: string;
  hook: string;
  pacingTranscript: string;
  ssml: string;
  replicationScore: number;
  engagementScore: number;
  views: number;
  likes: number;
  comments: number;
};

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function findPacingReference(store: JsonStore, libraryId?: string): PacingReference | null {
  const rows = store.list<{ id: string; payload_json: string }>("library_items");

  if (libraryId) {
    const row = rows.find((r) => r.id === libraryId);
    if (row) return rowToReference(row);
  }

  const ranked = rows
    .map(rowToReference)
    .filter((r): r is PacingReference => !!r && (!!r.pacingTranscript || !!r.ssml))
    .sort((a, b) => b.engagementScore - a.engagementScore || b.replicationScore - a.replicationScore);

  return ranked[0] || null;
}

function rowToReference(row: { id: string; payload_json: string }): PacingReference | null {
  const item = parsePayload(row.payload_json);
  const wtw = (item.why_this_worked as Record<string, unknown>) || {};
  const hookDetail = (item.hook_detail as Record<string, unknown>) || {};
  const pacing = String(item.pacing_transcript || "");
  const ssml = String(item.ssml || "");
  if (!pacing && !ssml) return null;

  const videoData = (item.videoData as Record<string, unknown>) || {};
  const stats = (videoData.stats as Record<string, unknown>) || videoData;
  const views = Number(stats.views ?? item.view_count_at_scan ?? 0) || 0;
  const likes = Number(stats.likes ?? stats.likeText ?? 0) || 0;
  const comments = Number(stats.comments ?? stats.commentText ?? 0) || 0;
  const shares = Number(stats.shares ?? stats.reposts ?? 0) || 0;
  const saves = Number(stats.saves ?? 0) || 0;

  return {
    libraryId: row.id,
    hook: String(hookDetail.text || hookDetail.visual_action || item.hook || ""),
    pacingTranscript: pacing,
    ssml,
    replicationScore: Number(wtw.replication_score) || 0,
    engagementScore: computeEngagementScore({ views, likes, comments, shares, saves }),
    views,
    likes,
    comments,
  };
}

export function formatPacingBlock(ref: PacingReference | null): string {
  if (!ref) return "";
  const pacing = clipPromptText(ref.pacingTranscript, 1800);
  const ssml = clipPromptText(ref.ssml, 1200);
  return [
    "## Reference video pacing (match speaking SPEED and rhythm — same beat structure, not same words or products)",
    `Reference hook studied for structure only: "${ref.hook}"`,
    `Performance: ${ref.views.toLocaleString()} views · ${ref.likes.toLocaleString()} likes · ${ref.comments.toLocaleString()} comments`,
    "",
    "### Timestamp pacing from winning video",
    pacing || "(no pacing transcript)",
    "",
    "### Reference SSML break pattern (mirror pause lengths and prosody rates only)",
    ssml || "(no SSML)",
    "",
    "Your SSML must mirror pause lengths and speaking speed. Script content must be about the creator's product — not products from this reference video.",
  ].join("\n");
}

function clipPromptText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n…(truncated)`;
}
