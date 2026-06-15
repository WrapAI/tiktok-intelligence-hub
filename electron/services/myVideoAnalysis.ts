import type { JsonStore } from "../db.js";

const WHISPER_URL = "http://localhost:5050";
const GROK_RESPONSES_URL = "https://api.x.ai/v1/responses";
const GROK_MODEL = "grok-2-vision-1212";

export type MyVideoAnalysis = {
  transcript: string;
  onscreen_hook: string | null;
  video_structure: string;
  cta_timestamps: number[];
  hook_type: string | null;
  funnel_category: string | null;
  timeline: Array<{ timestamp: number; visual: string; audio: string; on_screen_text: string | null }>;
  pacing_notes: string;
  detailed_analysis: string;
  raw_json: string;
};

export type MyVideoSubmission = {
  url: string;
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
  upload_date: string;
  submitted_at: string;
};

export type MyVideo = MyVideoSubmission & {
  id: string;
  analysis: MyVideoAnalysis | null;
  analysis_status: "pending" | "analysing" | "complete" | "error";
  analysis_error: string;
  score: number | null;
  created_at: string;
  updated_at: string;
};

const ANALYSIS_PROMPT = `You are analysing a TikTok Shop affiliate creator's OWN video for performance insights.

This is their video — not a competitor. Analyse it thoroughly so they can learn what works.

Return JSON only:
{
  "transcript": "full spoken transcript",
  "onscreen_hook": "exact on-screen text in opening 0-3s or null",
  "video_structure": "narrative walkthrough of the video structure",
  "cta_timestamps": [22.5],
  "hook_type": "question|bold_claim|story|fear|curiosity_gap|social_proof|pattern_interrupt|dont_buy|ragebait|other",
  "funnel_category": "Top Funnel|Middle Funnel|Bottom Funnel",
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
}`;

export async function analyseMyVideo(
  store: JsonStore,
  videoId: string
): Promise<MyVideoAnalysis> {
  const grokKey = store.getSetting("grokApiKey");
  if (!grokKey) throw new Error("Add your Grok (xAI) API key in Settings first.");

  const videos = store.list<MyVideo>("my_videos");
  const video = videos.find((v) => v.id === videoId);
  if (!video) throw new Error("Video not found.");
  if (!video.url) throw new Error("Video has no URL.");

  // Step 1: upload to xAI via whisper-server
  let fileId: string | null = null;
  let fileUrl: string | null = null;

  const uploadRes = await fetch(`${WHISPER_URL}/xai/upload-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: grokKey, url: video.url }),
    signal: AbortSignal.timeout(300_000),
  });
  const uploadData = (await uploadRes.json()) as {
    ok: boolean;
    file_id?: string;
    file_url?: string;
    error?: string;
  };
  if (!uploadData.ok) throw new Error(uploadData.error || "xAI video upload failed");
  fileId = uploadData.file_id || null;
  fileUrl = uploadData.file_url || null;

  // Step 2: call Grok with the uploaded file
  const contentInput: unknown[] = [];
  if (fileId) {
    contentInput.push({ type: "input_file", file_id: fileId });
  } else if (fileUrl) {
    contentInput.push({ type: "input_video", video_url: fileUrl });
  } else {
    contentInput.push({ type: "input_video", video_url: { url: video.url } });
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

  // Extract text from response
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

  // Clean up uploaded file (fire and forget)
  if (fileId) {
    void fetch(`https://api.x.ai/v1/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${grokKey}` },
    }).catch(() => {});
  }

  // Parse JSON from response
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

  return {
    transcript: String(parsed.transcript || ""),
    onscreen_hook: parsed.onscreen_hook != null ? String(parsed.onscreen_hook) : null,
    video_structure: String(parsed.video_structure || ""),
    cta_timestamps: Array.isArray(parsed.cta_timestamps)
      ? (parsed.cta_timestamps as number[]).map(Number).filter(Number.isFinite)
      : [],
    hook_type: parsed.hook_type != null ? String(parsed.hook_type) : null,
    funnel_category: parsed.funnel_category != null ? String(parsed.funnel_category) : null,
    timeline: Array.isArray(parsed.timeline)
      ? (parsed.timeline as Record<string, unknown>[]).map((t) => ({
          timestamp: Number(t.timestamp || 0),
          visual: String(t.visual || ""),
          audio: String(t.audio || ""),
          on_screen_text: t.on_screen_text != null ? String(t.on_screen_text) : null,
        }))
      : [],
    pacing_notes: String(parsed.pacing_notes || ""),
    detailed_analysis: String(parsed.detailed_analysis || ""),
    raw_json: JSON.stringify(parsed),
  };
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
