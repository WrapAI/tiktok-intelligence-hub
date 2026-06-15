import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { JsonStore, resolvePaths } from "./db.js";
import { importFromDataFolderIfChanged, importFromDataFolder, importFile, importSalesDataFile, copyIncomingFile } from "./services/importService.js";
import { buildMemorySummary } from "./services/memoryInsights.js";
import { generateScript } from "./services/scriptWriter.js";
import { getScriptInsights, buildLibraryInsights } from "./services/libraryPerformance.js";
import { checkWhisperHealth, registerDataFolder, requestExtensionSync } from "./services/syncService.js";
import { listVoices, synthesizeSpeech } from "./services/elevenlabs.js";
import { extractProductsFromLibrary } from "./services/productExtractor.js";
import {
  generateDailyPlan,
  getDailyPlan,
  getPlannerSummary,
  listDailyPlans,
  validateLimits,
  MAX_DAILY_POSTS,
} from "./services/dailyPlanner.js";
import { listProductSales } from "./services/salesImport.js";

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

// Windows: multiple dev restarts were colliding on the same Chromium cache profile.
app.commandLine.appendSwitch("disable-features", "NetworkServiceSandbox");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
const cacheDir = path.join(app.getPath("userData"), "chromium-cache");
fs.mkdirSync(cacheDir, { recursive: true });
app.setPath("cache", cacheDir);

function getDialogWindow() {
  return BrowserWindow.getFocusedWindow() || mainWindow || BrowserWindow.getAllWindows()[0] || null;
}

function ensureStore() {
  if (!store) throw new Error("App is still starting — try again in a moment.");
}

let mainWindow: BrowserWindow | null = null;
let store: JsonStore;
let paths: ReturnType<typeof resolvePaths>;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Windows: blank renderer / cache crashes
if (process.platform === "win32") {
  app.disableHardwareAcceleration();
}

function resolvePreloadPath() {
  for (const file of ["preload.cjs", "preload.js", "preload.mjs"]) {
    const candidate = path.join(__dirname, file);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(__dirname, "preload.cjs");
}

function getDevServerUrl(): string | undefined {
  if (process.env.VITE_DEV_SERVER_URL) return process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged) return "http://localhost:5173/";
  return undefined;
}

function loadWindowContent(win: BrowserWindow, attempt = 0) {
  const devUrl = getDevServerUrl();
  const prodFile = path.join(__dirname, "../dist/index.html");

  if (devUrl) {
    win
      .loadURL(devUrl)
      .then(() => {
        if (!win.isVisible()) win.show();
      })
      .catch((err) => {
        console.error(`Dev load failed (attempt ${attempt + 1}):`, err);
        if (attempt < 30) {
          setTimeout(() => loadWindowContent(win, attempt + 1), 500);
        }
      });
    return;
  }

  if (!fs.existsSync(prodFile)) {
    console.error("Missing build output:", prodFile, "— run npm run build first");
  }

  win
    .loadFile(prodFile)
    .then(() => {
      if (!win.isVisible()) win.show();
    })
    .catch((err) => console.error("Failed to load app file:", err));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "TikTok Intelligence Hub",
    show: true,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("Preload script failed:", preloadPath, error);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone:", details.reason, details.exitCode);
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    const devUrl = getDevServerUrl();
    console.error("Page failed to load:", code, description, url);
    if (devUrl && url.startsWith("http://localhost:")) {
      setTimeout(() => loadWindowContent(mainWindow!), 800);
    }
  });

  loadWindowContent(mainWindow);
}

