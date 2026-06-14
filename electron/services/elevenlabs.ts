import fs from "node:fs";
import path from "node:path";
import type { JsonStore } from "../db.js";

const BASE = "https://api.elevenlabs.io/v1";

export type VoiceInfo = { voice_id: string; name: string };

export async function listVoices(apiKey: string): Promise<VoiceInfo[]> {
  const res = await fetch(`${BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) throw new Error(`ElevenLabs voices failed (${res.status})`);
  const data = (await res.json()) as { voices?: VoiceInfo[] };
  return data.voices || [];
}

export type AudioResult = {
  filePath: string;
  alignmentPath: string | null;
};

function normalizeSsml(text: string): string {
  const t = text.trim();
  if (!t) return "";
  if (t.startsWith("<speak")) return t;
  return `<speak>${t}</speak>`;
}

export async function synthesizeSpeech(
  store: JsonStore,
  opts: {
    text: string;
    ssml?: string;
    scriptId?: string;
    outputDir: string;
  }
): Promise<AudioResult> {
  const apiKey = store.getSetting("elevenLabsApiKey");
  if (!apiKey) throw new Error("Add your ElevenLabs API key in Settings.");

  const voiceId = store.getSetting("elevenLabsVoiceId");
  if (!voiceId) throw new Error("Pick an ElevenLabs voice in Settings.");

  const modelId = store.getSetting("elevenLabsModelId", "eleven_multilingual_v2");
  const bodyText = normalizeSsml(opts.ssml || opts.text);
  if (!bodyText) throw new Error("No script text to synthesize.");

  fs.mkdirSync(opts.outputDir, { recursive: true });
  const baseName = opts.scriptId || `audio-${Date.now()}`;
  const filePath = path.join(opts.outputDir, `${baseName}.mp3`);
  const alignmentPath = path.join(opts.outputDir, `${baseName}-alignment.json`);

  const res = await fetch(`${BASE}/text-to-speech/${voiceId}/with-timestamps`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      text: bodyText,
      model_id: modelId,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    audio_base64?: string;
    alignment?: unknown;
  };

  if (!data.audio_base64) {
    throw new Error("ElevenLabs returned no audio");
  }

  fs.writeFileSync(filePath, Buffer.from(data.audio_base64, "base64"));
  if (data.alignment) {
    fs.writeFileSync(alignmentPath, JSON.stringify(data.alignment, null, 2), "utf8");
  }

  return { filePath, alignmentPath: data.alignment ? alignmentPath : null };
}
