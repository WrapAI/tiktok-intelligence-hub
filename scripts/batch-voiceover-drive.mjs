#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { google } from "googleapis";

const WHISPER_URL = "http://localhost:5050";
const DEFAULT_CLIENT_ID =
  "609584253079-uvigalsnk0118tbn7s51ecrgh87atf6o.apps.googleusercontent.com";
const DEFAULT_ROOT_FOLDER = "TikTok - Voiceovers";

function resolveAppDataRoot() {
  const base = path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "tiktok-intelligence-hub"
  );
  const devPath = path.join(base, "chromium-cache", "tiktok-intelligence-hub");
  return fs.existsSync(devPath) ? devPath : base;
}

function shortFolderName(fullName) {
  const clean = fullName.split("|")[0].split("–")[0].trim();
  if (clean.length <= 48) return clean;
  return clean.split(/\s+/).slice(0, 4).join(" ");
}

function matchProduct(stem, products) {
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

async function convertMp3ToMp4(mp3Path, mp4Path) {
  const res = await fetch(`${WHISPER_URL}/mp3-to-mp4`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mp3_path: mp3Path, mp4_path: mp4Path }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json();
  if (!res.ok || !data.ok || !data.mp4_path) {
    throw new Error(data.error || "MP3→MP4 conversion failed");
  }
  return data.mp4_path;
}

async function getDriveClient(userDataRoot, settings) {
  const clientId = settings.googleDriveClientId?.trim() || DEFAULT_CLIENT_ID;
  const clientSecret = settings.googleDriveClientSecret?.trim();
  if (!clientSecret) throw new Error("Google Drive client secret missing in settings.json");

  const tokenPath = path.join(userDataRoot, "google-drive-token.json");
  if (!fs.existsSync(tokenPath)) throw new Error("Google Drive not connected — connect in Hub Settings");

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, "utf8")));

  if (client.credentials.expiry_date && client.credentials.expiry_date <= Date.now() + 60_000) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    fs.writeFileSync(tokenPath, JSON.stringify(credentials, null, 2), "utf8");
  }

  return { client, drive: google.drive({ version: "v3", auth: client }) };
}