function runBackgroundStartup() {
  void (async () => {
    try {
      await registerDataFolder(paths.dataDir);
    } catch {
      // whisper-server optional at startup
    }

    try {
      importFromDataFolderIfChanged(store, paths.dataDir);
    } catch (err) {
      console.error("Background import failed:", err);
    }
  })();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

app.whenReady().then(() => {
  paths = resolvePaths(app.getPath("userData"));
  store = new JsonStore(paths.dbDir);
  if (!store.getSetting("dataFolder")) {
    store.setSetting("dataFolder", paths.dataDir);
  } else {
    paths.dataDir = store.getSetting("dataFolder", paths.dataDir);
    fs.mkdirSync(paths.dataDir, { recursive: true });
  }

  createWindow();
  runBackgroundStartup();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("hub:get-bootstrap", () => ({
  dataFolder: paths.dataDir,
}));

ipcMain.handle("hub:check-whisper", async () => checkWhisperHealth());

ipcMain.handle("hub:get-settings", () => ({
  anthropicApiKey: store.getSetting("anthropicApiKey"),
  elevenLabsApiKey: store.getSetting("elevenLabsApiKey"),
  elevenLabsVoiceId: store.getSetting("elevenLabsVoiceId"),
  myTiktokHandle: store.getSetting("myTiktokHandle"),
  dataFolder: paths.dataDir,
}));

ipcMain.handle("hub:save-settings", (_e, settings: Record<string, string>) => {
  if (settings.anthropicApiKey != null) store.setSetting("anthropicApiKey", settings.anthropicApiKey.trim());
  if (settings.elevenLabsApiKey != null) {
    store.setSetting("elevenLabsApiKey", settings.elevenLabsApiKey.trim());
  }
  if (settings.elevenLabsVoiceId != null) {
    store.setSetting("elevenLabsVoiceId", settings.elevenLabsVoiceId.trim());
  }
  if (settings.myTiktokHandle != null) {
    store.setSetting("myTiktokHandle", settings.myTiktokHandle.trim().replace(/^@/, ""));
  }
  if (settings.dataFolder?.trim()) {
    paths.dataDir = settings.dataFolder.trim();
    fs.mkdirSync(paths.dataDir, { recursive: true });
    store.setSetting("dataFolder", paths.dataDir);
  }
  return { ok: true };
});

ipcMain.handle("hub:get-dashboard", () => {
  const studio = store.list<{ synced_at: string; imported_at: string }>("studio_snapshots");
  const compass = store.list<{ synced_at: string; imported_at: string }>("compass_snapshots");
  studio.sort((a, b) => b.imported_at.localeCompare(a.imported_at));
  compass.sort((a, b) => b.imported_at.localeCompare(a.imported_at));

  return {
    libraryCount: store.list("library_items").length,
    memoryCount: store.list("positive_memory").length,
    productCount: store.list("products").length,
    scriptCount: store.list("scripts").length,
    summary: buildMemorySummary(store),
    latestStudioSync: studio[0]?.synced_at || null,
    latestCompassSync: compass[0]?.synced_at || null,
    dataFolder: paths.dataDir,
  };
});

ipcMain.handle("hub:list-products", () =>
  store
    .list<Record<string, unknown>>("products")
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
);

ipcMain.handle("hub:save-product", (_e, product: Record<string, string>) => {
  const now = new Date().toISOString();
  const id = product.id || randomUUID();
  store.upsertById("products", {
    id,
    name: product.name,
    brand: product.brand || "",
    price: product.price || "",
    description: product.description || "",
    image_url: product.image_url || "",
    source: "manual",
    raw_json: JSON.stringify(product),
    created_at: now,
    updated_at: now,
  });
  return { ok: true, id };
});

ipcMain.handle("hub:delete-product", (_e, id: string) => {
  store.deleteById("products", id);
  return { ok: true };
});

ipcMain.handle("hub:list-library", () =>
  (store.list("library_items") as Array<{ saved_at?: string }>)
    .sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)))
    .slice(0, 200)
);

ipcMain.handle("hub:list-memory", () =>
  (store.list("positive_memory") as Array<{ date_used?: string }>)
    .sort((a, b) => String(b.date_used).localeCompare(String(a.date_used)))
    .slice(0, 200)
);

ipcMain.handle("hub:list-scripts", () =>
  store
    .list<{ created_at: string }>("scripts")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50)
);

ipcMain.handle("hub:get-script", (_e, id: string) =>
  (store.list("scripts") as Array<{ id: string }>).find((s) => s.id === id)
);

ipcMain.handle("hub:get-script-insights", () => getScriptInsights(store));

