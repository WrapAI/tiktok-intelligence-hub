import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkWhisperHealth } from "./syncService.js";

let hubStartedWhisper = false;
let whisperProc: ChildProcess | null = null;

export function resolveWhisperServerDir(): string | null {
  const candidates = [
    process.env.WHISPER_SERVER_DIR?.trim(),
    path.resolve(process.cwd(), "..", "tiktok-hook-analyzer", "whisper-server"),
    path.resolve(process.cwd(), "..", "..", "TikTikAssistant", "tiktok-hook-analyzer", "whisper-server"),
    path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "tiktok-hook-analyzer", "whisper-server"),
    path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..", "tiktok-hook-analyzer", "whisper-server"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "server.py"))) return dir;
  }
  return null;
}

function resolvePythonCommand(): string {
  if (process.platform !== "win32") return "python3";
  const local311 = path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python311", "python.exe");
  const local312 = path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe");
  if (fs.existsSync(local312)) return local312;
  if (fs.existsSync(local311)) return local311;
  return "python";
}

export async function ensureWhisperServerRunning(): Promise<boolean> {
  if (await checkWhisperHealth()) return true;

  const dir = resolveWhisperServerDir();
  if (!dir) {
    console.warn("[Whisper] server.py not found — start whisper-server manually or use start.bat");
    return false;
  }

  const python = resolvePythonCommand();
  whisperProc = spawn(python, ["server.py"], {
    cwd: dir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  whisperProc.unref();
  hubStartedWhisper = true;
  console.log(`[Whisper] Starting server from ${dir}`);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await checkWhisperHealth()) {
      console.log("[Whisper] Server ready on http://127.0.0.1:5050");
      return true;
    }
  }

  console.warn("[Whisper] Process started but health check timed out");
  return false;
}

export function whisperStartedByHub(): boolean {
  return hubStartedWhisper;
}
