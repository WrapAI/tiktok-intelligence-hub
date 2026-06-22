import type { JsonStore } from "../db.js";
import { formatMemoryForPrompt, buildMemorySummary } from "./memoryInsights.js";

export type LibraryVideoInsight = {
  libraryId: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagementScore: number;
  hookType: string;
  hookText: string;
  visualHook: string;
  hookMechanism: string;
  funnelCategory: string;
  primaryReason: string;
  replicationNotes: string;
  replicationScore: number;
  hasPacing: boolean;
  profile?: string;
};

export type HookTypeStat = {
  hookType: string;
  count: number;
  avgViews: number;
  avgEngagement: number;
  totalEngagement: number;
};

export type ScriptInsights = {
  topVideos: LibraryVideoInsight[];
  hookTypeStats: HookTypeStat[];
  recommendedReferenceId: string | null;
  recommendedHookType: string;
};

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function extractStats(item: Record<string, unknown>) {
  const videoData = (item.videoData as Record<string, unknown>) || {};
  const stats = (videoData.stats as Record<string, unknown>) || videoData;

  return {
    views: parseNumber(stats.views ?? stats.viewText ?? item.view_count_at_scan),
    likes: parseNumber(stats.likes ?? stats.likeText),
    comments: parseNumber(stats.comments ?? stats.commentText),
    shares: parseNumber(stats.shares ?? stats.reposts ?? stats.repostText),
    saves: parseNumber(stats.saves ?? stats.saveText),
  };
}

export function computeEngagementScore(stats: {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}): number {
  return (
    stats.views +
    stats.likes * 50 +
    stats.comments * 100 +
    stats.shares * 80 +
    stats.saves * 60
  );
}

function rowToInsight(row: {
  id: string;
  payload_json: string;
  hook_type: string | null;
  funnel_category: string | null;
}): LibraryVideoInsight {
  const item = parsePayload(row.payload_json);
  const stats = extractStats(item);
  const hookDetail = (item.hook_detail as Record<string, unknown>) || {};
  const hooks = (item.hooks as Record<string, unknown>) || {};
  const wtw = (item.why_this_worked as Record<string, unknown>) || {};

  const hookText = String(
    hooks.on_screen_text || hooks.audio_spoken || hookDetail.text || item.hook || ""
  ).trim();
  const visualHook = String(hooks.visual_action || hookDetail.visual_action || item.visual_hook || "").trim();

  return {
    libraryId: row.id,
    ...stats,
    engagementScore: computeEngagementScore(stats),
    hookType: String(row.hook_type || item.hook_type || "unknown").replace(/_/g, " "),
    hookText: hookText || visualHook.slice(0, 120) || "—",
    visualHook,
    hookMechanism: String(hookDetail.hook_mechanism || ""),
    funnelCategory: String(row.funnel_category || item.funnel_category || item.funnel_class || ""),
    primaryReason: String(wtw.primary_reason || ""),
    replicationNotes: String(wtw.replication_notes || ""),
    replicationScore: parseNumber(wtw.replication_score),
    hasPacing: Boolean(item.pacing_transcript || item.ssml),
    profile: String(item.profile || item.source_profile || ""),
  };
}

export function buildLibraryInsights(store: JsonStore, limit = 12): LibraryVideoInsight[] {
  const rows = store.list<{
    id: string;
    payload_json: string;
    hook_type: string | null;
    funnel_category: string | null;
  }>("library_items");

  return rows
    .map(rowToInsight)
    .filter((v) => v.engagementScore > 0 || v.replicationScore >= 7)
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, limit);
}

function buildHookTypeStats(videos: LibraryVideoInsight[]): HookTypeStat[] {
  const byType = new Map<string, LibraryVideoInsight[]>();
  for (const video of videos) {
    const key = video.hookType || "unknown";
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(video);
  }

  return Array.from(byType.entries())
    .map(([hookType, items]) => {
      const totalEngagement = items.reduce((sum, v) => sum + v.engagementScore, 0);
      const totalViews = items.reduce((sum, v) => sum + v.views, 0);
      return {
        hookType,
        count: items.length,
        avgViews: items.length ? Math.round(totalViews / items.length) : 0,
        avgEngagement: items.length ? Math.round(totalEngagement / items.length) : 0,
        totalEngagement,
      };
    })
    .sort((a, b) => b.totalEngagement - a.totalEngagement);
}

