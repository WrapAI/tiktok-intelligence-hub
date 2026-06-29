import type { JsonStore } from "../db.js";
import { getAnalysisDurationSeconds, resolveVideoDurationSeconds } from "./watchTime.js";

const WHISPER_URL = "http://localhost:5050";
const GROK_RESPONSES_URL = "https://api.x.ai/v1/responses";
const GROK_MODEL = "grok-4.3";

export type FunnelBreakdownStage = {
  label: string;
  time_range: string;
  what_happens: string;
};

export type MyVideoAnalysis = {
  duration_seconds: number | null;
  thumbnail_url: string | null;
  transcript: string;
  onscreen_hook: string | null;
  video_structure: string;
  cta_timestamps: number[];
  hook_type: string | null;
  funnel_category: string | null;
  funnel_category_reason: string | null;
  funnel_breakdown: FunnelBreakdownStage[] | null;
  timeline: Array<{ timestamp: number; visual: string; audio: string; on_screen_text: string | null }>;
  pacing_notes: string;
  detailed_analysis: string;
  raw_json: string;
};

export type MyVideoSubmission = {
  url: string;
  thumbnail_url?: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  watch_time_seconds: number | null;
  watch_time_pct: number | null;
  sales: number | null;
  gmv: number | null;
  commission: number | null;
  audience_male_pct: number | null;
  audience_female_pct: number | null;
  audience_other_pct: number | null;
  upload_date: string;
  submitted_at: string;
};

export type MyVideo = MyVideoSubmission & {
  id: string;
  thumbnail_url: string | null;
  analysis: MyVideoAnalysis | null;
  analysis_status: "pending" | "analysing" | "complete" | "error";
  analysis_error: string;
  score: number | null;
  pending_hub_review?: boolean;
  title?: string;
  hook?: string;
  key_message?: string;
  created_at: string;
  updated_at: string;
};

export function extractThumbnailFromLibraryRow(row: Record<string, unknown>): string | null {
  const direct = row.frameDataUrl ?? row.thumbnail_url ?? row.thumbnailUrl;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const nested = row.analysis as Record<string, unknown> | null;
  if (nested && typeof nested.frameDataUrl === "string" && nested.frameDataUrl.trim()) {
    return nested.frameDataUrl.trim();
  }

  const frames = row.frames;
  if (Array.isArray(frames) && frames.length) {
    const first = frames[0];
    if (typeof first === "string" && first.trim()) return first.trim();
    if (first && typeof first === "object") {
      const frame = first as Record<string, unknown>;
      const url = frame.dataUrl ?? frame.data_url;
      if (typeof url === "string" && url.trim()) return url.trim();
    }
  }

  return null;
}

export function backfillMyVideoThumbnail(video: MyVideo): MyVideo {
  let next = video;
  if (!next.thumbnail_url) {
    if (next.analysis?.thumbnail_url) {
      next = { ...next, thumbnail_url: next.analysis.thumbnail_url };
    } else if (next.analysis?.raw_json) {
      try {
        const row = JSON.parse(next.analysis.raw_json) as Record<string, unknown>;
        const thumb = extractThumbnailFromLibraryRow(row);
        if (thumb) next = { ...next, thumbnail_url: thumb };
      } catch {
        /* ignore */
      }
    }
  }
  if (next.analysis) {
    const duration = getAnalysisDurationSeconds(next.analysis);
    if (duration != null && next.analysis.duration_seconds !== duration) {
      next = { ...next, analysis: { ...next.analysis, duration_seconds: duration } };
    }
  }
  return next;
}

function parseFunnelBreakdown(value: unknown): FunnelBreakdownStage[] | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const stages = Array.isArray(obj.stages) ? obj.stages : Array.isArray(value) ? value : null;
  if (!stages?.length) return null;
  const parsed = stages
    .map((stage) => {
      if (!stage || typeof stage !== "object") return null;
      const s = stage as Record<string, unknown>;
      const label = String(s.label || s.stage || s.funnel || "").trim();
      const time_range = String(s.time_range || s.timeRange || s.timestamps || "").trim();
      const what_happens = String(s.what_happens || s.whatHappens || s.description || "").trim();
      if (!label && !what_happens) return null;
      return { label, time_range, what_happens };
    })
    .filter((s): s is FunnelBreakdownStage => s != null);
  return parsed.length ? parsed : null;
}

