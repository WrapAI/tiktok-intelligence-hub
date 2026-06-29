import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { JsonStore, resolvePaths } from "./db.js";
import { ingestIncomingFile, importFromDataFolderIfChanged, importFromDataFolder, ensureDataLayout, migrateFlatDataFolder, getDataLayoutSummary, classifyImportFile, categoryFolder, DATA_FOLDERS, importJsonFile, type DataCategory } from "./services/importService.js";
import { buildMemorySummary } from "./services/memoryInsights.js";
import { generateScript, getScriptDetail, getPendingFeedbackScript, dismissScriptFeedback, dismissBlockingScriptFeedback, healScriptFeedbackFlags, rateScriptSectionFeedback, updateScriptContent, assertScriptPassesValidation, type ScriptSection, type ScriptSectionRating } from "./services/scriptWriter.js";
import { getScriptInsights, buildLibraryInsights } from "./services/libraryPerformance.js";
import { checkWhisperHealth, registerDataFolder, requestExtensionSync } from "./services/syncService.js";
import { listVoices, synthesizeSpeech } from "./services/elevenlabs.js";
import { extractProductsFromLibrary } from "./services/productExtractor.js";
import { importProductFromShopLink } from "./services/productShopImport.js";
import { retryProductResearch, backfillHeuristicPackagingForAllPendingProducts } from "./services/productResearch.js";
import {
  generateDailyPlan,
  getDailyPlan,
  getPlannerSummary,
  listDailyPlans,
  validateLimits,
  MAX_DAILY_POSTS,
} from "./services/dailyPlanner.js";
import { listProductSales } from "./services/salesImport.js";
import {
  clearAgentSession,
  createAgentSession,
  DEFAULT_AGENT_ID,
  DEFAULT_ENVIRONMENT_ID,
  DEFAULT_MEMORY_STORE_ID,
  DEFAULT_SESSION_ID,
  getAgentStatus,
  listAgentChatHistory,
  requestAgentTask,
  seedAgentDefaults,
  sendAgentMessage,
  syncHubContextToMemoryStore,
} from "./services/tiktokAgent.js";
import { estimateAgentActionCost } from "./services/agentPricing.js";
import { getAgentBudgetStatus, resetAgentGuardrails } from "./services/agentGuardrails.js";
import { analyseMyVideo, backfillMyVideoThumbnail, scoreMyVideo, type MyVideo, type MyVideoSubmission } from "./services/myVideoAnalysis.js";
import { getAnalysisDurationSeconds, resolveWatchTimeFromSubmit } from "./services/watchTime.js";
import { fetchVideoThumbnail } from "./services/videoThumbnail.js";
import { removeMyVideoFromPositiveMemory, syncMyVideoToPositiveMemory } from "./services/myVideoMemorySync.js";
import { connectGoogleDrive, createTodaysDriveFolders, DEFAULT_GOOGLE_DRIVE_CLIENT_ID, getGoogleDriveStatus, getTodaysDriveFolderStatus } from "./services/googleDrive.js";
import { uploadScriptVoiceoverToDrive } from "./services/voiceoverUpload.js";
import {
  batchAddTodayScriptsToPending,
  batchAddScriptsToPending,
  deletePendingAnalysis,
  listPendingAnalysis,
  pullPendingStatsAndAnalyse,
  submitPendingAnalysis,
  updatePendingPerformanceData,
  setPendingTikTokUrl,
  resetPendingAfterScriptEdit,
  syncPendingCaptionsFromScript,
  removeDuplicatePendingEntries,
  clearPendingDismissals,
  type PendingAnalysisSubmit,
} from "./services/pendingAnalysis.js";
import { setAgentStatusWindow } from "./services/agentSessionStatus.js";
import {
  hubChangeFromImport,
  initAgentBridge,
  notifyHubDataChanged,
} from "./services/agentBridge.js";
import {
  addCreatorGuidance,
  deleteCreatorGuidance,
  listCreatorGuidance,
  type CreatorGuidanceKind,
} from "./services/creatorGuidance.js";

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

