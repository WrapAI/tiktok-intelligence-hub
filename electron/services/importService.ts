import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { JsonStore } from "../db.js";
import {
  archiveImportedFile,
  classifyImportFile,
  collectImportableFiles,
  ensureDataLayout,
  migrateFlatDataFolder,
  routeIncomingFile,
  type DataCategory,
} from "./dataFolders.js";
import {
  extractProductsFromCompassPayload,
  extractProductsFromLibrary,
  importProductsJson,
} from "./productExtractor.js";
import { importXlsxFile } from "./xlsxImport.js";
import { importSalesFile } from "./salesImport.js";
import {
  backfillMyVideoThumbnail,
  extractThumbnailFromLibraryRow,
  type FunnelBreakdownStage,
  type MyVideo,
} from "./myVideoAnalysis.js";
import { resolveVideoDurationSeconds } from "./watchTime.js";

export type ImportResult = {
  type: string;
  count: number;
  productsExtracted?: number;
  sheets?: Array<{ sheet: string; count: number }>;
  file?: string;
  category?: DataCategory;
};

export type ImportHistoryRow = {
  id: string;
  category: DataCategory;
  file_name: string;
  relative_path: string;
  archive_path: string | null;
  import_type: string;
  record_count: number;
  imported_at: string;
  fingerprint: string;
};

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function upsertLibrary(store: JsonStore, items: unknown[]) {
  const now = new Date().toISOString();
  const rows = items.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      id: String(row.id || randomUUID()),
      payload_json: JSON.stringify(row),
      hook_type: String(row.hook_type || ""),
      funnel_category: String(row.funnel_category || row.funnel_class || ""),
      view_count:
        Number(row.view_count_at_scan) ||
        Number((row.videoData as Record<string, unknown> | undefined)?.stats &&
          ((row.videoData as Record<string, unknown>).stats as Record<string, unknown>)?.views) ||
        0,
      saved_at: String(row.savedAt || ""),
      imported_at: now,
    };
  });
  store.upsertManyById("library_items", rows);
  return rows.length;
}

function upsertMemory(store: JsonStore, items: unknown[]) {
  const now = new Date().toISOString();
  const rows = items.map((item) => {
    const row = item as Record<string, unknown>;
    const payload = { ...row };
    return {
      id: String(row.id || randomUUID()),
      payload_json: JSON.stringify(payload),
      rating: Number(row.rating) || 0,
      my_views: Number(row.my_views) || 0,
      my_gmv: Number(row.my_gmv) || 0,
      what_i_took: String(row.what_i_took || row.title || row.summary || ""),
      date_used: String(row.date_used || row.upload_date || ""),
      imported_at: now,
      entry_type: String(row.entry_type || "imported"),
      source: String(row.source || "extension"),
      my_video_id: String(row.my_video_id || ""),
      title: String(row.title || row.what_i_took || ""),
      hook_type: String(row.hook_type || ""),
      funnel_category: String(row.funnel_category || row.funnel_class || ""),
      my_commission: Number(row.my_commission) || 0,
      my_sales: Number(row.my_sales) || 0,
    };
  });
  store.upsertManyById("positive_memory", rows);
  return rows.length;
}

function saveStudioSnapshot(store: JsonStore, data: Record<string, unknown>, now: string) {
  store.upsertById("studio_snapshots", {
    id: randomUUID(),
    payload_json: JSON.stringify(data),
    synced_at: String(data.syncedAt || now),
    imported_at: now,
  });
}

function saveCompassSnapshot(store: JsonStore, data: Record<string, unknown>, now: string) {
  store.upsertById("compass_snapshots", {
    id: randomUUID(),
    payload_json: JSON.stringify(data),
    synced_at: String(data.syncedAt || now),
    imported_at: now,
  });
}

function parseFunnelBreakdownFromRow(row: Record<string, unknown>): FunnelBreakdownStage[] | null {
  const raw = row.funnel_breakdown;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const stages = Array.isArray(obj.stages) ? obj.stages : Array.isArray(raw) ? raw : null;
  if (!stages?.length) return null;
  const parsed = stages
    .map((stage) => {
      if (!stage || typeof stage !== "object") return null;
      const s = stage as Record<string, unknown>;
      const label = String(s.label || s.stage || s.funnel || "").trim();
      const time_range = String(s.time_range || s.timeRange || s.timestamps || "").trim();
      const what_happens = String(s.what_happens || s.whatHappens || s.description || "").trim();
      if (!label && !what_happens) return null;
      return { label, time_range, what_happens };
    })
    .filter((s): s is { label: string; time_range: string; what_happens: string } => s != null);
  return parsed.length ? parsed : null;
}

