import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { JsonStore } from "../db.js";
import {
  extractProductsFromCompassPayload,
  extractProductsFromLibrary,
  importProductsJson,
} from "./productExtractor.js";
import { importXlsxFile } from "./xlsxImport.js";

export type ImportResult = {
  type: string;
  count: number;
  productsExtracted?: number;
  sheets?: Array<{ sheet: string; count: number }>;
  file?: string;
};

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function upsertLibrary(store: JsonStore, items: unknown[]) {
  const now = new Date().toISOString();
  let count = 0;
  for (const item of items) {
    const row = item as Record<string, unknown>;
    const id = String(row.id || randomUUID());
    store.upsertById("library_items", {
      id,
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
    });
    count += 1;
  }
  return count;
}

function upsertMemory(store: JsonStore, items: unknown[]) {
  const now = new Date().toISOString();
  let count = 0;
  for (const item of items) {
    const row = item as Record<string, unknown>;
    const id = String(row.id || randomUUID());
    store.upsertById("positive_memory", {
      id,
      payload_json: JSON.stringify(row),
      rating: Number(row.rating) || 0,
      my_views: Number(row.my_views) || 0,
      my_gmv: Number(row.my_gmv) || 0,
      what_i_took: String(row.what_i_took || ""),
      date_used: String(row.date_used || ""),
      imported_at: now,
    });
    count += 1;
  }
  return count;
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

function detectJsonImport(store: JsonStore, data: unknown, filePath: string): ImportResult {
  const now = new Date().toISOString();
  const base = path.basename(filePath);

  if (Array.isArray(data)) {
    if (!data.length) throw new Error(`${base}: JSON array is empty`);

    const sample = data[0] as Record<string, unknown>;
    if (sample.what_i_took != null || sample.source_hook != null || sample.source_video_url) {
      return { type: "positive_memory", count: upsertMemory(store, data) };
    }
    if (sample.name && !sample.hook && !sample.videoData && !sample.hook_type && !sample.hook_detail) {
      return { type: "products", count: importProductsJson(store, data) };
    }

    const count = upsertLibrary(store, data);
    const productsExtracted = extractProductsFromLibrary(store);
    return { type: "library", count, productsExtracted };
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;

    if (Array.isArray(obj.videos)) {
      saveStudioSnapshot(store, obj, now);
      return { type: "studio", count: Number(obj.totalVideos) || obj.videos.length || 1 };
    }

    if (obj.overview || obj.gmv || obj.products || obj.compass || obj.metrics) {
      saveCompassSnapshot(store, obj, now);
      const productsExtracted = extractProductsFromCompassPayload(store, obj);
      return { type: "compass", count: 1, productsExtracted };
    }

    if (Array.isArray(obj.library)) {
      const count = upsertLibrary(store, obj.library);
      const productsExtracted = extractProductsFromLibrary(store);
      return { type: "library", count, productsExtracted };
    }

    if (Array.isArray(obj.positiveMemory) || Array.isArray(obj.positive_memory)) {
      const items = (obj.positiveMemory || obj.positive_memory) as unknown[];
      return { type: "positive_memory", count: upsertMemory(store, items) };
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
    return { type: "library", count, productsExtracted: extractProductsFromLibrary(store) };
  }
  if (base === "positive_memory.json" && Array.isArray(data)) {
    return { type: "positive_memory", count: upsertMemory(store, data) };
  }
  if (base === "my_studio_data.json" && data && typeof data === "object") {
    saveStudioSnapshot(store, data as Record<string, unknown>, now);
    return { type: "studio", count: 1 };
  }
  if (base === "my_compass_data.json" && data && typeof data === "object") {
    saveCompassSnapshot(store, data as Record<string, unknown>, now);
    return {
      type: "compass",
      count: 1,
      productsExtracted: extractProductsFromCompassPayload(store, data as Record<string, unknown>),
    };
  }
  if (base === "products.json" && Array.isArray(data)) {
    return { type: "products", count: importProductsJson(store, data) };
  }

  return detectJsonImport(store, data, filePath);
}

export function importFile(store: JsonStore, filePath: string): ImportResult {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return importJsonFile(store, filePath);
  if (ext === ".xlsx" || ext === ".xls") return importXlsxFile(store, filePath);
  throw new Error(`Unsupported file type "${ext || "unknown"}". Use .json, .xlsx, or .xls`);
}

export function importProducts(store: JsonStore, items: unknown[]) {
  return importProductsJson(store, items);
}

function tryImportFile(store: JsonStore, fullPath: string, label: string) {
  try {
    const res = importFile(store, fullPath);
    return { file: label, ok: true as const, ...res };
  } catch (err) {
    return {
      file: label,
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function importFromDataFolder(store: JsonStore, dataDir: string) {
  const results: Array<
    | ({ file: string; ok: true } & ImportResult)
    | { file: string; ok: false; error: string }
  > = [];

  if (!fs.existsSync(dataDir)) return results;

  for (const entry of fs.readdirSync(dataDir)) {
    const lower = entry.toLowerCase();
    if (!lower.endsWith(".json") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) continue;
    const full = path.join(dataDir, entry);
    if (!fs.statSync(full).isFile()) continue;
    results.push(tryImportFile(store, full, entry));
  }

  return results;
}

export function copyIncomingFile(dataDir: string, sourcePath: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dest = path.join(dataDir, path.basename(sourcePath));
  const src = path.resolve(sourcePath);
  const dst = path.resolve(dest);
  if (src !== dst) {
    fs.copyFileSync(sourcePath, dest);
  }
  return dest;
}