/** Windows Electron loses keyboard routing after native dialogs / browser OAuth. */
function restoreWindowInputFocus(win: BrowserWindow | null, afterNativeDialog = false) {
  if (!win || win.isDestroyed()) return;

  const refocus = () => {
    if (win.isDestroyed()) return;
    win.focus();
    win.webContents.focus();
  };

  refocus();

  if (process.platform !== "win32") return;

  if (afterNativeDialog) {
    win.hide();
    setImmediate(() => {
      if (win.isDestroyed()) return;
      win.show();
      refocus();
    });
    return;
  }

  setImmediate(refocus);
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
  app.commandLine.appendSwitch("disable-direct-composition");
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
  setAgentStatusWindow(mainWindow);
  mainWindow.on("focus", () => restoreWindowInputFocus(mainWindow));
  mainWindow.on("closed", () => {
    setAgentStatusWindow(null);
    mainWindow = null;
  });
}

function resetStuckResearchingProducts() {
  const backfilled = backfillHeuristicPackagingForAllPendingProducts(store);
  if (backfilled) console.log(`[Startup] Applied local packaging to ${backfilled} pending products`);

  if (!store.getSetting("agentEphemeralTasksMigrated")) {
    store.setSetting("tiktokAgentSessionId", "");
    store.setSetting("agentEphemeralTasksMigrated", "1");
    console.log("[Startup] Cleared bloated agent session from pre-fix product research loop");
  }
}

function runBackgroundStartup() {
  // Reset any products stuck in "researching" from a previous crash/loop
  resetStuckResearchingProducts();

  void (async () => {
    try {
      await registerDataFolder(paths.dataDir);
    } catch {
      // whisper-server optional at startup
    }

    try {
      const results = importFromDataFolderIfChanged(store, paths.dataDir);
      const imported = results.filter((r) => r.ok);
      if (imported.length) {
        extractProductsFromLibrary(store);
        notifyHubDataChanged({
          kind: "import",
          summary: `Imported ${imported.length} file(s) on startup`,
          count: imported.reduce((n, r) => n + (r.count || 0), 0),
        });
      }
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
  healScriptFeedbackFlags(store);
  seedAgentDefaults(store);
  if (!store.getSetting("dataFolder")) {
    store.setSetting("dataFolder", paths.dataDir);
  } else {
    paths.dataDir = store.getSetting("dataFolder", paths.dataDir);
  }
  fs.mkdirSync(paths.dataDir, { recursive: true });
  ensureDataLayout(paths.dataDir);
  migrateFlatDataFolder(paths.dataDir);
  initAgentBridge(store, paths.dataDir, paths.dbDir);

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
  grokApiKey: store.getSetting("grokApiKey"),
  elevenLabsApiKey: store.getSetting("elevenLabsApiKey"),
  elevenLabsVoiceId: store.getSetting("elevenLabsVoiceId"),
  myTiktokHandle: store.getSetting("myTiktokHandle"),
  dataFolder: paths.dataDir,
  tiktokAgentId: store.getSetting("tiktokAgentId", DEFAULT_AGENT_ID),
  tiktokAgentEnvironmentId: store.getSetting("tiktokAgentEnvironmentId", DEFAULT_ENVIRONMENT_ID),
  tiktokAgentMemoryStoreId: store.getSetting("tiktokAgentMemoryStoreId", DEFAULT_MEMORY_STORE_ID),
  tiktokAgentSessionId: store.getSetting("tiktokAgentSessionId", DEFAULT_SESSION_ID),
  googleDriveClientId: store.getSetting("googleDriveClientId", DEFAULT_GOOGLE_DRIVE_CLIENT_ID),
  googleDriveClientSecret: store.getSetting("googleDriveClientSecret"),
  googleDriveRootFolder: store.getSetting("googleDriveRootFolder", "TikTok - Voiceovers"),
}));

ipcMain.handle("hub:save-settings", (_e, settings: Record<string, string>) => {
  if (settings.anthropicApiKey != null) store.setSetting("anthropicApiKey", settings.anthropicApiKey.trim());
  if (settings.grokApiKey != null) store.setSetting("grokApiKey", settings.grokApiKey.trim());
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
    ensureDataLayout(paths.dataDir);
    migrateFlatDataFolder(paths.dataDir);
    store.setSetting("dataFolder", paths.dataDir);
    initAgentBridge(store, paths.dataDir, paths.dbDir);
  }
  if (settings.tiktokAgentId != null) store.setSetting("tiktokAgentId", settings.tiktokAgentId.trim());
  if (settings.tiktokAgentEnvironmentId != null) {
    store.setSetting("tiktokAgentEnvironmentId", settings.tiktokAgentEnvironmentId.trim());
  }
  if (settings.tiktokAgentMemoryStoreId != null) {
    store.setSetting("tiktokAgentMemoryStoreId", settings.tiktokAgentMemoryStoreId.trim());
  }
  if (settings.tiktokAgentSessionId != null) {
    store.setSetting("tiktokAgentSessionId", settings.tiktokAgentSessionId.trim());
  }
  if (settings.googleDriveClientId != null) {
    store.setSetting("googleDriveClientId", settings.googleDriveClientId.trim() || DEFAULT_GOOGLE_DRIVE_CLIENT_ID);
  }
  if (settings.googleDriveClientSecret != null) {
    store.setSetting("googleDriveClientSecret", settings.googleDriveClientSecret.trim());
  }
  if (settings.googleDriveRootFolder != null) {
    store.setSetting("googleDriveRootFolder", settings.googleDriveRootFolder.trim() || "TikTok - Voiceovers");
  }
  return { ok: true };
});