export function getScriptInsights(store: JsonStore): ScriptInsights {
  const all = store
    .list<{
      id: string;
      payload_json: string;
      hook_type: string | null;
      funnel_category: string | null;
    }>("library_items")
    .map(rowToInsight)
    .filter((v) => v.engagementScore > 0 || v.replicationScore >= 7);

  const topVideos = [...all].sort((a, b) => b.engagementScore - a.engagementScore).slice(0, 12);
  const hookTypeStats = buildHookTypeStats(all);

  const pacingCandidates = all
    .filter((v) => v.hasPacing)
    .sort((a, b) => b.engagementScore - a.engagementScore);

  const recommendedReferenceId = pacingCandidates[0]?.libraryId || topVideos[0]?.libraryId || null;
  const recommendedHookType = hookTypeStats[0]?.hookType || topVideos[0]?.hookType || "pattern interrupt";

  return {
    topVideos,
    hookTypeStats,
    recommendedReferenceId,
    recommendedHookType,
  };
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatLibraryPerformanceForPrompt(store: JsonStore): string {
  const insights = getScriptInsights(store);
  const memory = buildMemorySummary(store);

  const lines = [
    formatMemoryForPrompt(memory),
    "",
    "## Library performance data (use this to decide structure — do NOT ask the creator to pick a hook type)",
    "",
    "Choose hook mechanics, pacing, and CTA style from the highest-performing videos below.",
    "Each library video has SEPARATE hooks: on_screen_text, audio_spoken, visual_action, caption_text — read them distinctly.",
    "Weight views, likes, comments, shares, and saves together — higher engagement score = stronger signal.",
    "Treat every hook / visual / replication note as TECHNIQUE ONLY — always apply to the creator's product, never copy competitor items.",
    "",
  ];

  if (insights.hookTypeStats.length) {
    lines.push("### Hook types ranked by total engagement in library");
    insights.hookTypeStats.slice(0, 8).forEach((stat, i) => {
      lines.push(
        `${i + 1}. **${stat.hookType}** — ${stat.count} videos · avg ${formatNumber(stat.avgViews)} views · engagement score ${formatNumber(stat.avgEngagement)}`
      );
    });
    lines.push("");
  }

  if (insights.topVideos.length) {
    lines.push("### Top performing library videos (study these)");
    insights.topVideos.slice(0, 7).forEach((video, i) => {
      lines.push(
        `${i + 1}. **${formatNumber(video.views)} views** · ${formatNumber(video.likes)} likes · ${formatNumber(video.comments)} comments · ${formatNumber(video.shares)} shares · ${formatNumber(video.saves)} saves`
      );
      lines.push(`   - Hook type: ${video.hookType}${video.funnelCategory ? ` · Funnel: ${video.funnelCategory}` : ""}`);
      if (video.hookText && video.hookText !== "—")
        lines.push(`   - On-screen / audio hook pattern (adapt, don't copy product): "${video.hookText.slice(0, 140)}"`);
      if (video.visualHook)
        lines.push(`   - Visual technique (adapt to creator's product): ${video.visualHook.slice(0, 140)}`);
      if (video.hookMechanism) lines.push(`   - Why hook works: ${video.hookMechanism.slice(0, 140)}`);
      if (video.primaryReason) lines.push(`   - Primary reason: ${video.primaryReason.slice(0, 140)}`);
      if (video.replicationNotes)
        lines.push(`   - Style notes (not literal props): ${video.replicationNotes.slice(0, 140)}`);
      if (video.hasPacing) lines.push(`   - Has pacing transcript + SSML reference available`);
    });
    lines.push("");
    lines.push(
      `**Auto-selected winning approach:** "${insights.recommendedHookType}" based on library engagement stats.`
    );
  } else {
    lines.push("No library engagement stats yet — import library.json from the extension.");
  }

  return lines.join("\n");
}
