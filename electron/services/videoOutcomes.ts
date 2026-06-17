import { randomUUID } from "node:crypto";
import type { JsonStore } from "../db.js";
import type { PendingAnalysis, PendingAnalysisSubmit } from "./pendingAnalysis.js";
import type { MyVideoAnalysis } from "./myVideoAnalysis.js";

export type VideoOutcome = {
  id: string;
  pending_analysis_id: string;
  source_script_id: string;
  script_title: string;
  product_id: string;
  product_name: string;
  tiktok_url: string;
  upload_date: string;
  submitted_at: string;
  score: number;
  views: number | null;
  likes: number | null;
  comments: number | null;
  watch_time_pct: number | null;
  sales: number | null;
  gmv: number | null;
  commission: number | null;
  audience_male_pct: number | null;
  audience_female_pct: number | null;
  audience_other_pct: number | null;
  initial_stats: PendingAnalysis["initial_stats"];
  latest_stats: PendingAnalysis["latest_stats"];
  grok_analysis: MyVideoAnalysis | null;
  script_text: string;
  on_screen_caption: string;
  tiktok_caption: string;
  ssml: string;
  hook_type: string;
  linked_my_video_id: string;
  linked_memory_id: string;
  created_at: string;
};

export function saveVideoOutcome(
  store: JsonStore,
  opts: {
    pending: PendingAnalysis;
    submit: PendingAnalysisSubmit;
    score: number;
    myVideoId: string;
    memoryId: string;
    script?: Record<string, unknown>;
  }
): VideoOutcome {
  const now = new Date().toISOString();
  const script = opts.script || {};
  const outcome: VideoOutcome = {
    id: randomUUID(),
    pending_analysis_id: opts.pending.id,
    source_script_id: opts.pending.source_script_id,
    script_title: opts.pending.script_title,
    product_id: opts.pending.product_id,
    product_name: opts.pending.product_name,
    tiktok_url: opts.pending.tiktok_url,
    upload_date: opts.submit.upload_date,
    submitted_at: now,
    score: opts.score,
    views: opts.pending.views,
    likes: opts.pending.likes,
    comments: opts.pending.comments,
    watch_time_pct: opts.submit.watch_time_pct,
    sales: opts.submit.sales,
    gmv: opts.submit.gmv,
    commission: opts.submit.commission,
    audience_male_pct: opts.submit.audience_male_pct,
    audience_female_pct: opts.submit.audience_female_pct,
    audience_other_pct: opts.submit.audience_other_pct,
    initial_stats: opts.pending.initial_stats,
    latest_stats: opts.pending.latest_stats,
    grok_analysis: opts.pending.analysis,
    script_text: String(script.script_text || ""),
    on_screen_caption: String(script.on_screen_caption || ""),
    tiktok_caption: String(script.tiktok_caption || ""),
    ssml: String(script.ssml || ""),
    hook_type: String(script.hook_type || opts.pending.analysis?.hook_type || ""),
    linked_my_video_id: opts.myVideoId,
    linked_memory_id: opts.memoryId,
    created_at: now,
  };
  store.upsertById("video_outcomes", outcome);
  return outcome;
}

export function listVideoOutcomes(store: JsonStore): VideoOutcome[] {
  return store
    .list<VideoOutcome>("video_outcomes")
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
}

export function formatVideoOutcomesForPrompt(store: JsonStore, limit = 15): string {
  const outcomes = listVideoOutcomes(store).slice(0, limit);
  if (!outcomes.length) return "";

  const lines = [
    "## Your posted video outcomes (learn what converts for THIS creator)",
    "",
  ];

  for (const o of outcomes) {
    const viewDelta =
      o.initial_stats?.views != null && o.latest_stats?.views != null
        ? `${o.initial_stats.views} → ${o.latest_stats.views} views`
        : `${o.views ?? "?"} views`;
    lines.push(
      `### ${o.script_title} · Score ${o.score}/100 · ${o.upload_date}`,
      `- Product: ${o.product_name}`,
      `- Performance: ${viewDelta} · ${o.watch_time_pct ?? "?"}% watch · £${o.commission ?? o.gmv ?? "?"} commission · ${o.sales ?? "?"} sales`,
      `- Hook type: ${o.hook_type || o.grok_analysis?.hook_type || "—"} · Funnel: ${o.grok_analysis?.funnel_category || "—"}`,
      o.grok_analysis?.detailed_analysis
        ? `- What worked: ${o.grok_analysis.detailed_analysis.slice(0, 280)}`
        : "",
      o.on_screen_caption ? `- On-screen: ${o.on_screen_caption.slice(0, 120)}` : "",
      ""
    );
  }

  return `${lines.filter(Boolean).join("\n")}\n\n`;
}

export function buildVideoOutcomesMarkdown(store: JsonStore): string {
  const outcomes = listVideoOutcomes(store);
  if (!outcomes.length) {
    return "# Video outcomes\n\nNo completed post outcomes yet — submit from Pending Analysis after posting.";
  }

  return outcomes
    .map(
      (o, i) => `## ${i + 1}. ${o.script_title} — Score ${o.score}/100
- Product: ${o.product_name}
- Posted: ${o.upload_date} · URL: ${o.tiktok_url}
- Views: ${o.views ?? "—"} · Watch: ${o.watch_time_pct ?? "—"}% · Sales: ${o.sales ?? "—"} · GMV: £${o.gmv ?? "—"} · Commission: £${o.commission ?? "—"}
- Audience: ${o.audience_male_pct ?? "—"}% M / ${o.audience_female_pct ?? "—"}% F
- Hook: ${o.grok_analysis?.onscreen_hook || "—"} (${o.hook_type || o.grok_analysis?.hook_type || "—"})
- Grok: ${(o.grok_analysis?.detailed_analysis || "—").slice(0, 400)}`
    )
    .join("\n\n");
}
