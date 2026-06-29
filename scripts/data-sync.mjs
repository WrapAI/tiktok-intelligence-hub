#!/usr/bin/env node
/**
 * Sync hub runtime data between AppData and repo `data/` for git pull/push.
 * NEVER copies API keys into git. Non-secret device prefs go to settings.device.json.
 *
 * Merges production AppData + Electron dev chromium-cache on export.
 * Import writes to ALL AppData roots so `npm run dev` works on any machine.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_DATA = path.join(APP_ROOT, "data");

const SKIP_DB_FILES = new Set(["settings.json"]);
const SECRET_SETTINGS_KEYS = new Set([
  "anthropicApiKey",
  "grokApiKey",
  "elevenLabsApiKey",
  "googleDriveClientSecret",
  "googleDriveCredentialsPath",
]);

/** Machine-specific — each device sets its own AppData path. */
const DEVICE_LOCAL_SETTINGS_KEYS = new Set(["dataFolder"]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function allAppDataRoots() {
  const base = path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "tiktok-intelligence-hub"
  );
  const roots = [base];
  const devPath = path.join(base, "chromium-cache", "tiktok-intelligence-hub");
  if (fs.existsSync(devPath) && devPath !== base) roots.push(devPath);
  return roots;
}

function mergeFileIntoRepo(src, dest, { force = false } = {}) {
  if (!fs.existsSync(src)) return false;
  if (force || !fs.existsSync(dest)) {
    copyFile(src, dest);
    return true;
  }
  const srcMtime = fs.statSync(src).mtimeMs;
  const destMtime = fs.statSync(dest).mtimeMs;
  if (srcMtime > destMtime) {
    copyFile(src, dest);
    return true;
  }
  return false;
}

function mergeTreeIntoRepo(srcDir, destDir, { skipNames = new Set(), force = false } = {}) {
  if (!fs.existsSync(srcDir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += mergeTreeIntoRepo(src, dest, { skipNames, force });
    } else if (entry.isFile()) {
      if (entry.name.endsWith("-alignment.json")) continue;
      if (mergeFileIntoRepo(src, dest, { force })) count += 1;
    }
  }
  return count;
}

function copyTree(srcDir, destDir, { skipNames = new Set() } = {}) {
  if (!fs.existsSync(srcDir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyTree(src, dest, { skipNames });
    } else if (entry.isFile()) {
      if (entry.name.endsWith("-alignment.json")) continue;
      copyFile(src, dest);
      count += 1;
    }
  }
  return count;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function exportSettingsDeviceJson(roots) {
  let merged = {};
  for (const root of roots) {
    const settingsPath = path.join(root, "database", "settings.json");
    const settings = readJsonFile(settingsPath);
    if (!settings || typeof settings !== "object") continue;
    for (const [key, value] of Object.entries(settings)) {
      if (SECRET_SETTINGS_KEYS.has(key) || DEVICE_LOCAL_SETTINGS_KEYS.has(key)) continue;
      if (value === "" || value == null) continue;
      merged[key] = value;
    }
  }
  const dest = path.join(REPO_DATA, "database", "settings.device.json");
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, JSON.stringify(merged, null, 2), "utf8");
  return Object.keys(merged).length;
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const cmd = args.find((a) => a === "export" || a === "import");

function exportToRepo() {
  const roots = allAppDataRoots();
  const destHub = path.join(REPO_DATA, "hub-data");
  const destDb = path.join(REPO_DATA, "database");
  const destAudio = path.join(REPO_DATA, "audio");

  if (!roots.some((r) => fs.existsSync(r))) {
    console.error(`No hub AppData found under ${roots.join(" or ")}`);
    process.exit(1);
  }

  ensureDir(destHub);
  ensureDir(destDb);
  ensureDir(destAudio);

  let hubFiles = 0;
  let dbFiles = 0;
  let audioFiles = 0;

  for (const root of roots) {
    hubFiles += mergeTreeIntoRepo(path.join(root, "hub-data"), destHub, { force });
    audioFiles += mergeTreeIntoRepo(path.join(root, "audio"), destAudio, { force });
    const srcDb = path.join(root, "database");
    if (!fs.existsSync(srcDb)) continue;
    for (const name of fs.readdirSync(srcDb)) {
      if (SKIP_DB_FILES.has(name) || !name.endsWith(".json")) continue;
      if (mergeFileIntoRepo(path.join(srcDb, name), path.join(destDb, name), { force })) dbFiles += 1;
    }
  }

  const deviceKeys = exportSettingsDeviceJson(roots);

  console.log(`Exported to ${REPO_DATA}${force ? " (force)" : ""}`);
  console.log(`  sources: ${roots.filter((r) => fs.existsSync(r)).join(", ")}`);
  console.log(`  hub-data: ${hubFiles} files updated`);
  console.log(`  database: ${dbFiles} json tables updated (settings.json skipped)`);
  console.log(`  audio: ${audioFiles} files updated`);
  console.log(`  settings.device.json: ${deviceKeys} non-secret keys`);
}

function applyDeviceSettings(destRoot) {
  const device = readJsonFile(path.join(REPO_DATA, "database", "settings.device.json"));
  if (!device) return false;
  const settingsPath = path.join(destRoot, "database", "settings.json");
  const existing = readJsonFile(settingsPath) || {};
  let changed = false;
  for (const [key, value] of Object.entries(device)) {
    if (SECRET_SETTINGS_KEYS.has(key)) continue;
    if (!existing[key]) {
      existing[key] = value;
      changed = true;
    }
  }
  if (changed) {
    ensureDir(path.dirname(settingsPath));
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2), "utf8");
  }
  return changed;
}

function importFromRepo() {
  const roots = allAppDataRoots();
  const srcHub = path.join(REPO_DATA, "hub-data");
  const srcDb = path.join(REPO_DATA, "database");
  const srcAudio = path.join(REPO_DATA, "audio");

  if (!fs.existsSync(REPO_DATA)) {
    console.error(`No repo data at ${REPO_DATA} — git pull first`);
    process.exit(1);
  }

  let hubFiles = 0;
  let dbFiles = 0;
  let audioFiles = 0;
  let settingsApplied = 0;

  for (const destRoot of roots) {
    ensureDir(destRoot);
    hubFiles += copyTree(srcHub, path.join(destRoot, "hub-data"));
    audioFiles += copyTree(srcAudio, path.join(destRoot, "audio"));
    if (fs.existsSync(srcDb)) {
      ensureDir(path.join(destRoot, "database"));
      for (const name of fs.readdirSync(srcDb)) {
        if (SKIP_DB_FILES.has(name) || !name.endsWith(".json")) continue;
        if (name === "settings.device.json") continue;
        copyFile(path.join(srcDb, name), path.join(destRoot, "database", name));
        dbFiles += 1;
      }
    }
    if (applyDeviceSettings(destRoot)) settingsApplied += 1;
  }

  console.log(`Imported into ${roots.length} AppData root(s)`);
  console.log(`  hub-data: ${hubFiles} files per root`);
  console.log(`  database: ${dbFiles} json tables per root (settings.json preserved)`);
  console.log(`  audio: ${audioFiles} files per root`);
  console.log(`  device settings merged into ${settingsApplied} root(s)`);
}

if (cmd === "export") exportToRepo();
else if (cmd === "import") importFromRepo();
else {
  console.log("Usage: node scripts/data-sync.mjs export [--force]|import");
  process.exit(1);
}
