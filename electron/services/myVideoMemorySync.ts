import type { JsonStore } from "../db.js";
import type { MyVideo } from "./myVideoAnalysis.js";

export type PositiveMemoryEntry = {
  id: string;
  payload_json: string;
  rating: number;
  my_views: number;
  my_gmv: number;
  what_i_took: string;
  date_used: string;
  imported_at: string;
  entry_type: string;
  source: string;
  my_video_id: string;
  title: string;
  hook_type: string;
  funnel_category: string;
  my_commission: number;
  my_sales: number;
};

function hasConversionData(video: MyVideo): boolean {
  return (
    (video.sales != null && video.sales > 0) ||
    (video.gmv != null && video.gmv > 0) ||
    (video.commission != null && video.commission > 0)
  );
}

function buildMemoryTitle(video: MyVideo): string {
  const hook = video.analysis?.onscreen_hook?.trim();
  if (hook) return hook.slice(0, 120);
  try {
    const u = new URL(video.url);
    return u.pathname.split("/").filter(Boolean).slice(-2).join("/");
  } catch {
    return video.url.slice(0, 80);
  }
}

function buildWhatWorked(video: MyVideo): string {
  const parts: string[] = [];
  const a = video.analysis;
  if (a?.hook_type) parts.push(`Hook: ${a.hook_type}`);
  if (a?.funnel_category) parts.push(`Funnel: ${a.funnel_category}`);
  if (a?.onscreen_hook) parts.push(`On-screen: "${a.onscreen_hook}"`);
  if (video.commission != null && video.commission > 0) {
    parts.push(`Commission £${video.commission.toFixed(2)}`);
  }
  if (video.gmv != null && video.gmv > 0) parts.push(`GMV £${video.gmv.toFixed(2)}`);
  if (video.sales != null && video.sales > 0) parts.push(`${video.sales} sales`);
  if (a?.detailed_analysis) parts.push(a.detailed_analysis.slice(0, 200));
  return parts.join(" · ") || "Own converted video";
}

/** Sync a converted My Video into positive memory (wins library for the agent). */
export function syncMyVideoToPositiveMemory(store: JsonStore, video: MyVideo): void {
  if (!hasConversionData(video)) return;

  const now = new Date().toISOString();
  const memoryId = `myvideo-${video.id}`;
  const payload = {
    entry_type: "own_video",
    source: "hub_my_videos",
    my_video_id: video.id,
    title: buildMemoryTitle(video),
    what_i_took: buildWhatWorked(video),
    url: video.url,
    thumbnail_url: video.thumbnail_url,
    rating: video.score != null ? Math.min(5, Math.max(1, Math.round(video.score / 20))) : 0,
    my_views: video.views ?? 0,
    my_gmv: video.gmv ?? 0,
    my_commission: video.commission ?? 0,
    my_sales: video.sales ?? 0,
    watch_time_pct: video.watch_time_pct,
    upload_date: video.upload_date,
    score: video.score,
    video_analysis: video.analysis,
    sales_data: {
      views: video.views,
      likes: video.likes,
      comments: video.comments,
      watch_time_pct: video.watch_time_pct,
      sales: video.sales,
      gmv: video.gmv,
      commission: video.commission,
      audience_male_pct: video.audience_male_pct,
      audience_female_pct: video.audience_female_pct,
      audience_other_pct: video.audience_other_pct,
    },
    synced_at: now,
  };

  const entry: PositiveMemoryEntry = {
    id: memoryId,
    payload_json: JSON.stringify(payload),
    rating: payload.rating,
    my_views: payload.my_views,
    my_gmv: payload.my_gmv,
    what_i_took: payload.what_i_took,
    date_used: video.upload_date?.slice(0, 10) || now.slice(0, 10),
    imported_at: now,
    entry_type: "own_video",
    source: "hub_my_videos",
    my_video_id: video.id,
    title: payload.title,
    hook_type: video.analysis?.hook_type || "",
    funnel_category: video.analysis?.funnel_category || "",
    my_commission: payload.my_commission,
    my_sales: payload.my_sales,
  };

  store.upsertById("positive_memory", entry as unknown as { id: string });
}

export function removeMyVideoFromPositiveMemory(store: JsonStore, videoId: string): void {
  store.deleteById("positive_memory", `myvideo-${videoId}`);
}
