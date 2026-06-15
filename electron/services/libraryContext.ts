import type { JsonStore } from "../db.js";

export type ParsedLibraryItem = {
  id: string;
  hookType: string;
  funnelCategory: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  durationSeconds: number | null;
  hooks: {
    onScreen: string;
    audio: string;
    visual: string;
    caption: string;
    mechanism: string;
  };
  cta: {
    verbal: string;
    onScreen: string;
    visualGesture: string;
    structure: string;
    intensity: string;
    timestamps: number[];
  };
  pacingNotes: string;
  primaryReason: string;
  replicationNotes: string;
  replicationScore: number;
  formatTags: string[];
};

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseLibraryItem(row: {
  id: string;
  payload_json: string;
  hook_type?: string | null;
  funnel_category?: string | null;
}): ParsedLibraryItem {
  const item = parsePayload(row.payload_json);
  const hooks = (item.hooks as Record<string, unknown>) || {};
  const hd = (item.hook_detail as Record<string, unknown>) || {};
  const cta = (item.cta as Record<string, unknown>) || {};
  const wtw = (item.why_this_worked as Record<string, unknown>) || {};
  const wtp = (item.watch_time_psychology as Record<string, unknown>) || {};
  const stats = ((item.videoData as Record<string, unknown>)?.stats as Record<string, unknown>) || {};
  const vs = (item.video_stats as Record<string, unknown>) || {};

  return {
    id: row.id,
    hookType: String(row.hook_type || item.hook_type || hooks.hook_type || "unknown"),
    funnelCategory: String(row.funnel_category || item.funnel_category || item.funnel_class || ""),
    views: num(stats.views ?? vs.views ?? item.view_count_at_scan),
    likes: num(stats.likes ?? vs.likes),
    comments: num(stats.comments ?? vs.comments),
    shares: num(stats.reposts ?? stats.shares ?? vs.reposts),
    saves: num(stats.saves ?? vs.saves),
    durationSeconds: num(item.duration_seconds) || null,
    hooks: {
      onScreen: String(hooks.on_screen_text || hd.text || "").trim(),
      audio: String(hooks.audio_spoken || hd.audio_spoken || item.transcript_hook || "").trim(),
      visual: String(hooks.visual_action || hd.visual_action || "").trim(),
      caption: String(hooks.caption_text || hd.caption_text || "").trim(),
      mechanism: String(hooks.hook_mechanism || hd.hook_mechanism || "").trim(),
    },
    cta: {
      verbal: String(cta.verbal || "").trim(),
      onScreen: String(cta.on_screen || cta.on_screen_text || "").trim(),
      visualGesture: String(cta.visual_gesture || "").trim(),
      structure: String(cta.structure || "").trim(),
      intensity: String(cta.intensity || "").trim(),
      timestamps: Array.isArray(cta.timestamps)
        ? (cta.timestamps as unknown[]).map((t) => num(t)).filter((t) => t > 0)
        : [],
    },
    pacingNotes: String(wtp.pacing_notes || "").trim(),
    primaryReason: String(wtw.primary_reason || "").trim(),
    replicationNotes: String(wtw.replication_notes || "").trim(),
    replicationScore: num(wtw.replication_score),
    formatTags: Array.isArray(item.format_tags)
      ? (item.format_tags as unknown[]).map((t) => String(t)).filter(Boolean)
      : [],
  };
}

export function formatLibraryItemForAgent(item: ParsedLibraryItem, index: number): string {
  return `${index + 1}. **${item.hookType}** · ${item.funnelCategory || "—"} · ${item.views.toLocaleString()} views · ${item.likes.toLocaleString()} likes · ${item.comments} comments
   On-screen hook: ${item.hooks.onScreen || "—"}
   Audio hook: ${item.hooks.audio || "—"}
   Visual hook: ${item.hooks.visual || "—"}
   Caption hook: ${item.hooks.caption || "—"}
   CTA: ${item.cta.verbal || item.cta.onScreen || "—"}${item.cta.intensity ? ` (${item.cta.intensity})` : ""}
   Pacing: ${item.pacingNotes || "—"}
   Why it worked: ${(item.primaryReason || item.replicationNotes).slice(0, 160)}`;
}

export function buildLibraryContextBlock(store: JsonStore, limit = 15): string {
  const rows = store
    .list<{ id: string; payload_json: string; hook_type?: string; funnel_category?: string }>(
      "library_items"
    )
    .slice(0, 200);

  const parsed = rows
    .map((r) => parseLibraryItem(r))
    .filter((v) => v.views > 0 || v.replicationScore >= 6)
    .sort((a, b) => b.views - a.views || b.replicationScore - a.replicationScore)
    .slice(0, limit);

  if (!parsed.length) {
    return "No library analyses imported yet. Import library.json from TikTok Hook Analyzer.";
  }

  return parsed.map((item, i) => formatLibraryItemForAgent(item, i)).join("\n\n");
}