ipcMain.handle("hub:get-dashboard", () => {
  const studio = store.list<{ synced_at: string; imported_at: string }>("studio_snapshots");
  const compass = store.list<{ synced_at: string; imported_at: string }>("compass_snapshots");
  studio.sort((a, b) => b.imported_at.localeCompare(a.imported_at));
  compass.sort((a, b) => b.imported_at.localeCompare(a.imported_at));

  const layout = getDataLayoutSummary(
    paths.dataDir,
    paths.dbDir,
    store.list("import_history").length
  );

  return {
    libraryCount: store.list("library_items").length,
    memoryCount: store.list("positive_memory").length,
    productCount: store.list("products").length,
    scriptCount: store.list("scripts").length,
    salesCount: store.list("product_sales").length,
    summary: buildMemorySummary(store),
    latestStudioSync: studio[0]?.synced_at || null,
    latestCompassSync: compass[0]?.synced_at || null,
    dataFolder: paths.dataDir,
    dataLayout: layout,
    importHistoryCount: layout.importHistoryCount,
  };
});

ipcMain.handle("hub:list-products", () => {
  return store
    .list<Record<string, unknown>>("products")
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
});

ipcMain.handle("hub:save-product", (_e, product: Record<string, string>) => {
  const now = new Date().toISOString();
  const id = product.id || randomUUID();
  const existing = store.list<Record<string, unknown>>("products").find((p) => p.id === id);
  const isNew = !existing;
  store.upsertById("products", {
    ...(existing || {}),
    id,
    name: product.name,
    brand: product.brand || "",
    price: product.price || "",
    description: product.description || "",
    image_url: product.image_url || "",
    source: existing ? String(existing.source || "manual") : "manual",
    raw_json: JSON.stringify(product),
    created_at: String(existing?.created_at || now),
    updated_at: now,
  });
  notifyHubDataChanged({
    kind: "product_edit",
    summary: `Product saved: ${product.name}`,
  });
  return { ok: true, id };
});

ipcMain.handle("hub:retry-product-research", (_e, productId: string) => {
  retryProductResearch(store, productId);
  return { ok: true };
});

