import fs from "node:fs";
import path from "node:path";
import type { JsonStore } from "../db.js";
import { uploadMp4ToDrive } from "./googleDrive.js";
import { createPendingFromDriveUpload } from "./pendingAnalysis.js";
import { shortenProductName } from "./productNaming.js";

const WHISPER_URL = "http://localhost:5050";

export async function convertMp3ToMp4ViaWhisper(mp3Path: string, mp4Path?: string): Promise<string> {
  if (!fs.existsSync(mp3Path)) throw new Error("MP3 file not found.");

  const target = mp4Path || mp3Path.replace(/\.mp3$/i, ".mp4");
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const res = await fetch(`${WHISPER_URL}/mp3-to-mp4`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mp3_path: mp3Path, mp4_path: target }),
    signal: AbortSignal.timeout(120_000),
  });

  const data = (await res.json()) as { ok?: boolean; mp4_path?: string; error?: string };
  if (!res.ok || !data.ok || !data.mp4_path) {
    throw new Error(
      data.error ||
        "MP3→MP4 conversion failed. Start whisper-server (tiktok-hook-analyzer/whisper-server/start.bat) and ensure ffmpeg is installed."
    );
  }

  return data.mp4_path;
}

export async function uploadScriptVoiceoverToDrive(
  store: JsonStore,
  scriptId: string
): Promise<{ folderPath: string; mp4Path: string; fileName: string; pendingAnalysisId: string }> {
  const script = store.list<Record<string, unknown>>("scripts").find((s) => s.id === scriptId);
  if (!script) throw new Error("Script not found.");

  const mp3Path = String(script.audio_path || "").trim();
  if (!mp3Path || !fs.existsSync(mp3Path)) {
    throw new Error("Generate ElevenLabs audio first, then send to Google Drive.");
  }

  const product = store
    .list<Record<string, unknown>>("products")
    .find((p) => p.id === script.product_id);
  const productName = String(product?.name || script.title || "Voiceovers");
  const folderName = shortenProductName(productName).shortName || productName.slice(0, 48);

  const mp4Dir = path.join(path.dirname(mp3Path), "mp4");
  fs.mkdirSync(mp4Dir, { recursive: true });
  const baseName = path.basename(mp3Path).replace(/\.mp3$/i, ".mp4");
  const mp4Path = path.join(mp4Dir, baseName);

  const converted = await convertMp3ToMp4ViaWhisper(mp3Path, mp4Path);
  const { folderPath } = await uploadMp4ToDrive(store, {
    mp4Path: converted,
    productFolderName: folderName,
    fileName: baseName,
  });

  const uploadedAt = new Date().toISOString();
  store.upsertById("scripts", {
    ...(script as { id: string }),
    drive_mp4_path: converted,
    drive_uploaded_at: uploadedAt,
  });

  const pending = createPendingFromDriveUpload(store, {
    scriptId,
    scriptTitle: String(script.title || "Script voiceover"),
    productId: String(script.product_id || ""),
    productName,
    mp4Path: converted,
    folderPath,
    uploadedAt,
  });

  return { folderPath, mp4Path: converted, fileName: baseName, pendingAnalysisId: pending.id };
}
