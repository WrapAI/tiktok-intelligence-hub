import * as XLSX from "xlsx";

export type ParsedMatrix = {
  headerRowIndex: number;
  headers: string[];
  rows: string[][];
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\n\r]+/g, " ")
    .replace(/\s+/g, " ");
}

function readCell(sheet: XLSX.WorkSheet, row: number, col: number): string {
  const ref = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = sheet[ref];
  if (!cell) return "";
  if (cell.w != null && String(cell.w).trim() !== "") return String(cell.w).trim();
  if (cell.v == null || cell.v === "") return "";
  if (typeof cell.v === "number") return String(cell.v);
  return String(cell.v).trim();
}

export function sheetToMatrix(sheet: XLSX.WorkSheet): string[][] {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const matrix: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const line: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      line.push(readCell(sheet, r, c));
    }
    matrix.push(line);
  }
  return matrix;
}

function uniqueHeader(label: string, used: Map<string, number>): string {
  const base = label || "column";
  const count = used.get(base) || 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}_${count + 1}`;
}

export function detectHeaderRow(matrix: string[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const joined = matrix[i].join(" ").toLowerCase();
    const filled = matrix[i].filter(Boolean).length;
    if (filled < 2) continue;

    const hasProduct = joined.includes("product");
    const hasRevenue =
      joined.includes("gross revenue") ||
      joined.includes("gmv") ||
      joined.includes("revenue") ||
      joined.includes("sales");
    const hasUnits =
      joined.includes("unit sales") ||
      joined.includes("units sold") ||
      joined.includes("orders");

    if (hasProduct && (hasRevenue || hasUnits)) return i;
    if (hasProduct && filled >= 3) return i;
  }

  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    if (matrix[i].filter(Boolean).length >= 3) return i;
  }
  return 0;
}

export function matrixToRecords(matrix: string[][]): Record<string, string>[] {
  if (!matrix.length) return [];

  const headerRowIndex = detectHeaderRow(matrix);
  const used = new Map<string, number>();
  const headers = matrix[headerRowIndex].map((cell, i) =>
    uniqueHeader(normalizeHeader(cell) || `column_${i + 1}`, used)
  );

  const rows: Record<string, string>[] = [];
  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line.some(Boolean)) continue;
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = line[i] || "";
    });
    rows.push(row);
  }
  return rows;
}

export function parseWorkbookSheets(workbook: XLSX.WorkBook): Record<string, string>[] {
  const allRows: Record<string, string>[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    allRows.push(...matrixToRecords(sheetToMatrix(sheet)));
  }
  return allRows;
}

export function parseCsvLines(content: string): Record<string, string>[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const splitLine = (line: string) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    result.push(current.trim());
    return result;
  };

  const matrix = lines.map(splitLine);
  return matrixToRecords(matrix);
}

export function findColumn(headers: string[], keys: string[]): string | null {
  for (const key of keys) {
    const exact = headers.find((h) => h === key);
    if (exact) return exact;
  }
  for (const key of keys) {
    const partial = headers.find((h) => h.includes(key));
    if (partial) return partial;
  }
  return null;
}

/** TikTok Creator Product List uses two "Product info" cols: ID then name. */
export function resolveProductNameColumn(headers: string[], rows: Record<string, string>[]): string | null {
  const infoCols = headers.filter((h) => h === "product info" || h.startsWith("product info_"));
  if (infoCols.length >= 2) return infoCols[1];

  const byName = findColumn(headers, [
    "product name",
    "product title",
    "item name",
    "sku name",
    "name",
    "product info",
    "product info_2",
  ]);
  if (byName) {
    const sample = rows.find((r) => r[byName])?.[byName] || "";
    if (!/^\d{10,}$/.test(sample)) return byName;
  }

  if (infoCols.length === 1) {
    const sample = rows.find((r) => r[infoCols[0]])?.[infoCols[0]] || "";
    if (!/^\d{10,}$/.test(sample)) return infoCols[0];
  }

  for (const header of headers) {
    const samples = rows.slice(0, 5).map((r) => r[header] || "").filter(Boolean);
    if (!samples.length) continue;
    const avgLen = samples.reduce((a, s) => a + s.length, 0) / samples.length;
    const looksLikeName = samples.every((s) => !/^\d{10,}$/.test(s)) && avgLen > 8;
    if (looksLikeName && !header.includes("commission") && !header.includes("revenue")) {
      return header;
    }
  }

  return null;
}

export function resolveProductIdColumn(headers: string[], rows: Record<string, string>[]): string | null {
  const infoCols = headers.filter((h) => h === "product info" || h.startsWith("product info_"));
  if (infoCols.length >= 2) return infoCols[0];

  const idCol = findColumn(headers, ["product id", "item id", "sku id", "spu id"]);
  if (idCol) return idCol;

  if (infoCols.length === 1) {
    const sample = rows.find((r) => r[infoCols[0]])?.[infoCols[0]] || "";
    if (/^\d{10,}$/.test(sample)) return infoCols[0];
  }
  return null;
}

export function parseNumber(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  const n = parseFloat(String(raw).replace(/[£$€,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
