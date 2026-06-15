#!/usr/bin/env node
/**
 * Sync hub runtime data between AppData and repo `data/` for git pull/push.
 * NEVER copies settings.json (API keys live only in AppData).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_DATA = path.join(APP_ROOT, "data");

// Electron dev mode stores userData inside chromium-cache; production uses the root.
// Detect whichever path actually exists (chromium-cache takes priority).
function resolveAppDataRoot() {
  const base = path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "tiktok-intelligence-hub"
  );
  const devPath = path.join(base, "chromium-cache", "tiktok-intelligence-hub");
  if (fs.existsSync(devPath)) return devPath;
  return base;
}

const APPDATA_ROOT = resolveAppDataRoot();

const SKIP_DB_FILES = new Set(["settings.json"]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
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
      copyFile(src, dest);
      count += 1;
    }
  }
  return count;
}

function exportToRepo() {
  const srcHub = path.join(APPDATA_ROOT, "hub-data");
  const srcDb = path.join(APPDATA_ROOT, "database");
  const destHub = path.join(REPO_DATA, "hub-data");
  const destDb = path.join(REPO_DATA, "database");

  if (!fs.existsSync(APPDATA_ROOT)) {
    console.error(`No hub AppData at ${APPDATA_ROOT}`);
    process.exit(1);
  }

  const hubFiles = copyTree(srcHub, destHub);
  let dbFiles = 0;
  if (fs.existsSync(srcDb)) {
    ensureDir(destDb);
    for (const name of fs.readdirSync(srcDb)) {
      if (SKIP_DB_FILES.has(name) || !name.endsWith(".json")) continue;
      copyFile(path.join(srcDb, name), path.join(destDb, name));
      dbFiles += 1;
    }
  }

  console.log(`Exported to ${REPO_DATA}`);
  console.log(`  hub-data: ${hubFiles} files`);
  console.log(`  database: ${dbFiles} json tables (settings.json skipped)`);
}

function importFromRepo() {
  const srcHub = path.join(REPO_DATA, "hub-data");
  const srcDb = path.join(REPO_DATA, "database");
  const destHub = path.join(APPDATA_ROOT, "hub-data");
  const destDb = path.join(APPDATA_ROOT, "database");

  if (!fs.existsSync(REPO_DATA)) {
    console.error(`No repo data at ${REPO_DATA} — git pull first`);
    process.exit(1);
  }

  ensureDir(APPDATA_ROOT);
  const hubFiles = copyTree(srcHub, destHub);
  let dbFiles = 0;
  if (fs.existsSync(srcDb)) {
    ensureDir(destDb);
    for (const name of fs.readdirSync(srcDb)) {
      if (SKIP_DB_FILES.has(name) || !name.endsWith(".json")) continue;
      copyFile(path.join(srcDb, name), path.join(destDb, name));
      dbFiles += 1;
    }
  }

  console.log(`Imported into ${APPDATA_ROOT}`);
  console.log(`  hub-data: ${hubFiles} files`);
  console.log(`  database: ${dbFiles} json tables (settings.json preserved)`);
}

const cmd = process.argv[2];
if (cmd === "export") exportToRepo();
else if (cmd === "import") importFromRepo();
else {
  console.log("Usage: node scripts/data-sync.mjs export|import");
  process.exit(1);
}
