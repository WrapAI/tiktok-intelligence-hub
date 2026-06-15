import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import type { JsonStore } from "../db.js";
import { shortenProductName } from "./productNaming.js";
import {
  findColumn,
  parseCsvLines,
  parseNumber,
  parseWorkbookSheets,
  resolveProductIdColumn,
  resolveProductNameColumn,
} from "./spreadsheetParse.js";

export type SalesRow = {
  id: string;
  product_name: string;
  full_name: string;
  brand: string;
  tiktok_product_id: string;
  gmv: number;
  orders: number;
  units: number;
  commission: number;
  period_days: number;
  imported_at: string;
  source_file: string;
};

const GMV_KEYS = [
  "gross revenue",
  "gmv",
  "total gmv",
  "attributed gmv",
  "affiliate gmv",
  "sales amount",
  "revenue",
];
const ORDERS_KEYS = ["orders", "items sold", "order count"];
const UNITS_KEYS = ["unit sales", "units sold", "units", "quantity sold", "qty sold", "item sold"];
const COMMISSION_KEYS = ["commission", "est. commission", "estimated commission"];

function rowsToSales(rows: Record<string, string>[], sourceFile: string, periodDays = 28): SalesRow[] {
  if (!rows.length) throw new Error("Could not find a product name column in sales file.");

  const headers = Object.keys(rows[0]);
  const nameCol = resolveProductNameColumn(headers, rows);
  if (!nameCol) {
    throw new Error(
      "Could not find a product name column. Expected columns like Product info (name), Product name, or Gross revenue."
    );
  }

  const idCol = resolveProductIdColumn(headers, rows);
  const brandCol = findColumn(headers, ["brand", "shop name", "seller name"]);
  const gmvCol = findColumn(headers, GMV_KEYS);
  const ordersCol = findColumn(headers, ORDERS_KEYS);
  const unitsCol = findColumn(headers, UNITS_KEYS);
  const commissionCol = findColumn(headers, COMMISSION_KEYS);

  const now = new Date().toISOString();
  const seen = new Set<string>();
  const sales: SalesRow[] = [];

  for (const row of rows) {
    const fullRaw = row[nameCol]?.trim();
    if (!fullRaw || fullRaw.toLowerCase() === "total" || fullRaw.toLowerCase() === "product info") continue;
    if (/^\d{10,}$/.test(fullRaw)) continue;

    const named = shortenProductName(fullRaw);
    const dedupeKey = named.fullName.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const gmv = gmvCol ? parseNumber(row[gmvCol]) : 0;
    const orders = ordersCol ? parseNumber(row[ordersCol]) : 0;
    const units = unitsCol ? parseNumber(row[unitsCol]) : orders;
    const commission = commissionCol ? parseNumber(row[commissionCol]) : 0;
    const score = gmv || orders * 10 || units * 5;
    if (score <= 0) continue;

    const tiktokId = idCol ? row[idCol]?.trim() : "";

    sales.push({
      id: tiktokId ? `sale-${tiktokId}` : `sale-${Buffer.from(dedupeKey).toString("base64url").slice(0, 16)}`,
      product_name: named.shortName,
      full_name: named.fullName,
      brand: brandCol ? row[brandCol] : named.brand,
      tiktok_product_id: tiktokId,
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

  if (!sales.length) {
    throw new Error("No product sales rows found after parsing. Check the file has GMV/revenue or unit sales data.");
  }

  return sales;
}

export function importSalesFile(store: JsonStore, filePath: string, periodDays = 28) {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  let allRows: Record<string, string>[] = [];

  if (ext === ".csv") {
    allRows = parseCsvLines(fs.readFileSync(filePath, "utf8"));
  } else if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true, cellNF: true });
    allRows = parseWorkbookSheets(workbook);
  } else {
    throw new Error("Sales import supports .csv, .xlsx, or .xls only.");
  }

  const sales = rowsToSales(allRows, base, periodDays);

  store.write("product_sales", sales);
  store.setSetting("lastSalesImportAt", sales[0].imported_at);
  store.setSetting("lastSalesImportFile", base);
  store.setSetting("salesPeriodDays", String(periodDays));

  return { count: sales.length, file: base, topProduct: sales[0].product_name };
}

export function listProductSales(store: JsonStore): SalesRow[] {
  return store.list<SalesRow>("product_sales");
}
