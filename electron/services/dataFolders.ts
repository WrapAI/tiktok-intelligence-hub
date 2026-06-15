import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { detectHeaderRow, findColumn, sheetToMatrix } from "./spreadsheetParse.js";

export const DATA_FOLDERS = {
  library: "library",
  memory: "memory",
  products: "products",
  sales: "sales-data",
  studio: "studio",
  compass: "compass",
  inbox: "inbox",
  archive: "archive",
} as const;

export type DataCategory = keyof typeof DATA_FOLDERS;

export type DataFolderInfo = {
  id: DataCategory;
  label: string;
  description: string;
  path: string;
  fileCount: number;
};

export type DataLayoutSummary = {
  root: string;
  database: string;
  folders: DataFolderInfo[];
  archiveCount: number;
  importHistoryCount: number;
};

const FOLDER_META: Record<DataCategory, { label: string; description: string }> = {
  library: {
    label: "Library saves",
    description: "Analysed competitor videos from the extension (library.json)",
  },
  memory: {
    label: "Positive memory",
    description: "Your winning posts and what you took from them",
  },
  products: {
    label: "Product lists",
    description: "TikTok Shop catalog exports and products.json",
  },
  sales: {
    label: "Sales data",
    description: "28-day Creator Product List and affiliate sales CSV/XLSX",
  },
  studio: {
    label: "Studio sync",
    description: "TikTok Studio performance exports",
  },
  compass: {
    label: "Compass sync",
    description: "Affiliate Compass / GMV exports",
  },
  inbox: {
    label: "Inbox",
    description: "Drop files here if you are not sure — the hub will classify on import",
  },
  archive: {
    label: "Archive",
    description: "Timestamped copies of every successful import",
  },
};

const KNOWN_JSON: Record<string, DataCategory> = {
  "library.json": "library",
  "positive_memory.json": "memory",
  "products.json": "products",
  "my_studio_data.json": "studio",
  "my_compass_data.json": "compass",
  "personal_library.json": "library",
};

const SKIP_SCAN = new Set(["sync_request.json", ".ds_store", "thumbs.db"]);

function isSkippableScanEntry(name: string): boolean {
  const lower = name.toLowerCase();
  if (SKIP_SCAN.has(lower)) return true;
  if (lower.startsWith(".")) return true;
  return false;
}

export function categoryFolder(dataDir: string, category: DataCategory): string {
  return path.join(dataDir, DATA_FOLDERS[category]);
}

export function archiveCategoryFolder(dataDir: string, category: DataCategory): string {
  return path.join(categoryFolder(dataDir, "archive"), DATA_FOLDERS[category]);
}

export function ensureDataLayout(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const category of Object.keys(DATA_FOLDERS) as DataCategory[]) {
    fs.mkdirSync(categoryFolder(dataDir, category), { recursive: true });
  }
  for (const category of ["library", "memory", "products", "sales", "studio", "compass", "inbox"] as DataCategory[]) {
    fs.mkdirSync(archiveCategoryFolder(dataDir, category), { recursive: true });
  }
}

export function classifyImportFilename(fileName: string): DataCategory {
  const lower = fileName.toLowerCase();
  if (KNOWN_JSON[lower]) return KNOWN_JSON[lower];
  if (lower.endsWith(".csv")) return "sales";
  if (lower.includes("creator product list") || lower.includes("product list -")) return "sales";
  if (lower.includes("sales") || lower.includes("gmv") || lower.includes("commission")) return "sales";
  if (lower.includes("product") && (lower.endsWith(".xlsx") || lower.endsWith(".xls"))) return "products";
  if (lower.endsWith(".json")) return "inbox";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "inbox";
  return "inbox";
}

