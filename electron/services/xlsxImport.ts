import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import type { JsonStore } from "../db.js";
import { importProductsJson } from "./productExtractor.js";

type Row = Record<string, string>;

const NAME_KEYS = [
  "product name",
  "product title",
  "product info",
  "item name",
  "item title",
  "sku name",
  "sku title",
  "name",
];

const BRAND_KEYS = ["brand", "shop name", "seller name", "store name", "merchant name", "shop"];
const PRICE_KEYS = [
  "retail price",
  "product price",
  "sku price",
  "unit price",
  "sale price",
  "item price",
  "original price",
  "current price",
  "listed price",
  "price amount",
  "price(gbp)",
  "price (gbp)",
  "price(usd)",
  "price (usd)",
  "price",
];
const ID_KEYS = ["product id", "item id", "sku id", "spu id"];
const GMV_KEYS = ["gmv", "total gmv", "attributed gmv", "affiliate gmv", "video gmv", "sales amount"];
const ORDERS_KEYS = ["orders", "items sold", "units sold", "quantity sold", "item sold"];
const COMMISSION_KEYS = ["commission", "est. commission", "estimated commission", "affiliate commission"];

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

  if (cell.w != null && String(cell.w).trim() !== "") {
    return String(cell.w).trim();
  }

  if (cell.v == null || cell.v === "") return "";

  if (typeof cell.v === "number") {
    const fmt = String(cell.z || "");
    if (/[£$€]|currency/i.test(fmt)) {
      const symbol = fmt.includes("£") ? "£" : fmt.includes("€") ? "€" : fmt.includes("$") ? "$" : "£";
      const decimals = fmt.includes(".00") || fmt.includes("0.00") ? 2 : cell.v % 1 === 0 ? 0 : 2;
      return `${symbol}${cell.v.toFixed(decimals)}`;
    }
    return String(cell.v);
  }

  return String(cell.v).trim();
}

function findColumn(headers: string[], keys: string[], { allowPartial = true } = {}): string | null {
  for (const key of keys) {
    const exact = headers.find((h) => h === key);
    if (exact) return exact;
  }
  if (!allowPartial) return null;
  for (const key of keys) {
    const partial = headers.find((h) => h.includes(key) && h.length <= key.length + 20);
    if (partial) return partial;
  }
  return null;
}

function sheetToRows(sheet: XLSX.WorkSheet): Row[] {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const matrix: string[][] = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const line: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      line.push(readCell(sheet, r, c));
    }
    matrix.push(line);
  }

  if (!matrix.length) return [];

  let headerIndex = 0;
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const filled = matrix[i].filter((c) => c).length;
    const joined = matrix[i].join(" ").toLowerCase();
    if (filled >= 2 && (joined.includes("product") || joined.includes("price") || joined.includes("name"))) {
      headerIndex = i;
      break;
    }
    if (filled >= 3) {
      headerIndex = i;
      break;
    }
  }

  const rawHeaders = matrix[headerIndex].map((h) => normalizeHeader(h));
  const headers = rawHeaders.map((h, i) => h || `column_${i + 1}`);
  const rows: Row[] = [];

  for (let r = headerIndex + 1; r < matrix.length; r++) {
    const line = matrix[r];
    const row: Row = {};
    let hasData = false;
    headers.forEach((header, i) => {
      const val = line[i] || "";
      if (val) hasData = true;
      row[header] = val;
    });
    if (hasData) rows.push(row);
  }

  return rows;
}

function formatPrice(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/[£$€]/.test(t)) return t;
  const n = parseFloat(t.replace(/,/g, ""));
  if (!isNaN(n) && /^\d/.test(t)) {
    return n % 1 === 0 ? `£${n}` : `£${n.toFixed(2)}`;
  }
  return t;
}

function rowsToProducts(rows: Row[], sourceLabel: string) {
  if (!rows.length) return [];

  const headers = Object.keys(rows[0]);
  const nameCol = findColumn(headers, NAME_KEYS);
  if (!nameCol) return [];

  const brandCol = findColumn(headers, BRAND_KEYS);
  const priceCol = findColumn(headers, PRICE_KEYS);
  const idCol = findColumn(headers, ID_KEYS, { allowPartial: false });
  const gmvCol = findColumn(headers, GMV_KEYS);
  const ordersCol = findColumn(headers, ORDERS_KEYS);
  const commissionCol = findColumn(headers, COMMISSION_KEYS);

  const products = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const name = row[nameCol]?.trim();
    if (!name || name.toLowerCase() === "total" || name.toLowerCase() === "summary") continue;

    const productId = idCol ? row[idCol] : "";
    const dedupeKey = `${productId}|${name}`.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const rawPrice = priceCol ? row[priceCol] : "";
    const price = formatPrice(rawPrice);

    const parts = [];
    if (gmvCol && row[gmvCol]) parts.push(`GMV ${row[gmvCol]}`);
    if (ordersCol && row[ordersCol]) parts.push(`Orders ${row[ordersCol]}`);
    if (commissionCol && row[commissionCol]) parts.push(`Commission ${row[commissionCol]}`);
    if (productId) parts.push(`ID ${productId}`);

    products.push({
      id: productId || undefined,
      name,
      brand: brandCol ? row[brandCol] : "",
      price,
      description: parts.join(" · ") || `Imported from ${sourceLabel}`,
      source: "tiktok_xlsx",
    });
  }

  return products;
}

function readWorkbook(filePath: string) {
  const buffer = fs.readFileSync(filePath);
  return XLSX.read(buffer, { type: "buffer", cellDates: true, cellNF: true, cellText: true });
}

export function importXlsxFile(store: JsonStore, filePath: string) {
  const base = path.basename(filePath);
  const workbook = readWorkbook(filePath);
  let totalProducts = 0;
  const sheetResults: Array<{ sheet: string; count: number }> = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = sheetToRows(sheet);
    const products = rowsToProducts(rows, base);
    if (!products.length) continue;
    totalProducts += importProductsJson(store, products);
    sheetResults.push({ sheet: sheetName, count: products.length });
  }

  if (!totalProducts) {
    throw new Error(
      `${base}: no product rows found. Need columns like "Product name" and "Retail price" / "Price".`
    );
  }

  return {
    type: "tiktok_xlsx_products",
    count: totalProducts,
    sheets: sheetResults,
    file: base,
    category: "products" as const,
  };
}
