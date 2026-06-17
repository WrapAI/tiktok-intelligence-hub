#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

function resolveAppDataRoot() {
  const base = path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "tiktok-intelligence-hub"
  );
  const devPath = path.join(base, "chromium-cache", "tiktok-intelligence-hub");
  return fs.existsSync(devPath) ? devPath : base;
}

function nowIso() {
  return new Date().toISOString();
}

function resolveMp4Path(script) {
  const drive = String(script.drive_mp4_path || "").trim();
  if (drive && fs.existsSync(drive)) return drive;
  const audio = String(script.audio_path || "").trim();
  if (audio) {
    const mp4 = path.join(path.dirname(audio), "mp4", path.basename(audio).replace(/\.mp3$/i, ".mp4"));
    if (fs.existsSync(mp4)) return mp4;
  }
  return drive;
}

function matchProductFromStem(stem, products) {
  const norm = stem.toLowerCase().replace(/[-_]/g, " ");
  let best = null;
  let bestScore = 0;
  for (const p of products) {
    const tokens = new Set();
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

function titleFromAudioStem(stem) {
  return stem
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function recoverSsmlFromAlignment(alignmentPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(alignmentPath, "utf8"));
    if (!Array.isArray(raw.characters)) return "";
    return raw.characters.join("");
  } catch {
    return "";
  }
}

function stripSsmlToPlain(ssml) {
  return ssml
    .replace(/<break[^>]*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureScriptFromOrphanMp3(mp3Path, scripts, products, dateTag) {
  const base = path.basename(mp3Path).toLowerCase();
  const existing = scripts.find((s) => path.basename(String(s.audio_path || "")).toLowerCase() === base);
  if (existing) return { script: existing, created: false };

  const stem = path.basename(mp3Path, ".mp3").replace(/_\d{4}-\d{2}-\d{2}$/, "");
  const product = matchProductFromStem(stem, products);
  const alignmentPath = mp3Path.replace(/\.mp3$/i, "-alignment.json");
  const ssml = fs.existsSync(alignmentPath) ? recoverSsmlFromAlignment(alignmentPath) : "";
  const scriptText = ssml ? stripSsmlToPlain(ssml) : "";
  const mp4Path = path.join(path.dirname(mp3Path), "mp4", path.basename(mp3Path).replace(/\.mp3$/i, ".mp4"));
  const mp4Stat = fs.existsSync(mp4Path) ? fs.statSync(mp4Path) : null;
  const mp3Stat = fs.statSync(mp3Path);
  const createdAt = mp4Stat?.mtime.toISOString() || mp3Stat.mtime.toISOString();

  const script = {
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
  scripts.push(script);
  return { script, created: true };
}

function createEntry(script, productName, pending) {
  const existing = pending.find((p) => p.source_script_id === script.id && p.status !== "complete");
  if (existing) return { entry: existing, created: false };

  const mp4Path = resolveMp4Path(script);
  const uploadedAt = String(script.drive_uploaded_at || script.created_at || nowIso());
  const createdAt = nowIso();
  const entry = {
    id: randomUUID(),
    source_script_id: script.id,
    script_title: String(script.title || "Script voiceover"),
    product_id: String(script.product_id || ""),
    product_name: productName,
    drive_mp4_path: mp4Path,
    drive_uploaded_at: uploadedAt,
    drive_folder_path: mp4Path ? `TikTok - Voiceovers / ${productName.split("|")[0].slice(0, 48)}` : "",
    tiktok_url: "",
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
  pending.push(entry);
  return { entry, created: true };
}

const dateArg = process.argv[2];
const today = dateArg || nowIso().slice(0, 10);
const root = resolveAppDataRoot();
const dbDir = path.join(root, "database");
const scriptsPath = path.join(dbDir, "scripts.json");
const scripts = JSON.parse(fs.readFileSync(scriptsPath, "utf8"));
const products = JSON.parse(fs.readFileSync(path.join(dbDir, "products.json"), "utf8"));
const pendingPath = path.join(dbDir, "pending_analysis.json");
const pending = fs.existsSync(pendingPath) ? JSON.parse(fs.readFileSync(pendingPath, "utf8")) : [];

const todayScripts = scripts.filter((s) => String(s.created_at || "").startsWith(today));
let added = 0;
let skipped = 0;
let scriptsCreated = 0;

for (const script of todayScripts) {
  const product = products.find((p) => p.id === script.product_id);
  const productName = product?.name || script.title || "Voiceover";
  const { created } = createEntry(script, productName, pending);
  if (created) {
    added += 1;
    console.log(`+ ${script.title}`);
  } else {
    skipped += 1;
  }
}

const audioDir = path.join(root, "audio");
const suffix = `_${today}.mp3`;
if (fs.existsSync(audioDir)) {
  const mp3Files = fs
    .readdirSync(audioDir)
    .filter((name) => name.toLowerCase().endsWith(suffix.toLowerCase()))
    .map((name) => path.join(audioDir, name));

  for (const mp3Path of mp3Files) {
    const { script, created: newScript } = ensureScriptFromOrphanMp3(mp3Path, scripts, products, today);
    if (newScript) {
      scriptsCreated += 1;
      console.log(`* recovered script: ${script.title}`);
    }
    const product = products.find((p) => p.id === script.product_id);
    const productName = product?.name || script.title || "Voiceover";
    const { created } = createEntry(script, productName, pending);
    if (created) {
      added += 1;
      console.log(`+ ${script.title}`);
    } else {
      skipped += 1;
    }
  }
}

fs.writeFileSync(scriptsPath, JSON.stringify(scripts, null, 2), "utf8");
fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2), "utf8");
console.log(
  `\nDone: ${added} pending added, ${skipped} skipped, ${scriptsCreated} scripts recovered from audio, ${todayScripts.length} scripts dated ${today}`
);