function readSpreadsheetHeaders(filePath: string): string[] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") {
    const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const firstLine = content.split(/\r?\n/).find((l) => l.trim()) || "";
    return firstLine.split(",").map((h) => h.trim().toLowerCase());
  }

  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true, cellNF: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const matrix = sheetToMatrix(sheet);
  const headerRow = detectHeaderRow(matrix);
  const used = new Map<string, number>();
  return matrix[headerRow].map((cell, i) => {
    const base =
      String(cell ?? "")
        .trim()
        .toLowerCase()
        .replace(/[_\n\r]+/g, " ")
        .replace(/\s+/g, " ") || `column_${i + 1}`;
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

export function detectSpreadsheetCategory(filePath: string): "sales" | "products" | "inbox" {
  const fileName = path.basename(filePath);
  const byName = classifyImportFilename(fileName);
  if (byName === "sales") return "sales";
  if (byName === "products") return "products";

  try {
    const headers = readSpreadsheetHeaders(filePath);
    if (!headers.length) return "inbox";

    const hasSales =
      !!findColumn(headers, ["gross revenue", "unit sales", "attributed gmv", "affiliate gmv"]) ||
      (!!findColumn(headers, ["gmv", "commission"]) && !!findColumn(headers, ["product info", "product name"]));
    if (hasSales) return "sales";

    const hasProducts = !!findColumn(headers, [
      "retail price",
      "product price",
      "sku price",
      "sale price",
      "listed price",
      "price",
    ]);
    if (hasProducts) return "products";
  } catch {
    return "inbox";
  }

  return "inbox";
}

export function classifyImportFile(filePath: string): DataCategory {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  if (ext === ".json") return classifyImportFilename(fileName);
  if (ext === ".csv") return "sales";
  if (ext === ".xlsx" || ext === ".xls") return detectSpreadsheetCategory(filePath);
  return "inbox";
}

function uniquifyDest(destPath: string): string {
  if (!fs.existsSync(destPath)) return destPath;
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  let n = 1;
  while (fs.existsSync(path.join(dir, `${base}-${n}${ext}`))) n += 1;
  return path.join(dir, `${base}-${n}${ext}`);
}

export function routeIncomingFile(
  dataDir: string,
  sourcePath: string,
  category?: DataCategory
): { destPath: string; category: DataCategory; relativePath: string } {
  ensureDataLayout(dataDir);
  const resolvedCategory = category || classifyImportFile(sourcePath);
  const folder = categoryFolder(dataDir, resolvedCategory);
  const destPath = uniquifyDest(path.join(folder, path.basename(sourcePath)));
  const src = path.resolve(sourcePath);
  const dst = path.resolve(destPath);
  if (src !== dst) {
    fs.copyFileSync(sourcePath, destPath);
  }
  return {
    destPath,
    category: resolvedCategory,
    relativePath: path.relative(dataDir, destPath).replace(/\\/g, "/"),
  };
}

export function archiveImportedFile(
  dataDir: string,
  sourcePath: string,
  category: DataCategory
): string | null {
  if (!fs.existsSync(sourcePath)) return null;
  ensureDataLayout(dataDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = archiveCategoryFolder(dataDir, category);
  const archivePath = uniquifyDest(path.join(archiveDir, `${stamp}_${path.basename(sourcePath)}`));
  fs.copyFileSync(sourcePath, archivePath);
  return archivePath;
}

export function migrateFlatDataFolder(dataDir: string): string[] {
  if (!fs.existsSync(dataDir)) return [];
  ensureDataLayout(dataDir);
  const moved: string[] = [];

  for (const entry of fs.readdirSync(dataDir)) {
    if (isSkippableScanEntry(entry)) continue;
    const full = path.join(dataDir, entry);
    if (!fs.statSync(full).isFile()) continue;

    const ext = path.extname(entry).toLowerCase();
    if (![".json", ".xlsx", ".xls", ".csv"].includes(ext)) continue;

    const category = classifyImportFile(full);
    const dest = path.join(categoryFolder(dataDir, category), entry);
    if (path.resolve(full) === path.resolve(dest)) continue;
    if (fs.existsSync(dest)) continue;

    fs.renameSync(full, dest);
    moved.push(`${entry} → ${DATA_FOLDERS[category]}/`);
  }

  return moved;
}

function countFilesRecursive(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFilesRecursive(full);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

export function collectImportableFiles(dataDir: string): Array<{ relativePath: string; fullPath: string }> {
  if (!fs.existsSync(dataDir)) return [];

  const results: Array<{ relativePath: string; fullPath: string }> = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const rel = path.relative(dataDir, full).replace(/\\/g, "/");
        if (rel === DATA_FOLDERS.archive || rel.startsWith(`${DATA_FOLDERS.archive}/`)) continue;
        walk(full);
        continue;
      }
      if (isSkippableScanEntry(entry.name)) continue;
      const lower = entry.name.toLowerCase();
      if (!lower.endsWith(".json") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".csv")) {
        continue;
      }
      const relativePath = path.relative(dataDir, full).replace(/\\/g, "/");
      if (relativePath.startsWith(`${DATA_FOLDERS.archive}/`)) continue;
      results.push({ relativePath, fullPath: full });
    }
  }

  walk(dataDir);
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function getDataLayoutSummary(dataDir: string, databaseDir: string, importHistoryCount = 0): DataLayoutSummary {
  ensureDataLayout(dataDir);
  const categories = (["library", "memory", "products", "sales", "studio", "compass", "inbox"] as DataCategory[]).map(
    (id) => ({
      id,
      label: FOLDER_META[id].label,
      description: FOLDER_META[id].description,
      path: categoryFolder(dataDir, id),
      fileCount: countFilesRecursive(categoryFolder(dataDir, id)),
    })
  );

  return {
    root: dataDir,
    database: databaseDir,
    folders: categories,
    archiveCount: countFilesRecursive(categoryFolder(dataDir, "archive")),
    importHistoryCount,
  };
}

export function folderLabel(category: DataCategory): string {
  return FOLDER_META[category]?.label || category;
}
