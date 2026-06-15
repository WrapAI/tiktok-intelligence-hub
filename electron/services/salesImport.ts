import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import type { JsonStore } from "../db.js";

export type SalesRow = {
  id: string;
  product_name: string;
  brand: string;
  gmv: number;
  orders: number;
  units: number;
  commission: number;
  period_days: number;
  imported_at: string;
  source_file: string;
};

const NAME_KEYS = [
  "product name",
  "product title",
  "item name",
  "sku name",
  "name",
  "product info",
];
const BRAND_KEYS = ["brand", "shop name", "seller name"];
const GMV_KEYS = ["gmv", "total gmv", "attributed gmv", "affiliate gmv", "sales amount", "revenue"];
const ORDERS_KEYS = ["orders", "items sold", "units sold", "order count"];
const UNITS_KEYS = ["units", "quantity sold", "qty sold", "item sold"];
const COMMISSION_KEYS = ["commission", "est. commission", "estimated commission"];

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\n\r]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseNumber(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  const n = parseFloat(String(raw).replace(/[£$€,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function findColumn(headers: string[], keys: string[]): string | null {
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

function sheetToRows(sheet: XLSX.WorkSheet): Record<string, string>[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (!rows.length) return [];

  const normalized = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      out[normalizeHeader(k)] = String(v ?? "").trim();
    }
    return out;
  });

  return normalized;
}

function parseCsv(content: string): Record<string, string>[] {
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

  const headers = splitLine(lines[0]).map(normalizeHeader);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    if (!cells.some(Boolean)) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h || `column_${idx}`] = cells[idx] || "";
    });
    rows.push(row);
  }
  return rows;
}

function rowsToSales(rows: Record<string, string>[], sourceFile: string, periodDays = 28): SalesRow[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const nameCol = findColumn(headers, NAME_KEYS);
  if (!nameCol) throw new Error("Could not find a product name column in sales file.");

  const brandCol = findColumn(headers, BRAND_KEYS);
  const gmvCol = findColumn(headers, GMV_KEYS);
  const ordersCol = findColumn(headers, ORDERS_KEYS);
  const unitsCol = findColumn(headers, UNITS_KEYS);
  const commissionCol = findColumn(headers, COMMISSION_KEYS);

  const now = new Date().toISOString();
  const seen = new Set<string>();
  const sales: SalesRow[] = [];

  for (const row of rows) {
    const product_name = row[nameCol]?.trim();
    if (!product_name || product_name.toLowerCase() === "total") continue;
    const key = product_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const gmv = gmvCol ? parseNumber(row[gmvCol]) : 0;
    const orders = ordersCol ? parseNumber(row[ordersCol]) : 0;
    const units = unitsCol ? parseNumber(row[unitsCol]) : orders;
    const commission = commissionCol ? parseNumber(row[commissionCol]) : 0;
    const score = gmv || orders * 10 || units * 5;
    if (score <= 0) continue;

    sales.push({
      id: `sale-${Buffer.from(key).toString("base64url").slice(0, 16)}`,
      product_name,
      brand: brandCol ? row[brandCol] : "",
      gmv,
      orders,
      units,
      commission,
      period_days: periodDays,
      imported_at: now,
      source_file: sourceFile,
    });
  }

  sales.sort((a, b) => {
    const scoreA = a.gmv || a.orders * 15 || a.units * 8;
    const scoreB = b.gmv || b.orders * 15 || b.units * 8;
    return scoreB - scoreA;
  });

  return sales;
}

export function importSalesFile(store: JsonStore, filePath: string, periodDays = 28) {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  let allRows: Record<string, string>[] = [];

  if (ext === ".csv") {
    const raw = fs.readFileSync(filePath, "utf8");
    allRows = parseCsv(raw);
  } else if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      allRows.push(...sheetToRows(sheet));
    }
  } else {
    throw new Error("Sales import supports .csv, .xlsx, or .xls only.");
  }

  const sales = rowsToSales(allRows, base, periodDays);
  if (!sales.length) {
    throw new Error(`${base}: no product sales rows found. Need columns like Product name and GMV or Orders.`);
  }

  store.write("product_sales", sales);
  store.setSetting("lastSalesImportAt", sales[0].imported_at);
  store.setSetting("lastSalesImportFile", base);
  store.setSetting("salesPeriodDays", String(periodDays));

  return { count: sales.length, file: base, topProduct: sales[0].product_name };
}

export function listProductSales(store: JsonStore): SalesRow[] {
  return store.list<SalesRow>("product_sales");
}