ipcMain.handle("hub:import-product-from-shop-link", async (_e, url: string) => {
  try {
    ensureStore();
    const result = await importProductFromShopLink(store, url);
    notifyHubDataChanged({
      kind: "product_edit",
      summary: result.isNew
        ? `Imported product: ${result.product.name}`
        : `Updated product: ${result.product.name}`,
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:delete-product", (_e, id: string) => {
  store.deleteById("products", id);
  notifyHubDataChanged({
    kind: "product_edit",
    summary: "Product deleted",
  });
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

ipcMain.handle("hub:get-script", (_e, id: string) => {
  ensureStore();
  return getScriptDetail(store, id);
});

ipcMain.handle(
  "hub:update-script-content",
  (
    _e,
    req: {
      scriptId: string;
      pendingAnalysisId?: string;
      updates: {
        title?: string;
        script_text?: string;
        ssml?: string;
        on_screen_caption?: string;
        tiktok_caption?: string;
      };
    }
  ) => {
    try {
      ensureStore();
      const script = updateScriptContent(store, req.scriptId, req.updates);
      let pendingReset = false;
      if (req.pendingAnalysisId) {
        syncPendingCaptionsFromScript(store, req.pendingAnalysisId, {
          on_screen_caption: req.updates.on_screen_caption,
          tiktok_caption: req.updates.tiktok_caption,
          script_title: req.updates.title,
        });
        resetPendingAfterScriptEdit(store, req.pendingAnalysisId);
        pendingReset = true;
      }
      return { ok: true, script, pendingReset };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
);

ipcMain.handle("hub:get-pending-script-feedback", () => {
  ensureStore();
  return getPendingFeedbackScript(store);
});

ipcMain.handle("hub:dismiss-script-feedback", (_e, scriptId: string) => {
  try {
    ensureStore();
    dismissScriptFeedback(store, scriptId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:dismiss-blocking-script-feedback", () => {
  try {
    ensureStore();
    const scriptId = dismissBlockingScriptFeedback(store);
    return { ok: true, scriptId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle(
  "hub:rate-script-section-feedback",
  (
    _e,
    req: {
      scriptId: string;
      section: ScriptSection;
      rating: ScriptSectionRating;
      reason?: string;
      notes?: string;
    }
  ) => {
    try {
      ensureStore();
      const result = rateScriptSectionFeedback(
        store,
        req.scriptId,
        req.section,
        req.rating,
        req.reason,
        req.notes
      );
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
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
      additionalInfo?: string;
      skipDuplicateCheck?: boolean;
      bypassApiLimits?: boolean;
      generationNonce?: number;
    }
  ) => {
    try {
      ensureStore();
      const result = await generateScript(store, {
        productId: req.productId,
        durationSeconds: req.durationSeconds,
        referenceLibraryId: req.referenceLibraryId,
        additionalInfo: req.additionalInfo,
        skipDuplicateCheck: req.skipDuplicateCheck,
        bypassApiLimits: req.bypassApiLimits,
        generationNonce: req.generationNonce,
      });
      if (result.validationBlocked) {
        store.appendLog("script", "error", `Validation blocked: ${result.validationViolations?.join(", ")}`);
        return {
          ok: true,
          validationBlocked: true,
          validationViolations: result.validationViolations,
          validationLessonSaved: result.validationLessonSaved,
          result,
        };
      }
      store.appendLog("script", "ok", result.title);
      notifyHubDataChanged({
        kind: "script",
        summary: `Script generated: ${result.title}`,
        count: 1,
      });
      return { ok: true, result, cost: result.cost };
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
  async (
    _e,
    req: {
      planDate?: string;
      limits: { top: number; middle: number; bottom: number };
      selectedProductNames?: string[];
      additionalInfo?: string;
    }
  ) => {
    try {
      ensureStore();
      const validation = validateLimits(req.limits);
      if (!validation.ok) return { ok: false, error: validation.error };
      const plan = await generateDailyPlan(store, req);
      notifyHubDataChanged({
        kind: "daily_plan",
        summary: `Daily plan for ${plan.planDate}: ${plan.totalVideos} videos`,
        count: plan.totalVideos,
      });
      return { ok: true, plan, cost: plan.cost };
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
    restoreWindowInputFocus(win, true);
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }

    const filePath = result.filePaths[0];
    const res = ingestIncomingFile(store, paths.dataDir, filePath, "sales");
    store.appendLog("sales", "ok", `Imported ${res.count} products from ${res.file}`);
    notifyHubDataChanged(hubChangeFromImport(res.type, res.count, res.file || path.basename(filePath)));
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
    const product = store
      .list<{ id: string; name?: string }>("products")
      .find((p) => p.id === existing.product_id);
    assertScriptPassesValidation(
      String(existing.script_text || ""),
      product?.name ? String(product.name) : undefined
    );

    // Build a human-readable filename: ScriptTitle_YYYY-MM-DD
    function buildAudioName(script: Record<string, unknown>): string {
      const title = String(script.title || script.script_text || script.id || "audio")
        .replace(/<[^>]+>/g, "")   // strip any SSML tags
        .replace(/[^\w\s-]/g, "")  // remove special chars
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 60);
      const date = new Date().toISOString().slice(0, 10);
      return `${title}_${date}` || String(script.id);
    }

    const audioDir = path.join(app.getPath("userData"), "audio");
    const result = await synthesizeSpeech(store, {
      text: String(existing.script_text || ""),
      ssml: String(existing.ssml || ""),
      scriptId: buildAudioName(existing),
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

ipcMain.handle("hub:google-drive-status", async () => {
  try {
    ensureStore();
    return { ok: true, ...(await getGoogleDriveStatus(store)) };
  } catch (err) {
    return { ok: false, connected: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:google-drive-connect", async () => {
  try {
    ensureStore();
    const res = await connectGoogleDrive(store);
    restoreWindowInputFocus(mainWindow, true);
    return res;
  } catch (err) {
    restoreWindowInputFocus(mainWindow, true);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:get-todays-drive-folder-status", async () => {
  try {
    ensureStore();
    return { ok: true, ...(await getTodaysDriveFolderStatus(store)) };
  } catch (err) {
    return {
      ok: false,
      connected: false,
      ready: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

ipcMain.handle("hub:create-todays-drive-folders", async () => {
  try {
    ensureStore();
    const result = await createTodaysDriveFolders(store);
    if (!result.ok) return result;
    store.appendLog("drive", "ok", `Created today's folders: ${result.folderPath}`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.appendLog("drive", "error", message);
    return { ok: false, error: message };
  }
});

ipcMain.handle("hub:upload-voiceover-to-drive", async (_e, scriptId: string) => {
  try {
    ensureStore();
    const result = await uploadScriptVoiceoverToDrive(store, scriptId);
    store.appendLog("drive", "ok", `Uploaded ${result.fileName} → ${result.folderPath}`);
    notifyHubDataChanged({
      kind: "import",
      summary: `Voiceover uploaded — pending analysis queued`,
      count: 1,
    });
    return { ok: true, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.appendLog("drive", "error", message);
    return { ok: false, error: message };
  }
});

ipcMain.handle("hub:batch-pending-from-today", (_e, dateTag?: string) => {
  try {
    ensureStore();
    const result = batchAddTodayScriptsToPending(store, dateTag);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle(
  "hub:batch-pending-scripts",
  (_e, req?: { daysBack?: number; dateTag?: string }) => {
    try {
      ensureStore();
      const result = batchAddScriptsToPending(store, req || {});
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
);

ipcMain.handle("hub:list-pending-analysis", () => {
  ensureStore();
  return listPendingAnalysis(store);
});

ipcMain.handle("hub:set-pending-analysis-url", async (_e, req: { id: string; url: string }) => {
  try {
    ensureStore();
    const entry = await setPendingTikTokUrl(store, req.id, req.url);
    return { ok: true, entry };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:pull-pending-analysis", async (_e, id: string) => {
  try {
    ensureStore();
    const entry = await pullPendingStatsAndAnalyse(store, id);
    return { ok: true, entry };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:update-pending-performance", async (_e, req: { id: string; data: PendingAnalysisSubmit }) => {
  try {
    ensureStore();
    const entry = await updatePendingPerformanceData(store, req.id, req.data);
    return { ok: true, entry };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:submit-pending-analysis", async (_e, req: { id: string; data: PendingAnalysisSubmit }) => {
  try {
    ensureStore();
    const result = await submitPendingAnalysis(store, req.id, req.data);
    notifyHubDataChanged({
      kind: "import",
      summary: `Pending analysis submitted — score ${result.score}/100`,
      count: 1,
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:delete-pending-analysis", (_e, req: { id: string; deleteScript?: boolean }) => {
  try {
    ensureStore();
    deletePendingAnalysis(store, req.id, !!req.deleteScript);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:remove-duplicate-pending", () => {
  try {
    ensureStore();
    const result = removeDuplicatePendingEntries(store);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:clear-pending-dismissals", () => {
  try {
    ensureStore();
    const result = clearPendingDismissals(store);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:refresh-products-from-library", () => {
  const count = extractProductsFromLibrary(store);
  notifyHubDataChanged({
    kind: "products",
    summary: "Products refreshed from library analyses",
    count,
  });
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
    restoreWindowInputFocus(win, true);
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }

    const imported: Array<{ file: string; ok: true; type: string; count: number }> = [];
    const errors: Array<{ file: string; error: string }> = [];

    for (const filePath of result.filePaths) {
      const fileName = path.basename(filePath);
      try {
        const category = classifyImportFile(filePath);
        const res = ingestIncomingFile(store, paths.dataDir, filePath, category === "inbox" ? undefined : category);
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
      for (const row of imported) {
        notifyHubDataChanged(hubChangeFromImport(row.type, row.count, row.file));
      }
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
    for (const row of imported) {
      if (row.ok) notifyHubDataChanged(hubChangeFromImport(row.type, row.count, row.file));
    }
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

ipcMain.handle("hub:open-data-subfolder", (_e, folderId: string) => {
  ensureStore();
  ensureDataLayout(paths.dataDir);
  const key = folderId in DATA_FOLDERS ? (folderId as DataCategory) : "inbox";
  const sub = categoryFolder(paths.dataDir, key);
  fs.mkdirSync(sub, { recursive: true });
  shell.openPath(sub);
  return { ok: true };
});

ipcMain.handle("hub:get-data-layout", () => {
  ensureStore();
  return getDataLayoutSummary(paths.dataDir, paths.dbDir, store.list("import_history").length);
});

ipcMain.handle("hub:list-import-history", () => {
  ensureStore();
  return store
    .list<{
      id: string;
      category: string;
      file_name: string;
      relative_path: string;
      import_type: string;
      record_count: number;
      imported_at: string;
    }>("import_history")
    .sort((a, b) => b.imported_at.localeCompare(a.imported_at))
    .slice(0, 50);
});

ipcMain.handle("hub:get-agent-status", () => {
  ensureStore();
  return getAgentStatus(store);
});

ipcMain.handle("hub:get-agent-budget", () => {
  ensureStore();
  return getAgentBudgetStatus(store);
});

ipcMain.handle("hub:reset-agent-guardrails", () => {
  ensureStore();
  resetAgentGuardrails(store);
  return { ok: true, budget: getAgentBudgetStatus(store) };
});

ipcMain.handle("hub:sync-agent-memory", async (_e, req?: { bypassLimits?: boolean }) => {
  try {
    ensureStore();
    const result = await syncHubContextToMemoryStore(store, paths.dataDir, paths.dbDir, {
      bypassSyncLimits: req?.bypassLimits === true,
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:estimate-agent-cost", (_e, params) => {
  try {
    ensureStore();
    const cost = estimateAgentActionCost(params);
    return { ok: true, cost };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:list-creator-guidance", () => {
  ensureStore();
  return listCreatorGuidance(store);
});

ipcMain.handle("hub:add-creator-guidance", (_e, req: { kind: CreatorGuidanceKind; text: string }) => {
  try {
    ensureStore();
    const entry = addCreatorGuidance(store, req.kind, req.text);
    notifyHubDataChanged({ kind: "product_edit", summary: `Added creator ${req.kind}` });
    return { ok: true, entry };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:delete-creator-guidance", (_e, id: string) => {
  try {
    ensureStore();
    deleteCreatorGuidance(store, id);
    notifyHubDataChanged({ kind: "product_edit", summary: "Removed creator guidance" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:send-agent-message", async (_e, message: string) => {
  try {
    ensureStore();
    if (!message?.trim()) return { ok: false, error: "Message is empty." };
    const result = await sendAgentMessage(store, message.trim());
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle(
  "hub:request-agent-task",
  async (
    _e,
    req: {
      task: "generate_script" | "generate_daily_plan" | "analyze_data" | "custom";
      instructions: string;
      context?: string;
    }
  ) => {
    try {
      ensureStore();
      if (!req.instructions?.trim()) return { ok: false, error: "Instructions are empty." };
      const result = await requestAgentTask(store, req.task, req.instructions.trim(), req.context?.trim());
      return { ok: true, reply: result.reply, sessionId: result.sessionId, cost: result.cost };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
);

ipcMain.handle("hub:list-agent-chat-history", () => {
  ensureStore();
  return listAgentChatHistory(store);
});

ipcMain.handle("hub:reset-agent-session", async () => {
  try {
    ensureStore();
    clearAgentSession(store);
    const session = await createAgentSession(store, true);
    return { ok: true, sessionId: session.sessionId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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

// ── My Videos ────────────────────────────────────────────────────────────────

ipcMain.handle("hub:import-personal-library", () => {
  ensureStore();
  const plPath = path.join(paths.dataDir, "personal_library.json");
  if (!fs.existsSync(plPath)) {
    return { ok: true, count: 0, message: "No personal_library.json in data folder yet — save videos from the extension first." };
  }
  try {
    const result = importJsonFile(store, plPath);
    return { ok: true, count: result.count };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:list-my-videos", () => {
  ensureStore();
  const now = new Date().toISOString();
  const videos = store
    .list<MyVideo>("my_videos")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return videos.map((video) => {
    const backfilled = backfillMyVideoThumbnail(video);
    if (
      (backfilled.thumbnail_url && backfilled.thumbnail_url !== video.thumbnail_url) ||
      backfilled.analysis?.duration_seconds !== video.analysis?.duration_seconds
    ) {
      store.upsertById("my_videos", { ...backfilled, updated_at: now } as unknown as typeof backfilled);
    }
    return backfilled;
  });
});

ipcMain.handle("hub:save-my-video", async (_e, submission: MyVideoSubmission & { id?: string }) => {
  try {
    ensureStore();
    const now = new Date().toISOString();
    const id = submission.id || randomUUID();
    const existing = store.list<MyVideo>("my_videos").find((v) => v.id === id);
    const durationSeconds = getAnalysisDurationSeconds(existing?.analysis);
    const watchTime = resolveWatchTimeFromSubmit({
      watch_time_seconds: submission.watch_time_seconds,
      watch_time_pct: submission.watch_time_pct,
      durationSeconds,
    });
    let thumbnail_url =
      submission.thumbnail_url ?? existing?.thumbnail_url ?? existing?.analysis?.thumbnail_url ?? null;
    if (
      !thumbnail_url &&
      submission.url?.trim() &&
      (watchTime.watch_time_seconds != null || watchTime.watch_time_pct != null)
    ) {
      thumbnail_url = await fetchVideoThumbnail(submission.url);
    }
    let analysis = existing?.analysis || null;
    if (analysis && durationSeconds != null && analysis.duration_seconds !== durationSeconds) {
      analysis = { ...analysis, duration_seconds: durationSeconds };
    }
    const video: MyVideo = {
      ...existing,
      ...submission,
      ...watchTime,
      id,
      thumbnail_url,
      analysis,
      analysis_status: existing?.analysis_status || "pending",
      analysis_error: "",
      score: existing?.score ?? null,
      created_at: existing?.created_at || now,
      updated_at: now,
      // Clear the pending flag once the user has manually saved/updated the entry
      pending_hub_review: false,
    };
    video.score = scoreMyVideo(video);
    store.upsertById("my_videos", video as unknown as typeof video);
    syncMyVideoToPositiveMemory(store, video);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("hub:delete-my-video", (_e, id: string) => {
  ensureStore();
  removeMyVideoFromPositiveMemory(store, id);
  store.deleteById("my_videos", id);
  return { ok: true };
});

ipcMain.handle("hub:analyse-my-video", async (_e, videoId: string) => {
  try {
    ensureStore();
    const videos = store.list<MyVideo>("my_videos");
    const video = videos.find((v) => v.id === videoId);
    if (!video) return { ok: false, error: "Video not found" };

    store.upsertById("my_videos", { ...video, analysis_status: "analysing", analysis_error: "" });

    const analysis = await analyseMyVideo(store, videoId);

    const updated: MyVideo = {
      ...video,
      analysis,
      thumbnail_url: analysis.thumbnail_url ?? video.thumbnail_url,
      analysis_status: "complete",
      analysis_error: "",
      updated_at: new Date().toISOString(),
    };
    updated.score = scoreMyVideo(updated);
    store.upsertById("my_videos", updated);

    return { ok: true, analysis, score: updated.score };
  } catch (err) {
    ensureStore();
    const msg = err instanceof Error ? err.message : String(err);
    const video = store.list<MyVideo>("my_videos").find((v) => v.id === videoId);
    if (video) store.upsertById("my_videos", { ...video, analysis_status: "error", analysis_error: msg });
    return { ok: false, error: msg };
  }
});