function upsertPersonalLibrary(store: JsonStore, items: unknown[]): number {
  const now = new Date().toISOString();
  const existingVideos = store.list<MyVideo>("my_videos");
  const existingIds = new Set(existingVideos.map((v) => v.id));

  let added = 0;
  for (const item of items) {
    const row = item as Record<string, unknown>;
    const id = String(row.id || randomUUID());
    const thumbnail_url = extractThumbnailFromLibraryRow(row);

    if (existingIds.has(id)) {
      if (thumbnail_url) {
        const existingVideo = existingVideos.find((v) => v.id === id);
        if (existingVideo && !existingVideo.thumbnail_url) {
          store.upsertById("my_videos", {
            ...existingVideo,
            thumbnail_url,
            updated_at: now,
          } as unknown as { id: string });
        }
      }
      continue;
    }

    const analysis = row.analysis as Record<string, unknown> | null ?? null;
    const videoData = row.videoData as Record<string, unknown> | null ?? null;
    const stats = videoData?.stats as Record<string, unknown> | null ?? null;
    const grokStats = row.video_stats as Record<string, unknown> | null ?? null;

    // Pull URL from wherever it may be
    const url = String(row.url || videoData?.url || row.videoUrl || "");

    const timeline = Array.isArray(row.timeline) ? (row.timeline as Array<{ timestamp: number }>) : [];
    const durationSeconds = resolveVideoDurationSeconds(
      Number(row.duration_seconds ?? (analysis as Record<string, unknown> | null)?.duration_seconds) || null,
      timeline
    );

    const entry = {
      id,
      url,
      thumbnail_url,
      views: Number(stats?.views || grokStats?.views || row.views || 0) || null,
      likes: Number(stats?.likes || grokStats?.likes || row.likes || 0) || null,
      comments: Number(stats?.comments || grokStats?.comments || row.comments || 0) || null,
      watch_time_pct: null,
      sales: null,
      gmv: null,
      commission: null,
      audience_male_pct: null,
      audience_female_pct: null,
      audience_other_pct: null,
      upload_date: String(row.upload_date || row.uploadDate || row.savedAt || "").slice(0, 10),
      submitted_at: now,
      // Build analysis from the extension's Grok output
      analysis: url ? {
        duration_seconds: durationSeconds,
        thumbnail_url: thumbnail_url,
        transcript: String(row.transcript || (analysis as Record<string, unknown> | null)?.transcript || ""),
        onscreen_hook: String((row.hooks as Record<string, unknown> | null)?.on_screen_text || row.onscreen_hook || "") || null,
        video_structure: String(row.detailed_analysis || ""),
        cta_timestamps: Array.isArray((row.cta as Record<string, unknown> | null)?.timestamps)
          ? ((row.cta as Record<string, unknown>).timestamps as number[])
          : [],
        hook_type: String(row.hook_type || (row.hooks as Record<string, unknown> | null)?.hook_type || "") || null,
        funnel_category: String(row.funnel_category || row.funnel_class || "") || null,
        funnel_category_reason: String(row.funnel_category_reason || row.funnel_class_reason || "") || null,
        funnel_breakdown: parseFunnelBreakdownFromRow(row),
        timeline,
        pacing_notes: String((row.watch_time_psychology as Record<string, unknown> | null)?.pacing_notes || ""),
        detailed_analysis: String(row.detailed_analysis || ""),
        raw_json: JSON.stringify(row),
      } : null,
      analysis_status: url ? "complete" as const : "pending" as const,
      analysis_error: "",
      // Flag for hub UI to prompt for missing performance data
      pending_hub_review: row.pending_hub_review === true,
      score: null,
      created_at: String(row.saved_at || row.savedAt || now),
      updated_at: now,
    };

    store.upsertById("my_videos", entry as unknown as { id: string });
    existingIds.add(id);
    added++;
  }
  return added;
}

