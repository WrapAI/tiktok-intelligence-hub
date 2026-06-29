import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { JsonStore } from "../db.js";
import {
  analyseTikTokUrl,
  scoreMyVideo,
  type MyVideo,
  type MyVideoAnalysis,
} from "./myVideoAnalysis.js";
import { saveVideoOutcome } from "./videoOutcomes.js";
import {
  buildDriveFolderPath,
  productFolderNameFromProductName,
  todayDriveDateKey,
} from "./googleDrive.js";
import { resolveWatchTimeFromSubmit, getAnalysisDurationSeconds } from "./watchTime.js";
import { fetchVideoThumbnail } from "./videoThumbnail.js";

const WHISPER_URL = "http://localhost:5050";

export type TikTokStatsSnapshot = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  views_text?: string;
  likes_text?: string;
  comments_text?: string;
  captured_at: string;
};

export type PendingAnalysisStatus =
  | "awaiting_url"
  | "tracking"
  | "ready_for_review"
  | "complete";

export type PendingAnalysis = {
  id: string;
  source_script_id: string;
  script_title: string;
  product_id: string;
  product_name: string;
  script_created_at: string;
  on_screen_caption: string;
  tiktok_caption: string;
  drive_mp4_path: string;
  drive_uploaded_at: string;
  drive_folder_path: string;
  tiktok_url: string;
  thumbnail_url: string | null;
  url_added_at: string | null;
  initial_stats: TikTokStatsSnapshot | null;
  latest_stats: TikTokStatsSnapshot | null;
  analysis: MyVideoAnalysis | null;
  analysis_status: "pending" | "analysing" | "complete" | "error";
  analysis_error: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  upload_date: string;
  watch_time_seconds: number | null;
  watch_time_pct: number | null;
  sales: number | null;
  gmv: number | null;
  commission: number | null;
  audience_male_pct: number | null;
  audience_female_pct: number | null;
  audience_other_pct: number | null;
  score: number | null;
  status: PendingAnalysisStatus;
  linked_my_video_id: string | null;
  linked_memory_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type PendingAnalysisSubmit = {
  upload_date: string;
  watch_time_seconds: number | null;
  watch_time_pct?: number | null;
  sales: number | null;
  gmv: number | null;
  commission: number | null;
  audience_male_pct: number | null;
  audience_female_pct: number | null;
  audience_other_pct: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
};

function nowIso() {
  return new Date().toISOString();
}

type PendingDismissal = {
  id: string;
  script_id: string;
  audio_basename: string;
  dismissed_at: string;
};

function listDismissals(store: JsonStore): PendingDismissal[] {
  return store.list<PendingDismissal>("pending_dismissals");
}

function isPendingDismissed(store: JsonStore, scriptId: string, audioBasename = ""): boolean {
  const dismissals = listDismissals(store);
  if (scriptId && dismissals.some((d) => d.script_id === scriptId)) return true;
  const base = audioBasename.toLowerCase();
  if (base && dismissals.some((d) => d.audio_basename === base)) return true;
  return false;
}

export function recordPendingDismissal(
  store: JsonStore,
  scriptId: string,
  audioPath = ""
): void {
  const audioBasename = audioPath ? path.basename(audioPath).toLowerCase() : "";
  if (isPendingDismissed(store, scriptId, audioBasename)) return;
  store.upsertById("pending_dismissals", {
    id: scriptId || `audio:${audioBasename}`,
    script_id: scriptId,
    audio_basename: audioBasename,
    dismissed_at: nowIso(),
  });
}

export function normalizeTikTokVideoUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.includes("tiktok.com")) return null;
  const videoMatch = trimmed.match(/\/video\/(\d+)/i);
  if (videoMatch) return videoMatch[1];
  try {
    const u = new URL(trimmed.split("?")[0].split("#")[0]);
    return u.pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function tikTokUrlsMatch(a: string, b: string): boolean {
  const na = normalizeTikTokVideoUrl(a);
  const nb = normalizeTikTokVideoUrl(b);
  if (na && nb) return na === nb;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

type TikTokUrlConflict = {
  kind: "my_video" | "pending" | "outcome";
  id: string;
  label: string;
};

function checkTikTokUrlConflict(
  store: JsonStore,
  url: string,
  excludePendingId?: string
): TikTokUrlConflict | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  for (const video of store.list<MyVideo>("my_videos")) {
    if (video.url && tikTokUrlsMatch(video.url, trimmed)) {
      return { kind: "my_video", id: video.id, label: video.title || "My Video" };
    }
  }

  for (const pending of store.list<PendingAnalysis>("pending_analysis")) {
    if (pending.id === excludePendingId || !pending.tiktok_url?.trim()) continue;
    if (tikTokUrlsMatch(pending.tiktok_url, trimmed)) {
      return { kind: "pending", id: pending.id, label: pending.script_title || "Pending entry" };
    }
  }

  for (const outcome of store.list<{ id: string; tiktok_url: string; script_title: string }>("video_outcomes")) {
    if (outcome.tiktok_url && tikTokUrlsMatch(outcome.tiktok_url, trimmed)) {
      return {
        kind: "outcome",
        id: outcome.id,
        label: outcome.script_title || "Completed script",
      };
    }
  }

  return null;
}

function formatTikTokUrlConflict(conflict: TikTokUrlConflict): string {
  if (conflict.kind === "my_video") {
    return `This TikTok URL is already in My Videos ("${conflict.label}").`;
  }
  if (conflict.kind === "pending") {
    return `This TikTok URL is already linked to another pending entry ("${conflict.label}").`;
  }
  return `This TikTok URL is already linked to a completed script ("${conflict.label}").`;
}

export function isScriptInMyVideos(store: JsonStore, scriptId: string): boolean {
  if (!scriptId) return false;

  const completedPending = store.list<PendingAnalysis>("pending_analysis").some(
    (p) => p.source_script_id === scriptId && p.status === "complete" && p.linked_my_video_id
  );
  if (completedPending) return true;

  return store
    .list<{ source_script_id: string }>("video_outcomes")
    .some((o) => o.source_script_id === scriptId);
}

function pendingProgressRank(entry: PendingAnalysis): number {
  if (entry.status === "complete") return 5;
  if (entry.status === "ready_for_review") return 4;
  if (entry.status === "tracking") return 3;
  if (entry.tiktok_url) return 2;
  return 1;
}

function pickPreferredPending(a: PendingAnalysis, b: PendingAnalysis): PendingAnalysis {
  const rankDiff = pendingProgressRank(b) - pendingProgressRank(a);
  if (rankDiff !== 0) return rankDiff > 0 ? b : a;
  return b.updated_at.localeCompare(a.updated_at) > 0 ? b : a;
}

export function removeDuplicatePendingEntries(store: JsonStore): { removed: number } {
  const all = store.list<PendingAnalysis>("pending_analysis");
  const keepIds = new Set<string>();
  const seenScriptIds = new Map<string, PendingAnalysis>();
  const seenUrls = new Map<string, PendingAnalysis>();

  for (const entry of all) {
    keepIds.add(entry.id);
  }

  for (const entry of all) {
    if (entry.source_script_id) {
      const prev = seenScriptIds.get(entry.source_script_id);
      if (!prev) {
        seenScriptIds.set(entry.source_script_id, entry);
        continue;
      }
      const keep = pickPreferredPending(prev, entry);
      const drop = keep.id === prev.id ? entry : prev;
      keepIds.delete(drop.id);
      seenScriptIds.set(entry.source_script_id, keep);
    }
  }

  for (const entry of all) {
    if (!keepIds.has(entry.id) || !entry.tiktok_url?.trim()) continue;
    const key = normalizeTikTokVideoUrl(entry.tiktok_url) || entry.tiktok_url.trim().toLowerCase();
    const prev = seenUrls.get(key);
    if (!prev) {
      seenUrls.set(key, entry);
      continue;
    }
    if (!keepIds.has(prev.id)) {
      seenUrls.set(key, entry);
      continue;
    }
    const keep = pickPreferredPending(prev, entry);
    const drop = keep.id === prev.id ? entry : prev;
    keepIds.delete(drop.id);
    seenUrls.set(key, keep);
  }

  let removed = 0;
  for (const entry of all) {
    if (keepIds.has(entry.id)) continue;
    store.deleteById("pending_analysis", entry.id);
    removed += 1;
  }
  return { removed };
}

export function clearPendingDismissals(store: JsonStore): { cleared: number } {
  const dismissals = listDismissals(store);
  for (const d of dismissals) {
    store.deleteById("pending_dismissals", d.id);
  }
  return { cleared: dismissals.length };
}

function startOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function scriptInDateRange(createdAt: string, daysBack: number, dateTag?: string): boolean {
  if (dateTag) {
    return String(createdAt || "").startsWith(dateTag);
  }
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = startOfDayLocal(new Date());
  cutoff.setDate(cutoff.getDate() - Math.max(0, daysBack - 1));
  return d >= cutoff;
}

function mp3InDateRange(mp3Path: string, daysBack: number, dateTag?: string): boolean {
  const basename = path.basename(mp3Path);
  const dateMatch = basename.match(/_(\d{4}-\d{2}-\d{2})\.mp3$/i);
  if (dateMatch) {
    if (dateTag) return dateMatch[1] === dateTag;
    return scriptInDateRange(`${dateMatch[1]}T12:00:00`, daysBack);
  }
  try {
    return scriptInDateRange(fs.statSync(mp3Path).mtime.toISOString(), daysBack, dateTag);
  } catch {
    return false;
  }
}

function statsFromResponse(raw: Record<string, unknown>, capturedAt: string): TikTokStatsSnapshot {
  return {
    views: raw.views != null ? Number(raw.views) : null,
    likes: raw.likes != null ? Number(raw.likes) : null,
    comments: raw.comments != null ? Number(raw.comments) : null,
    reposts: raw.reposts != null ? Number(raw.reposts) : null,
    saves: raw.saves != null ? Number(raw.saves) : null,
    views_text: raw.views_text != null ? String(raw.views_text) : undefined,
    likes_text: raw.likes_text != null ? String(raw.likes_text) : undefined,
    comments_text: raw.comments_text != null ? String(raw.comments_text) : undefined,
    captured_at: capturedAt,
  };
}

export async function fetchTikTokStats(url: string): Promise<TikTokStatsSnapshot> {
  let res: Response;
  try {
    res = await fetch(`${WHISPER_URL}/tiktok-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error(
      "Whisper server is not running. Start tiktok-hook-analyzer/whisper-server/start.bat, then try again."
    );
  }

  let data: { ok?: boolean; tiktok_stats?: Record<string, unknown>; error?: string };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error(`Whisper server returned an invalid response (HTTP ${res.status}).`);
  }

  if (!res.ok || !data.ok || !data.tiktok_stats) {
    const detail = data.error?.trim();
    throw new Error(
      detail ||
        "Could not fetch TikTok stats. Check the URL, ensure whisper-server is running, and refresh cookies.txt if yt-dlp is blocked."
    );
  }
  return statsFromResponse(data.tiktok_stats, nowIso());
}

function captionFieldsFromScript(script: Record<string, unknown> | undefined) {
  return {
    on_screen_caption: String(script?.on_screen_caption || ""),
    tiktok_caption: String(script?.tiktok_caption || ""),
  };
}

export function syncPendingCaptionsFromScript(
  store: JsonStore,
  pendingId: string,
  overrides?: { on_screen_caption?: string; tiktok_caption?: string; script_title?: string }
): PendingAnalysis | null {
  const entry = store.list<PendingAnalysis>("pending_analysis").find((p) => p.id === pendingId);
  if (!entry) return null;
  const script = store
    .list<Record<string, unknown>>("scripts")
    .find((s) => s.id === entry.source_script_id);
  const fromScript = captionFieldsFromScript(script);
  const updated: PendingAnalysis = {
    ...entry,
    on_screen_caption:
      overrides?.on_screen_caption !== undefined
        ? overrides.on_screen_caption
        : fromScript.on_screen_caption || entry.on_screen_caption || "",
    tiktok_caption:
      overrides?.tiktok_caption !== undefined
        ? overrides.tiktok_caption
        : fromScript.tiktok_caption || entry.tiktok_caption || "",
    script_title:
      overrides?.script_title !== undefined
        ? overrides.script_title
        : String(script?.title || entry.script_title),
    updated_at: nowIso(),
  };
  store.upsertById("pending_analysis", updated);
  return updated;
}

export function listPendingAnalysis(store: JsonStore): PendingAnalysis[] {
  const scripts = new Map(
    store.list<Record<string, unknown>>("scripts").map((s) => [String(s.id), s])
  );
  return store
    .list<PendingAnalysis>("pending_analysis")
    .map((p) => {
      const script = scripts.get(p.source_script_id);
      const scriptCreated =
        p.script_created_at ||
        String(script?.created_at || p.drive_uploaded_at || p.created_at || "");
      const fromScript = captionFieldsFromScript(script);
      const merged: PendingAnalysis = {
        ...p,
        script_created_at: scriptCreated,
        on_screen_caption: p.on_screen_caption ?? fromScript.on_screen_caption,
        tiktok_caption: p.tiktok_caption ?? fromScript.tiktok_caption,
      };
      return normalizePendingAnalysis(store, merged);
    })
    .sort((a, b) => b.script_created_at.localeCompare(a.script_created_at));
}

export function createPendingFromDriveUpload(
  store: JsonStore,
  opts: {
    scriptId: string;
    scriptTitle: string;
    productId: string;
    productName: string;
    mp4Path: string;
    folderPath: string;
    uploadedAt: string;
  }
): PendingAnalysis {
  if (isPendingDismissed(store, opts.scriptId)) {
    throw new Error("This script was removed from pending analysis.");
  }
  if (isScriptInMyVideos(store, opts.scriptId)) {
    throw new Error("This script is already in My Videos and cannot be added to pending analysis.");
  }

  const script = store
    .list<Record<string, unknown>>("scripts")
    .find((s) => s.id === opts.scriptId);
  const scriptCreatedAt = String(script?.created_at || opts.uploadedAt || nowIso());
  const captions = captionFieldsFromScript(script);

  const existing = store
    .list<PendingAnalysis>("pending_analysis")
    .find((p) => p.source_script_id === opts.scriptId && p.status !== "complete");
  if (existing) {
    store.upsertById("pending_analysis", {
      ...existing,
      ...captions,
      script_title: String(script?.title || existing.script_title),
      drive_mp4_path: opts.mp4Path,
      drive_uploaded_at: opts.uploadedAt,
      drive_folder_path: opts.folderPath,
      updated_at: nowIso(),
    });
    return {
      ...existing,
      ...captions,
      drive_mp4_path: opts.mp4Path,
      drive_uploaded_at: opts.uploadedAt,
      drive_folder_path: opts.folderPath,
    };
  }

  const createdAt = nowIso();
  const entry: PendingAnalysis = {
    id: randomUUID(),
    source_script_id: opts.scriptId,
    script_title: opts.scriptTitle,
    product_id: opts.productId,
    product_name: opts.productName,
    script_created_at: scriptCreatedAt,
    on_screen_caption: captions.on_screen_caption,
    tiktok_caption: captions.tiktok_caption,
    drive_mp4_path: opts.mp4Path,
    drive_uploaded_at: opts.uploadedAt,
    drive_folder_path: opts.folderPath,
    tiktok_url: "",
    thumbnail_url: null,
    url_added_at: null,
    initial_stats: null,
    latest_stats: null,
    analysis: null,
    analysis_status: "pending",
    analysis_error: "",
    views: null,
    likes: null,
    comments: null,
    upload_date: "",
    watch_time_seconds: null,
    watch_time_pct: null,
    sales: null,
    gmv: null,
    commission: null,
    audience_male_pct: null,
    audience_female_pct: null,
    audience_other_pct: null,
    score: null,
    status: "awaiting_url",
    linked_my_video_id: null,
    linked_memory_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: null,
  };
  store.upsertById("pending_analysis", entry);
  return entry;
}

function resolveMp4PathForScript(script: Record<string, unknown>): string {
  const drive = String(script.drive_mp4_path || "").trim();
  if (drive && fs.existsSync(drive)) return drive;
  const audio = String(script.audio_path || "").trim();
  if (audio) {
    const mp4 = path.join(path.dirname(audio), "mp4", path.basename(audio).replace(/\.mp3$/i, ".mp4"));
    if (fs.existsSync(mp4)) return mp4;
  }
  return drive;
}

function matchProductFromStem(stem: string, products: Record<string, unknown>[]): Record<string, unknown> | null {
  const norm = stem.toLowerCase().replace(/[-_]/g, " ");
  let best: Record<string, unknown> | null = null;
  let bestScore = 0;
  for (const p of products) {
    const tokens = new Set<string>();
    for (const part of [p.name, p.brand]) {
      if (!part) continue;
      for (const t of String(part).toLowerCase().split(/\W+/)) {
        if (t.length >= 4) tokens.add(t);
      }
    }
    let score = 0;
    for (const t of tokens) {
      if (norm.includes(t)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 1 ? best : null;
}

function titleFromAudioStem(stem: string): string {
  return stem
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function recoverSsmlFromAlignment(alignmentPath: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(alignmentPath, "utf8")) as { characters?: string[] };
    if (!Array.isArray(raw.characters)) return "";
    return raw.characters.join("");
  } catch {
    return "";
  }
}

function stripSsmlToPlain(ssml: string): string {
  return ssml
    .replace(/<break[^>]*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scriptUsesAudioPath(scripts: Record<string, unknown>[], mp3Path: string): boolean {
  const base = path.basename(mp3Path).toLowerCase();
  return scripts.some((s) => path.basename(String(s.audio_path || "")).toLowerCase() === base);
}

function ensureScriptFromOrphanMp3(
  store: JsonStore,
  mp3Path: string,
  dateTag: string
): Record<string, unknown> {
  const scripts = store.list<Record<string, unknown>>("scripts");
  const existing = scripts.find(
    (s) => path.basename(String(s.audio_path || "")).toLowerCase() === path.basename(mp3Path).toLowerCase()
  );
  if (existing) return existing;

  const stem = path.basename(mp3Path, ".mp3").replace(/_\d{4}-\d{2}-\d{2}$/, "");
  const products = store.list<Record<string, unknown>>("products");
  const product = matchProductFromStem(stem, products);
  const alignmentPath = mp3Path.replace(/\.mp3$/i, "-alignment.json");
  const ssml = fs.existsSync(alignmentPath) ? recoverSsmlFromAlignment(alignmentPath) : "";
  const scriptText = ssml ? stripSsmlToPlain(ssml) : "";
  const mp4Path = path.join(path.dirname(mp3Path), "mp4", path.basename(mp3Path).replace(/\.mp3$/i, ".mp4"));
  const mp4Stat = fs.existsSync(mp4Path) ? fs.statSync(mp4Path) : null;
  const mp3Stat = fs.statSync(mp3Path);
  const createdAt = mp4Stat?.mtime.toISOString() || mp3Stat.mtime.toISOString();

  const script: Record<string, unknown> = {
    id: randomUUID(),
    product_id: String(product?.id || ""),
    hook_type: "curiosity gap",
    funnel_style: "curiosity gap",
    title: titleFromAudioStem(stem),
    script_text: scriptText,
    ssml: ssml || "",
    on_screen_caption: "",
    tiktok_caption: "",
    audio_path: mp3Path,
    prompt_context: JSON.stringify({ recoveredFromAudio: true, dateTag }),
    reference_library_id: null,
    created_at: createdAt,
    drive_mp4_path: fs.existsSync(mp4Path) ? mp4Path : "",
    drive_uploaded_at: mp4Stat?.mtime.toISOString() || createdAt,
  };
  store.upsertById("scripts", script as { id: string });
  return script;
}

export function batchAddOrphanAudioToPending(
  store: JsonStore,
  opts: { dateTag?: string; daysBack?: number } = {}
): {
  added: number;
  scriptsCreated: number;
  skipped: number;
  skippedMyVideos: number;
  dismissed: number;
  total: number;
} {
  const daysBack = opts.daysBack ?? 1;
  const audioDir = path.join(app.getPath("userData"), "audio");
  if (!fs.existsSync(audioDir)) {
    return { added: 0, scriptsCreated: 0, skipped: 0, skippedMyVideos: 0, dismissed: 0, total: 0 };
  }

  const mp3Files = fs
    .readdirSync(audioDir)
    .filter((name) => name.toLowerCase().endsWith(".mp3"))
    .map((name) => path.join(audioDir, name))
    .filter((p) => mp3InDateRange(p, daysBack, opts.dateTag));

  let added = 0;
  let scriptsCreated = 0;
  let skipped = 0;
  let skippedMyVideos = 0;
  let dismissed = 0;

  for (const mp3Path of mp3Files) {
    const audioBase = path.basename(mp3Path).toLowerCase();
    const scriptsBefore = store.list<Record<string, unknown>>("scripts");
    const hadScript = scriptUsesAudioPath(scriptsBefore, mp3Path);
    const script = ensureScriptFromOrphanMp3(store, mp3Path, opts.dateTag || nowIso().slice(0, 10));
    if (!hadScript) scriptsCreated += 1;

    const scriptId = String(script.id);
    if (isPendingDismissed(store, scriptId, audioBase)) {
      dismissed += 1;
      continue;
    }
    if (isScriptInMyVideos(store, scriptId)) {
      skippedMyVideos += 1;
      continue;
    }

    const existing = store
      .list<PendingAnalysis>("pending_analysis")
      .find((p) => p.source_script_id === scriptId && p.status !== "complete");
    if (existing) {
      syncPendingCaptionsFromScript(store, existing.id);
      skipped += 1;
      continue;
    }
    createPendingFromScript(store, scriptId);
    added += 1;
  }

  return { added, scriptsCreated, skipped, skippedMyVideos, dismissed, total: mp3Files.length };
}

export function createPendingFromScript(store: JsonStore, scriptId: string): PendingAnalysis {
  const script = store.list<Record<string, unknown>>("scripts").find((s) => s.id === scriptId);
  if (!script) throw new Error("Script not found.");

  const audioPath = String(script.audio_path || "");
  if (isPendingDismissed(store, scriptId, audioPath)) {
    throw new Error("This script was removed from pending analysis.");
  }

  if (isScriptInMyVideos(store, scriptId)) {
    throw new Error("This script is already in My Videos and cannot be added to pending analysis.");
  }

  const existing = store
    .list<PendingAnalysis>("pending_analysis")
    .find((p) => p.source_script_id === scriptId && p.status !== "complete");
  if (existing) {
    return syncPendingCaptionsFromScript(store, existing.id) || existing;
  }

  const product = store
    .list<Record<string, unknown>>("products")
    .find((p) => p.id === script.product_id);
  const productName = String(product?.name || script.title || "Voiceover");
  const mp4Path = resolveMp4PathForScript(script);
  const uploadedAt = String(script.drive_uploaded_at || script.created_at || nowIso());
  const rootFolder =
    store.getSetting("googleDriveRootFolder", "TikTok - Voiceovers").trim() || "TikTok - Voiceovers";
  const folderPath = mp4Path
    ? buildDriveFolderPath(
        rootFolder,
        todayDriveDateKey(new Date(uploadedAt)),
        productFolderNameFromProductName(productName)
      )
    : "";

  return createPendingFromDriveUpload(store, {
    scriptId,
    scriptTitle: String(script.title || "Script voiceover"),
    productId: String(script.product_id || ""),
    productName,
    mp4Path,
    folderPath,
    uploadedAt,
  });
}

export function batchAddScriptsToPending(
  store: JsonStore,
  opts: { dateTag?: string; daysBack?: number } = {}
): {
  added: number;
  skipped: number;
  skippedMyVideos: number;
  dismissed: number;
  total: number;
  orphanAdded: number;
  scriptsCreated: number;
  orphanSkipped: number;
  orphanSkippedMyVideos: number;
  orphanDismissed: number;
  orphanTotal: number;
} {
  const daysBack = opts.daysBack ?? 1;
  const scripts = store
    .list<Record<string, unknown>>("scripts")
    .filter((s) => scriptInDateRange(String(s.created_at || ""), daysBack, opts.dateTag));

  let added = 0;
  let skipped = 0;
  let skippedMyVideos = 0;
  let dismissed = 0;
  for (const script of scripts) {
    const scriptId = String(script.id);
    const audioPath = String(script.audio_path || "");
    if (isPendingDismissed(store, scriptId, audioPath)) {
      dismissed += 1;
      continue;
    }
    if (isScriptInMyVideos(store, scriptId)) {
      skippedMyVideos += 1;
      continue;
    }
    const existing = store
      .list<PendingAnalysis>("pending_analysis")
      .find((p) => p.source_script_id === scriptId && p.status !== "complete");
    if (existing) {
      syncPendingCaptionsFromScript(store, existing.id);
      skipped += 1;
      continue;
    }
    createPendingFromScript(store, scriptId);
    added += 1;
  }

  const orphan = batchAddOrphanAudioToPending(store, opts);
  return {
    added: added + orphan.added,
    skipped: skipped + orphan.skipped,
    skippedMyVideos: skippedMyVideos + orphan.skippedMyVideos,
    dismissed: dismissed + orphan.dismissed,
    total: scripts.length + orphan.total,
    orphanAdded: orphan.added,
    scriptsCreated: orphan.scriptsCreated,
    orphanSkipped: orphan.skipped,
    orphanSkippedMyVideos: orphan.skippedMyVideos,
    orphanDismissed: orphan.dismissed,
    orphanTotal: orphan.total,
  };
}

export function batchAddTodayScriptsToPending(
  store: JsonStore,
  dateTag?: string
): {
  added: number;
  skipped: number;
  skippedMyVideos: number;
  dismissed: number;
  total: number;
  orphanAdded: number;
  scriptsCreated: number;
  orphanSkipped: number;
  orphanSkippedMyVideos: number;
  orphanDismissed: number;
  orphanTotal: number;
} {
  return batchAddScriptsToPending(store, { dateTag, daysBack: 1 });
}

export async function setPendingTikTokUrl(
  store: JsonStore,
  id: string,
  url: string
): Promise<PendingAnalysis> {
  const entry = store.list<PendingAnalysis>("pending_analysis").find((p) => p.id === id);
  if (!entry) throw new Error("Pending analysis entry not found.");
  if (entry.status === "complete") throw new Error("This entry is already complete.");

  const trimmed = url.trim();
  if (!trimmed.includes("tiktok.com")) throw new Error("Enter a valid TikTok video URL.");

  const conflict = checkTikTokUrlConflict(store, trimmed, id);
  if (conflict) {
    throw new Error(formatTikTokUrlConflict(conflict));
  }

  const savedAt = nowIso();
  store.upsertById("pending_analysis", {
    ...entry,
    tiktok_url: trimmed,
    url_added_at: savedAt,
    updated_at: savedAt,
  });

  const initialStats = await fetchTikTokStats(trimmed);
  const updated: PendingAnalysis = {
    ...entry,
    tiktok_url: trimmed,
    url_added_at: savedAt,
    initial_stats: initialStats,
    views: initialStats.views,
    likes: initialStats.likes,
    comments: initialStats.comments,
    status: "tracking",
    updated_at: nowIso(),
  };
  store.upsertById("pending_analysis", updated);
  return updated;
}

export async function pullPendingStatsAndAnalyse(
  store: JsonStore,
  id: string
): Promise<PendingAnalysis> {
  const entry = store.list<PendingAnalysis>("pending_analysis").find((p) => p.id === id);
  if (!entry) throw new Error("Pending analysis entry not found.");
  if (!entry.tiktok_url) throw new Error("Add a TikTok URL first.");
  if (entry.status === "complete") throw new Error("This entry is already complete.");

  store.upsertById("pending_analysis", {
    ...entry,
    analysis_status: "analysing",
    analysis_error: "",
    updated_at: nowIso(),
  });

  try {
    const latestStats = await fetchTikTokStats(entry.tiktok_url);
    const analysis = await analyseTikTokUrl(store, entry.tiktok_url);
    const duration = getAnalysisDurationSeconds(analysis);
    const normalizedAnalysis =
      duration != null && analysis.duration_seconds !== duration
        ? { ...analysis, duration_seconds: duration }
        : analysis;

    const updated: PendingAnalysis = {
      ...entry,
      latest_stats: latestStats,
      views: latestStats.views ?? entry.views,
      likes: latestStats.likes ?? entry.likes,
      comments: latestStats.comments ?? entry.comments,
      analysis: normalizedAnalysis,
      thumbnail_url: normalizedAnalysis.thumbnail_url ?? entry.thumbnail_url,
      analysis_status: "complete",
      analysis_error: "",
      status: "ready_for_review",
      updated_at: nowIso(),
    };
    store.upsertById("pending_analysis", updated);
    return updated;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.upsertById("pending_analysis", {
      ...entry,
      analysis_status: "error",
      analysis_error: msg,
      updated_at: nowIso(),
    });
    throw err;
  }
}

function scoreToRating(score: number): number {
  if (score >= 81) return 5;
  if (score >= 61) return 4;
  if (score >= 41) return 3;
  if (score >= 21) return 2;
  return 1;
}

function pendingVideoDurationSeconds(entry: PendingAnalysis): number | null {
  return getAnalysisDurationSeconds(entry.analysis);
}

async function resolvePendingThumbnail(
  entry: PendingAnalysis,
  watchTimeSaved: boolean
): Promise<string | null> {
  if (entry.thumbnail_url) return entry.thumbnail_url;
  if (entry.analysis?.thumbnail_url) return entry.analysis.thumbnail_url;
  if (!watchTimeSaved || !entry.tiktok_url?.trim()) return null;
  return fetchVideoThumbnail(entry.tiktok_url);
}

function normalizePendingAnalysis(store: JsonStore, entry: PendingAnalysis): PendingAnalysis {
  if (!entry.analysis) return entry;
  const duration = getAnalysisDurationSeconds(entry.analysis);
  if (duration == null || entry.analysis.duration_seconds === duration) return entry;
  const normalized: PendingAnalysis = {
    ...entry,
    analysis: { ...entry.analysis, duration_seconds: duration },
  };
  store.upsertById("pending_analysis", normalized);
  return normalized;
}

export async function updatePendingPerformanceData(
  store: JsonStore,
  id: string,
  data: PendingAnalysisSubmit
): Promise<PendingAnalysis> {
  const entry = store.list<PendingAnalysis>("pending_analysis").find((p) => p.id === id);
  if (!entry) throw new Error("Pending analysis entry not found.");
  if (entry.status === "complete") throw new Error("This entry is already complete.");
  if (entry.status === "awaiting_url") {
    throw new Error("Add a TikTok URL before entering performance data.");
  }

  const watchTime = resolveWatchTimeFromSubmit({
    watch_time_seconds: data.watch_time_seconds,
    watch_time_pct: data.watch_time_pct,
    durationSeconds: pendingVideoDurationSeconds(entry),
  });
  const watchTimeSaved =
    watchTime.watch_time_seconds != null || watchTime.watch_time_pct != null;
  const thumbnail_url = await resolvePendingThumbnail(entry, watchTimeSaved);

  const updated: PendingAnalysis = {
    ...entry,
    upload_date: data.upload_date?.trim() || entry.upload_date,
    watch_time_seconds: watchTime.watch_time_seconds,
    watch_time_pct: watchTime.watch_time_pct,
    thumbnail_url: thumbnail_url ?? entry.thumbnail_url,
    sales: data.sales,
    gmv: data.gmv,
    commission: data.commission,
    audience_male_pct: data.audience_male_pct,
    audience_female_pct: data.audience_female_pct,
    audience_other_pct: data.audience_other_pct,
    views: data.views ?? entry.views,
    likes: data.likes ?? entry.likes,
    comments: data.comments ?? entry.comments,
    updated_at: nowIso(),
  };
  store.upsertById("pending_analysis", updated);
  return updated;
}

export async function submitPendingAnalysis(
  store: JsonStore,
  id: string,
  data: PendingAnalysisSubmit
): Promise<{ pending: PendingAnalysis; myVideoId: string; memoryId: string; score: number }> {
  const entry = store.list<PendingAnalysis>("pending_analysis").find((p) => p.id === id);
  if (!entry) throw new Error("Pending analysis entry not found.");
  if (entry.status !== "ready_for_review") {
    throw new Error("Pull stats and run Grok analysis before submitting.");
  }
  if (!entry.tiktok_url) throw new Error("TikTok URL is required.");
  if (!data.upload_date?.trim()) throw new Error("Upload date is required.");

  const watchTime = resolveWatchTimeFromSubmit({
    watch_time_seconds: data.watch_time_seconds,
    watch_time_pct: data.watch_time_pct,
    durationSeconds: pendingVideoDurationSeconds(entry),
  });
  if (watchTime.watch_time_pct == null) {
    throw new Error("Average watch time (seconds) is required.");
  }

  if (data.sales == null && data.gmv == null && data.commission == null) {
    throw new Error("Enter at least one of sales, GMV, or commission.");
  }

  const thumbnail_url = await resolvePendingThumbnail(entry, true);

  const completedAt = nowIso();
  const myVideoId = randomUUID();
  const memoryId = randomUUID();

  const myVideo: MyVideo = {
    id: myVideoId,
    url: entry.tiktok_url,
    thumbnail_url,
    views: data.views ?? entry.views,
    likes: data.likes ?? entry.likes,
    comments: data.comments ?? entry.comments,
    watch_time_seconds: watchTime.watch_time_seconds,
    watch_time_pct: watchTime.watch_time_pct,
    sales: data.sales,
    gmv: data.gmv,
    commission: data.commission,
    audience_male_pct: data.audience_male_pct,
    audience_female_pct: data.audience_female_pct,
    audience_other_pct: data.audience_other_pct,
    upload_date: data.upload_date,
    submitted_at: completedAt,
    analysis: entry.analysis,
    analysis_status: "complete",
    analysis_error: "",
    score: null,
    created_at: completedAt,
    updated_at: completedAt,
    title: entry.script_title,
    hook: entry.analysis?.onscreen_hook || undefined,
    key_message: entry.analysis?.video_structure?.slice(0, 200),
  };
  myVideo.score = scoreMyVideo(myVideo);

  store.upsertById("my_videos", myVideo as unknown as typeof myVideo);

  const hookText =
    entry.analysis?.onscreen_hook ||
    entry.analysis?.hook_type ||
    entry.script_title;
  const whatWorked = [
    entry.analysis?.detailed_analysis?.slice(0, 400),
    entry.analysis?.pacing_notes ? `Pacing: ${entry.analysis.pacing_notes}` : "",
    `Score: ${myVideo.score}/100`,
    entry.initial_stats && entry.latest_stats
      ? `Views ${entry.initial_stats.views ?? "?"} → ${entry.latest_stats.views ?? "?"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const memoryPayload = {
    id: memoryId,
    source: "pending_analysis",
    source_script_id: entry.source_script_id,
    source_hook: hookText,
    my_video_url: entry.tiktok_url,
    my_video_id: myVideoId,
    my_views: entry.views ?? 0,
    my_likes: entry.likes ?? 0,
    my_sales: data.sales ?? 0,
    my_gmv: data.gmv ?? 0,
    my_watch_time: watchTime.watch_time_pct ?? 0,
    rating: scoreToRating(myVideo.score ?? 0),
    what_i_took: whatWorked,
    notes: entry.analysis?.detailed_analysis || "",
    hook_type: entry.analysis?.hook_type || "",
    funnel_category: entry.analysis?.funnel_category || "",
    product_name: entry.product_name,
    script_title: entry.script_title,
    date_used: data.upload_date,
    pending_analysis_id: entry.id,
  };

  store.upsertById("positive_memory", {
    id: memoryId,
    payload_json: JSON.stringify(memoryPayload),
    rating: memoryPayload.rating,
    my_views: memoryPayload.my_views,
    my_gmv: memoryPayload.my_gmv,
    what_i_took: whatWorked.slice(0, 500),
    date_used: data.upload_date,
    imported_at: completedAt,
    entry_type: "own_video",
    source: "pending_analysis",
    my_video_id: myVideoId,
    title: entry.script_title,
    hook_type: entry.analysis?.hook_type || "",
  });

  const script = store
    .list<Record<string, unknown>>("scripts")
    .find((s) => s.id === entry.source_script_id);
  const captions = captionFieldsFromScript(script);
  if (script) {
    store.upsertById("scripts", {
      ...(script as { id: string }),
      linked_my_video_id: myVideoId,
      linked_pending_analysis_id: entry.id,
    });
  }

  const pending: PendingAnalysis = {
    ...entry,
    on_screen_caption: entry.on_screen_caption || captions.on_screen_caption,
    tiktok_caption: entry.tiktok_caption || captions.tiktok_caption,
    upload_date: data.upload_date,
    watch_time_seconds: watchTime.watch_time_seconds,
    watch_time_pct: watchTime.watch_time_pct,
    thumbnail_url: thumbnail_url ?? entry.thumbnail_url,
    sales: data.sales,
    gmv: data.gmv,
    commission: data.commission,
    audience_male_pct: data.audience_male_pct,
    audience_female_pct: data.audience_female_pct,
    audience_other_pct: data.audience_other_pct,
    score: myVideo.score,
    status: "complete",
    linked_my_video_id: myVideoId,
    linked_memory_id: memoryId,
    completed_at: completedAt,
    updated_at: completedAt,
  };
  store.upsertById("pending_analysis", pending);

  saveVideoOutcome(store, {
    pending,
    submit: { ...data, ...watchTime },
    score: myVideo.score ?? 0,
    myVideoId,
    memoryId,
    script: {
      ...(script || {}),
      on_screen_caption: pending.on_screen_caption,
      tiktok_caption: pending.tiktok_caption,
    },
  });

  return { pending, myVideoId, memoryId, score: myVideo.score ?? 0 };
}

export function resetPendingAfterScriptEdit(store: JsonStore, pendingId: string): PendingAnalysis {
  const entry = store.list<PendingAnalysis>("pending_analysis").find((p) => p.id === pendingId);
  if (!entry) throw new Error("Pending analysis entry not found.");
  if (entry.status === "complete") throw new Error("Cannot reset a completed entry.");

  const reset: PendingAnalysis = {
    ...entry,
    tiktok_url: "",
    thumbnail_url: null,
    url_added_at: null,
    initial_stats: null,
    latest_stats: null,
    analysis: null,
    analysis_status: "pending",
    analysis_error: "",
    views: null,
    likes: null,
    comments: null,
    status: "awaiting_url",
    updated_at: nowIso(),
  };
  store.upsertById("pending_analysis", reset);
  return reset;
}

export function deletePendingAnalysis(store: JsonStore, id: string, deleteScript = false): void {
  const entry = store.list<PendingAnalysis>("pending_analysis").find((p) => p.id === id);
  if (!entry) throw new Error("Pending analysis entry not found.");

  const script = entry.source_script_id
    ? store.list<Record<string, unknown>>("scripts").find((s) => s.id === entry.source_script_id)
    : null;
  const audioPath = String(script?.audio_path || entry.drive_mp4_path || "");
  recordPendingDismissal(store, entry.source_script_id, audioPath);

  const outcomes = store
    .list<{ id: string; pending_analysis_id: string }>("video_outcomes")
    .filter((o) => o.pending_analysis_id === id);
  for (const o of outcomes) {
    store.deleteById("video_outcomes", o.id);
  }

  if (deleteScript) {
    if (entry.linked_memory_id) {
      store.deleteById("positive_memory", entry.linked_memory_id);
    }
    if (entry.linked_my_video_id) {
      store.deleteById("my_videos", entry.linked_my_video_id);
    }
    if (entry.source_script_id) {
      store.deleteById("scripts", entry.source_script_id);
    }
  }

  store.deleteById("pending_analysis", id);
}