const ANALYSIS_PROMPT = `You are analysing a TikTok Shop affiliate creator's OWN video for performance insights.

This is their video — not a competitor. Analyse it thoroughly so they can learn what works.

Return JSON only:
{
  "duration_seconds": 28.5,
  "transcript": "full spoken transcript",
  "onscreen_hook": "exact on-screen text in opening 0-3s or null",
  "video_structure": "narrative walkthrough of the video structure",
  "cta_timestamps": [22.5],
  "hook_type": "question|bold_claim|story|fear|curiosity_gap|social_proof|pattern_interrupt|dont_buy|ragebait|other",
  "funnel_category": "Top Funnel|Top/Middle Funnel|Middle Funnel|Middle/Bottom Funnel|Bottom Funnel",
  "funnel_category_reason": "one sentence summary",
  "funnel_breakdown": {
    "stages": [
      { "label": "Top Funnel", "time_range": "0-6s", "what_happens": "only required for dual labels — explain each stage" }
    ]
  },
  "timeline": [
    {
      "timestamp": 0,
      "visual": "what is shown",
      "audio": "what is said",
      "on_screen_text": "text overlay or null"
    }
  ],
  "pacing_notes": "fast/slow/varied — where energy peaks and drops",
  "detailed_analysis": "analysis of hook psychology, what worked, what could improve, discount delivery, CTA effectiveness"
}

Confirm duration_seconds from the uploaded video (total length in seconds). Use the last timeline timestamp if needed. Round to one decimal.`;