function detectJsonImport(store: JsonStore, data: unknown, filePath: string): ImportResult {
  const now = new Date().toISOString();
  const base = path.basename(filePath);

  if (Array.isArray(data)) {
    if (!data.length) throw new Error(`${base}: JSON array is empty`);

    const sample = data[0] as Record<string, unknown>;
    if (sample.what_i_took != null || sample.source_hook != null || sample.source_video_url) {
      return { type: "positive_memory", count: upsertMemory(store, data), category: "memory" };
    }
    if (sample.name && !sample.hook && !sample.videoData && !sample.hook_type && !sample.hook_detail) {
      return { type: "products", count: importProductsJson(store, data), category: "products" };
    }

    const count = upsertLibrary(store, data);
    const productsExtracted = extractProductsFromLibrary(store);
    return { type: "library", count, productsExtracted, category: "library" };
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;

    if (Array.isArray(obj.videos)) {
      saveStudioSnapshot(store, obj, now);
      return { type: "studio", count: Number(obj.totalVideos) || obj.videos.length || 1, category: "studio" };
    }

    if (obj.overview || obj.gmv || obj.products || obj.compass || obj.metrics) {
      saveCompassSnapshot(store, obj, now);
      const productsExtracted = extractProductsFromCompassPayload(store, obj);
      return { type: "compass", count: 1, productsExtracted, category: "compass" };
    }

    if (Array.isArray(obj.library)) {
      const count = upsertLibrary(store, obj.library);
      const productsExtracted = extractProductsFromLibrary(store);
      return { type: "library", count, productsExtracted, category: "library" };
    }

    if (Array.isArray(obj.positiveMemory) || Array.isArray(obj.positive_memory)) {
      const items = (obj.positiveMemory || obj.positive_memory) as unknown[];
      return { type: "positive_memory", count: upsertMemory(store, items), category: "memory" };
    }

    if (Array.isArray(obj.personalLibrary)) {
      return { type: "personal_library", count: upsertPersonalLibrary(store, obj.personalLibrary), category: "library" };
    }
  }

  throw new Error(`${base}: unrecognized JSON — expected library, memory, studio, compass, or products data`);
}

export function importJsonFile(store: JsonStore, filePath: string): ImportResult {
  const base = path.basename(filePath).toLowerCase();
  const data = readJsonFile(filePath);
  const now = new Date().toISOString();

  if (base === "library.json" && Array.isArray(data)) {
    const count = upsertLibrary(store, data);
    return { type: "library", count, productsExtracted: extractProductsFromLibrary(store), category: "library" };
  }
  if (base === "positive_memory.json" && Array.isArray(data)) {
    return { type: "positive_memory", count: upsertMemory(store, data), category: "memory" };
  }
  if (base === "my_studio_data.json" && data && typeof data === "object") {
    saveStudioSnapshot(store, data as Record<string, unknown>, now);
    return { type: "studio", count: 1, category: "studio" };
  }
  if (base === "personal_library.json" && Array.isArray(data)) {
    return { type: "personal_library", count: upsertPersonalLibrary(store, data), category: "library" };
  }
  if (base === "my_compass_data.json" && data && typeof data === "object") {
    saveCompassSnapshot(store, data as Record<string, unknown>, now);
    return {
      type: "compass",
      count: 1,
      productsExtracted: extractProductsFromCompassPayload(store, data as Record<string, unknown>),
      category: "compass",
    };
  }
  if (base === "products.json" && Array.isArray(data)) {
    return { type: "products", count: importProductsJson(store, data), category: "products" };
  }

  return detectJsonImport(store, data, filePath);
}

export function importFile(store: JsonStore, filePath: string): ImportResult {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return importJsonFile(store, filePath);
  if (ext === ".csv") return importSalesDataFile(store, filePath);
  if (ext === ".xlsx" || ext === ".xls") {
    const category = classifyImportFile(filePath);
    if (category === "sales") return importSalesDataFile(store, filePath);
    return importXlsxFile(store, filePath);
  }
  throw new Error(`Unsupported file type "${ext || "unknown"}". Use .json, .csv, .xlsx, or .xls`);
}