ipcMain.handle(
  "hub:generate-script",
  async (
    _e,
    req: {
      productId: string;
      durationSeconds?: number;
      referenceLibraryId?: string;
    }
  ) => {
    try {
      ensureStore();
      const result = await generateScript(store, {
        productId: req.productId,
        durationSeconds: req.durationSeconds,
        referenceLibraryId: req.referenceLibraryId,
      });
      store.appendLog("script", "ok", result.title);
      return { ok: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.appendLog("script", "error", message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle("hub:list-pacing-references", () =>
  buildLibraryInsights(store, 30)
    .filter((v) => v.hasPacing)
    .map((v) => ({
      id: v.libraryId,
      hook: v.hookText,
      hookType: v.hookType,
      views: v.views,
      likes: v.likes,
      comments: v.comments,
      replicationScore: v.replicationScore,
      engagementScore: v.engagementScore,
    }))
);

ipcMain.handle("hub:get-planner-summary", () => getPlannerSummary(store));

ipcMain.handle("hub:list-product-sales", () => listProductSales(store));

ipcMain.handle("hub:list-daily-plans", () => listDailyPlans(store));

ipcMain.handle("hub:get-daily-plan", (_e, id: string) => getDailyPlan(store, id));

ipcMain.handle(
  "hub:generate-daily-plan",
  (
    _e,
    req: {
      planDate?: string;
      limits: { top: number; middle: number; bottom: number };
      selectedProductNames?: string[];
    }
  ) => {
    try {
      ensureStore();
      const validation = validateLimits(req.limits);
      if (!validation.ok) return { ok: false, error: validation.error };
      const plan = generateDailyPlan(store, req);
      return { ok: true, plan };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
);

ipcMain.handle("hub:import-sales-file", async () => {
  try {
    ensureStore();
    const win = getDialogWindow();
    if (!win) return { ok: false, error: "App window not ready." };

    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [
        { name: "Sales data", extensions: ["csv", "xlsx", "xls"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }

    const filePath = result.filePaths[0];
    const dest = copyIncomingFile(paths.dataDir, filePath);
    const res = importSalesDataFile(store, dest);
    store.appendLog("sales", "ok", `Imported ${res.count} products from ${res.file}`);
    return { ok: true, count: res.count, file: res.file };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:get-max-daily-posts", () => MAX_DAILY_POSTS);

ipcMain.handle("hub:list-elevenlabs-voices", async () => {
  try {
    const apiKey = store.getSetting("elevenLabsApiKey");
    if (!apiKey) return { ok: false, error: "Add ElevenLabs API key in Settings" };
    const voices = await listVoices(apiKey);
    return { ok: true, voices };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:generate-audio", async (_e, scriptId: string) => {
  try {
    const existing = store
      .list<Record<string, unknown>>("scripts")
      .find((s) => s.id === scriptId);
    if (!existing) throw new Error("Script not found");

    const audioDir = path.join(app.getPath("userData"), "audio");
    const result = await synthesizeSpeech(store, {
      text: String(existing.script_text || ""),
      ssml: String(existing.ssml || ""),
      scriptId: String(existing.id),
      outputDir: audioDir,
    });

    store.upsertById("scripts", {
      ...(existing as { id: string }),
      audio_path: result.filePath,
      alignment_path: result.alignmentPath,
    });

    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:open-audio-file", (_e, filePath: string) => {
  shell.showItemInFolder(filePath);
  return { ok: true };
});

ipcMain.handle("hub:refresh-products-from-library", () => {
  const count = extractProductsFromLibrary(store);
  return { ok: true, count };
});

ipcMain.handle("hub:get-memory-summary", () => buildMemorySummary(store));

ipcMain.handle("hub:import-files", async () => {
  try {
    ensureStore();
    const win = getDialogWindow();
    if (!win) return { ok: false, error: "App window not ready. Close and reopen the hub." };

    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }

    const imported: Array<{ file: string; ok: true; type: string; count: number }> = [];
    const errors: Array<{ file: string; error: string }> = [];

    for (const filePath of result.filePaths) {
      const fileName = path.basename(filePath);
      try {
        const dest = copyIncomingFile(paths.dataDir, filePath);
        const res = importFile(store, dest);
        imported.push({ file: fileName, ok: true, type: res.type, count: res.count });
      } catch (err) {
        errors.push({
          file: fileName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (imported.length) {
      extractProductsFromLibrary(store);
    }

    const summary =
      imported.length === 0
        ? "No files imported."
        : `Imported ${imported.length} file(s): ${imported.map((i) => `${i.file} (${i.type})`).join(", ")}`;

    store.appendLog("import", errors.length ? "partial" : "ok", summary);

    return {
      ok: imported.length > 0,
      canceled: false,
      imported,
      errors,
      message: errors.length ? `${summary} ${errors.length} failed.` : summary,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:rescan-data-folder", () => {
  try {
    ensureStore();
    const results = importFromDataFolder(store, paths.dataDir, { force: true });
    const products = extractProductsFromLibrary(store);
    const imported = results.filter((r) => r.ok);
    const errors = results.filter((r) => !r.ok);
    return {
      ok: imported.length > 0 || errors.length === 0,
      results,
      productsExtracted: products,
      message: `Rescanned: ${imported.length} ok, ${errors.length} failed`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:open-data-folder", () => {
  shell.openPath(paths.dataDir);
  return { ok: true };
});

ipcMain.handle("hub:request-sync", async (_e, type: "ALL" | "STUDIO" | "COMPASS") => {
  try {
    await requestExtensionSync(type, paths.dataDir);
    store.appendLog(type, "requested", "Waiting for extension");
    return { ok: true, message: "Sync requested — keep Chrome extension loaded." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.appendLog(type, "error", message);
    return { ok: false, error: message };
  }
});