async function getOrCreateFolder(drive, name, parentId) {
  const escaped = name.replace(/'/g, "\\'");
  let query = `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const existing = await drive.files.list({ q: query, fields: "files(id,name)", spaces: "drive" });
  if (existing.data.files?.[0]?.id) return existing.data.files[0].id;
  const metadata = { name, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) metadata.parents = [parentId];
  const created = await drive.files.create({ requestBody: metadata, fields: "id" });
  if (!created.data.id) throw new Error(`Could not create folder: ${name}`);
  return created.data.id;
}

async function deleteExistingFile(drive, name, folderId) {
  const escaped = name.replace(/'/g, "\\'");
  const query = `name='${escaped}' and '${folderId}' in parents and trashed=false`;
  const existing = await drive.files.list({ q: query, fields: "files(id)" });
  for (const f of existing.data.files || []) {
    if (f.id) await drive.files.delete({ fileId: f.id });
  }
}

async function uploadMp4(drive, settings, mp4Path, productFolderName, fileName) {
  const rootName = settings.googleDriveRootFolder?.trim() || DEFAULT_ROOT_FOLDER;
  const rootId = await getOrCreateFolder(drive, rootName);
  const productId = await getOrCreateFolder(drive, productFolderName, rootId);
  await deleteExistingFile(drive, fileName, productId);
  const uploaded = await drive.files.create({
    requestBody: { name: fileName, parents: [productId] },
    media: { mimeType: "video/mp4", body: fs.createReadStream(mp4Path) },
    fields: "id",
  });
  if (!uploaded.data.id) throw new Error("Upload failed");
  return `${rootName} / ${productFolderName}`;
}

function todayTag() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function uploadOneMp3(mp3Path, { userDataRoot, settings, products, scripts, drive }) {
  const audioDir = path.join(userDataRoot, "audio");
  const mp4Dir = path.join(audioDir, "mp4");
  fs.mkdirSync(mp4Dir, { recursive: true });

  const baseName = path.basename(mp3Path);
  const stem = baseName.replace(/\.mp3$/i, "");
  const script = scripts.find(
    (s) => s.audio_path && path.basename(String(s.audio_path)).toLowerCase() === baseName.toLowerCase()
  );

  const product = script
    ? products.find((p) => p.id === script.product_id)
    : matchProduct(stem, products);
  const productName = product?.name || stem.replace(/_\d{4}-\d{2}-\d{2}$/, "").replace(/-/g, " ");
  const folderName = shortFolderName(productName);
  const mp4Path = path.join(mp4Dir, baseName.replace(/\.mp3$/i, ".mp4"));

  process.stdout.write(`Converting ${baseName}… `);
  const converted = await convertMp3ToMp4(mp3Path, mp4Path);
  process.stdout.write("uploading… ");

  const folderPath = await uploadMp4(drive, settings, converted, folderName, path.basename(converted));
  console.log(`OK → ${folderPath}`);

  if (script) {
    script.drive_mp4_path = converted;
    script.drive_uploaded_at = new Date().toISOString();
  }

  return { folderPath, converted };
}

async function main() {
  const singleArg = process.argv[2];
  const userDataRoot = resolveAppDataRoot();
  const audioDir = path.join(userDataRoot, "audio");
  const dbDir = path.join(userDataRoot, "database");
  const settings = JSON.parse(fs.readFileSync(path.join(dbDir, "settings.json"), "utf8"));
  const products = JSON.parse(fs.readFileSync(path.join(dbDir, "products.json"), "utf8"));
  const scripts = JSON.parse(fs.readFileSync(path.join(dbDir, "scripts.json"), "utf8"));

  const health = await fetch(`${WHISPER_URL}/health`, { signal: AbortSignal.timeout(5000) }).catch(
    () => null
  );
  if (!health?.ok) {
    throw new Error("Whisper server not running — start tiktok-hook-analyzer/whisper-server/start.bat");
  }

  const { drive } = await getDriveClient(userDataRoot, settings);

  if (singleArg) {
    const mp3Path = path.resolve(singleArg);
    if (!fs.existsSync(mp3Path)) throw new Error(`File not found: ${mp3Path}`);
    await uploadOneMp3(mp3Path, { userDataRoot, settings, products, scripts, drive });
    fs.writeFileSync(path.join(dbDir, "scripts.json"), JSON.stringify(scripts, null, 2), "utf8");
    return;
  }

  const dateTag = todayTag();
  const mp3Files = fs
    .readdirSync(audioDir)
    .filter((f) => f.toLowerCase().endsWith(".mp3") && f.includes(`_${dateTag}`))
    .map((f) => path.join(audioDir, f));

  if (!mp3Files.length) {
    console.log(`No MP3 files for ${dateTag} in ${audioDir}`);
    return;
  }

  const mp4Dir = path.join(audioDir, "mp4");
  fs.mkdirSync(mp4Dir, { recursive: true });

  let uploaded = 0;
  let skipped = 0;

  for (const mp3Path of mp3Files) {
    const baseName = path.basename(mp3Path);
    const script = scripts.find(
      (s) => s.audio_path && path.basename(String(s.audio_path)).toLowerCase() === baseName.toLowerCase()
    );

    if (script?.drive_uploaded_at) {
      console.log(`SKIP (already uploaded): ${baseName}`);
      skipped += 1;
      continue;
    }

    await uploadOneMp3(mp3Path, { userDataRoot, settings, products, scripts, drive });
    uploaded += 1;
  }

  fs.writeFileSync(path.join(dbDir, "scripts.json"), JSON.stringify(scripts, null, 2), "utf8");
  console.log(`\nDone: ${uploaded} uploaded, ${skipped} skipped`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