export function importSalesDataFile(store: JsonStore, filePath: string, periodDays = 28): ImportResult {
  const res = importSalesFile(store, filePath, periodDays);
  return { type: "product_sales", count: res.count, file: res.file, category: "sales" };
}

export function importProducts(store: JsonStore, items: unknown[]) {
  return importProductsJson(store, items);
}

function fileFingerprint(filePath: string) {
  const stat = fs.statSync(filePath);
  return `${stat.size}:${stat.mtimeMs}`;
}

function readImportManifest(store: JsonStore): Record<string, string> {
  const raw = store.getSetting("importManifest", "{}");
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeImportManifest(store: JsonStore, manifest: Record<string, string>) {
  store.setSetting("importManifest", JSON.stringify(manifest));
}

function logImportHistory(
  store: JsonStore,
  entry: Omit<ImportHistoryRow, "id" | "imported_at"> & { imported_at?: string }
) {
  store.upsertById("import_history", {
    id: randomUUID(),
    imported_at: entry.imported_at || new Date().toISOString(),
    ...entry,
  });
}

function finalizeImport(
  store: JsonStore,
  dataDir: string,
  filePath: string,
  relativePath: string,
  category: DataCategory,
  result: ImportResult
) {
  const archivePath = archiveImportedFile(dataDir, filePath, category);
  logImportHistory(store, {
    category,
    file_name: path.basename(filePath),
    relative_path: relativePath,
    archive_path: archivePath,
    import_type: result.type,
    record_count: result.count,
    fingerprint: fileFingerprint(filePath),
  });
}

function tryImportFile(
  store: JsonStore,
  dataDir: string,
  fullPath: string,
  relativePath: string,
  label: string
) {
  try {
    const res = importFile(store, fullPath);
    const category = res.category || classifyImportFile(fullPath);
    finalizeImport(store, dataDir, fullPath, relativePath, category, res);
    return { file: label, ok: true as const, ...res };
  } catch (err) {
    return {
      file: label,
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function importFromDataFolder(
  store: JsonStore,
  dataDir: string,
  options: { force?: boolean } = {}
) {
  const results: Array<
    | ({ file: string; ok: true } & ImportResult)
    | { file: string; ok: false; error: string }
  > = [];

  ensureDataLayout(dataDir);
  migrateFlatDataFolder(dataDir);

  const manifest = readImportManifest(store);
  const nextManifest = { ...manifest };
  let manifestChanged = false;

  for (const { relativePath, fullPath } of collectImportableFiles(dataDir)) {
    const fingerprint = fileFingerprint(fullPath);
    if (!options.force && manifest[relativePath] === fingerprint) continue;

    const result = tryImportFile(store, dataDir, fullPath, relativePath, relativePath);
    results.push(result);
    if (result.ok) {
      nextManifest[relativePath] = fingerprint;
      manifestChanged = true;
    }
  }

  if (manifestChanged) writeImportManifest(store, nextManifest);
  return results;
}

export function importFromDataFolderIfChanged(store: JsonStore, dataDir: string) {
  return importFromDataFolder(store, dataDir, { force: false });
}

/** Route a picked file into the correct subfolder, then return the stored path. */
export function copyIncomingFile(dataDir: string, sourcePath: string, category?: DataCategory): string {
  ensureDataLayout(dataDir);
  return routeIncomingFile(dataDir, sourcePath, category).destPath;
}

export function ingestIncomingFile(
  store: JsonStore,
  dataDir: string,
  sourcePath: string,
  category?: DataCategory
): ImportResult & { storedPath: string; relativePath: string } {
  ensureDataLayout(dataDir);
  const routed = routeIncomingFile(dataDir, sourcePath, category);
  const result = importFile(store, routed.destPath);
  const resolvedCategory = result.category || routed.category;
  finalizeImport(store, dataDir, routed.destPath, routed.relativePath, resolvedCategory, result);
  return { ...result, storedPath: routed.destPath, relativePath: routed.relativePath };
}

export { ensureDataLayout, migrateFlatDataFolder, getDataLayoutSummary, classifyImportFile, categoryFolder, DATA_FOLDERS } from "./dataFolders.js";
export type { DataCategory, DataLayoutSummary, DataFolderInfo } from "./dataFolders.js";