export async function analyseTikTokUrl(store: JsonStore, url: string): Promise<MyVideoAnalysis> {
  const grokKey = store.getSetting("grokApiKey");
  if (!grokKey) throw new Error("Add your Grok (xAI) API key in Settings first.");
  if (!url.trim()) throw new Error("Video has no URL.");

  let fileId: string | null = null;
  let fileUrl: string | null = null;

  const uploadRes = await fetch(`${WHISPER_URL}/xai/upload-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: grokKey, url: url.trim() }),
    signal: AbortSignal.timeout(300_000),
  });
  const uploadData = (await uploadRes.json()) as {
    ok: boolean;
    file_id?: string;
    file_url?: string;
    duration_seconds?: number;
    thumbnail_data_url?: string;
    error?: string;
  };
  if (!uploadData.ok) throw new Error(uploadData.error || "xAI video upload failed");
  fileId = uploadData.file_id || null;
  fileUrl = uploadData.file_url || null;
  const whisperDuration =
    uploadData.duration_seconds != null && Number.isFinite(Number(uploadData.duration_seconds))
      ? Number(uploadData.duration_seconds)
      : null;
  const thumbnail_url =
    typeof uploadData.thumbnail_data_url === "string" && uploadData.thumbnail_data_url.trim()
      ? uploadData.thumbnail_data_url.trim()
      : null;

  const contentInput: unknown[] = [];
  if (fileId) {
    contentInput.push({ type: "input_file", file_id: fileId });
  } else if (fileUrl) {
    contentInput.push({ type: "input_video", video_url: fileUrl });
  } else {
    contentInput.push({ type: "input_video", video_url: { url: url.trim() } });
  }
  contentInput.push({ type: "input_text", text: ANALYSIS_PROMPT });

  const grokRes = await fetch(GROK_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${grokKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      input: [{ role: "user", content: contentInput }],
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!grokRes.ok) {
    const errText = await grokRes.text();
    throw new Error(`Grok API error (${grokRes.status}): ${errText.slice(0, 300)}`);
  }

  const grokData = (await grokRes.json()) as {
    output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
    output_text?: string;
  };

  let rawText = grokData.output_text || "";
  if (!rawText) {
    for (const item of grokData.output || []) {
      if (item.type !== "message") continue;
      for (const block of item.content || []) {
        if (block.type === "output_text" && block.text) {
          rawText = block.text;
          break;
        }
      }
      if (rawText) break;
    }
  }

  if (!rawText) throw new Error("Grok returned no analysis text.");

  if (fileId) {
    void fetch(`https://api.x.ai/v1/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${grokKey}` },
    }).catch(() => {});
  }

  const fenced = rawText.match(/```(?:json)?\s*\n([\s\S]*?)```/i);
  const jsonStr = fenced ? fenced[1] : rawText;
  const start = jsonStr.indexOf("{");
  const end = jsonStr.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Grok response contained no parseable JSON.");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Could not parse Grok JSON response.");
  }

  const timeline = Array.isArray(parsed.timeline)
    ? (parsed.timeline as Record<string, unknown>[]).map((t) => ({
        timestamp: Number(t.timestamp || 0),
        visual: String(t.visual || ""),
        audio: String(t.audio || ""),
        on_screen_text: t.on_screen_text != null ? String(t.on_screen_text) : null,
      }))
    : [];

  const grokDuration =
    parsed.duration_seconds != null && Number.isFinite(Number(parsed.duration_seconds))
      ? Number(parsed.duration_seconds)
      : null;
  const duration_seconds = resolveVideoDurationSeconds(
    grokDuration ?? whisperDuration,
    timeline
  );

  return {
    duration_seconds,
    thumbnail_url,
    transcript: String(parsed.transcript || ""),
    onscreen_hook: parsed.onscreen_hook != null ? String(parsed.onscreen_hook) : null,
    video_structure: String(parsed.video_structure || ""),
    cta_timestamps: Array.isArray(parsed.cta_timestamps)
      ? (parsed.cta_timestamps as number[]).map(Number).filter(Number.isFinite)
      : [],
    hook_type: parsed.hook_type != null ? String(parsed.hook_type) : null,
    funnel_category: parsed.funnel_category != null ? String(parsed.funnel_category) : null,
    funnel_category_reason:
      parsed.funnel_category_reason != null ? String(parsed.funnel_category_reason) : null,
    funnel_breakdown: parseFunnelBreakdown(parsed.funnel_breakdown),
    timeline,
    pacing_notes: String(parsed.pacing_notes || ""),
    detailed_analysis: String(parsed.detailed_analysis || ""),
    raw_json: JSON.stringify(parsed),
  };
}

export async function analyseMyVideo(
  store: JsonStore,
  videoId: string
): Promise<MyVideoAnalysis> {
  const videos = store.list<MyVideo>("my_videos");
  const video = videos.find((v) => v.id === videoId);
  if (!video) throw new Error("Video not found.");
  if (!video.url) throw new Error("Video has no URL.");
  return analyseTikTokUrl(store, video.url);
}

export function scoreMyVideo(video: MyVideo): number {
  let score = 0;
  let factors = 0;

  // Commission generated (0-40 pts) — highest weight, real money
  if (video.commission != null && video.commission > 0) {
    const commissionScore = Math.min(40, (video.commission / 50) * 40);
    score += commissionScore;
    factors++;
  }

  // GMV (0-25 pts)
  if (video.gmv != null && video.gmv > 0) {
    const gmvScore = Math.min(25, (video.gmv / 200) * 25);
    score += gmvScore;
    factors++;
  }

  // Watch time % (0-20 pts) — retention signal
  if (video.watch_time_pct != null && video.watch_time_pct > 0) {
    const watchScore = Math.min(20, (video.watch_time_pct / 100) * 20);
    score += watchScore;
    factors++;
  }

  // Engagement rate: likes+comments / views (0-15 pts)
  if (video.views != null && video.views > 0 && video.likes != null) {
    const engagements = (video.likes || 0) + (video.comments || 0);
    const engagementRate = engagements / video.views;
    const engScore = Math.min(15, engagementRate * 500);
    score += engScore;
    factors++;
  }

  if (factors === 0) return 0;
  return Math.round(Math.min(100, score));
}
