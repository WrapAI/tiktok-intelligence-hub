// Run with: node export-env.js
// Reads hub settings from AppData and writes .env to this folder

import fs from "fs";
import path from "path";
import os from "os";

const settingsPath = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "tiktok-intelligence-hub",
  "database",
  "settings.json"
);

if (!fs.existsSync(settingsPath)) {
  console.error("Settings file not found at:", settingsPath);
  console.error("Open the hub app and save your settings first.");
  process.exit(1);
}

const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

const lines = [
  "# TikTok Intelligence Hub — API Keys & Settings",
  "# Auto-exported from hub settings. Keep this file private.",
  "",
  `ANTHROPIC_API_KEY=${settings.anthropicApiKey || ""}`,
  `ELEVENLABS_API_KEY=${settings.elevenLabsApiKey || ""}`,
  `ELEVENLABS_VOICE_ID=${settings.elevenLabsVoiceId || ""}`,
  `MY_TIKTOK_HANDLE=${settings.myTiktokHandle || ""}`,
  "",
  "# Claude Agent (Anthropic Console)",
  `TIKTOK_AGENT_ID=${settings.tiktokAgentId || ""}`,
  `TIKTOK_AGENT_ENVIRONMENT_ID=${settings.tiktokAgentEnvironmentId || ""}`,
  `TIKTOK_AGENT_MEMORY_STORE_ID=${settings.tiktokAgentMemoryStoreId || ""}`,
  `TIKTOK_AGENT_SESSION_ID=${settings.tiktokAgentSessionId || ""}`,
  "",
  `DATA_FOLDER=${settings.dataFolder || ""}`,
];

const envPath = path.join(process.cwd(), ".env");
fs.writeFileSync(envPath, lines.join("\n"), "utf-8");
console.log("Written to:", envPath);
