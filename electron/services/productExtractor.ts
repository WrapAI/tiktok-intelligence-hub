import { createHash, randomUUID } from "node:crypto";
import type { JsonStore } from "../db.js";
import { scheduleProductResearch } from "./productResearch.js";

function productId(name: string, brand = ""): string {
  return createHash("sha256").update(`${brand}|${name}`.toLowerCase()).digest("hex").slice(0, 16);
}

function upsertProduct(
  store: JsonStore,
  row: {
    name: string;
    brand?: string;
    price?: string;
    description?: string;
    source: string;
  }
) {
  if (!row.name?.trim()) return false;
  const now = new Date().toISOString();
  const id = productId(row.name, row.brand);
  const existing = store.list<Record<string, unknown>>("products").find((p) => p.id === id);
  const isNew = !existing;
  store.upsertById("products", {
    ...(existing || {}),
    id,
    name: row.name.trim(),
    brand: row.brand || "",
    price: row.price || "",
    description: row.description || "",
    image_url: "",
    source: row.source,
    raw_json: JSON.stringify(row),
    created_at: String(existing?.created_at || now),
    updated_at: now,
  });
  if (isNew) {
    scheduleProductResearch(store, id);
  }
  return true;
}

export function extractProductsFromLibrary(store: JsonStore): number {
  const rows = store.list<{ payload_json: string }>("library_items");
  let count = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    let item: Record<string, unknown>;
    try {
      item = JSON.parse(row.payload_json);
    } catch {
      continue;
    }

    const product = (item.product as Record<string, unknown>) || {};
    const videoData = (item.videoData as Record<string, unknown>) || {};
    const shop = (videoData.shopProduct as Record<string, unknown>) || {};

    const name = String(product.name || shop.name || "").trim();
    if (!name) continue;

    const key = `${product.brand || shop.brand || ""}|${name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (
      upsertProduct(store, {
        name,
        brand: String(product.brand || shop.brand || ""),
        price: String(product.price || shop.price || ""),
        description: String(product.name || name),
        source: "library",
      })
    ) {
      count += 1;
    }
  }
  return count;
}

export function extractProductsFromCompassPayload(store: JsonStore, compass: Record<string, unknown>): number {
  let count = 0;
  const products = (compass.products as { products?: unknown[] })?.products;
  const topList = Array.isArray(products) ? products : [];

  for (const p of topList) {
    const row = p as Record<string, unknown>;
    const name = String(row.name || row.product_name || row.title || "").trim();
    if (!name) continue;
    if (
      upsertProduct(store, {
        name,
        brand: String(row.brand || ""),
        price: String(row.gmv || row.price || ""),
        description: `GMV ${row.gmv || ""} · units ${row.units || row.items_sold || ""}`,
        source: "compass",
      })
    ) {
      count += 1;
    }
  }

  const overviewProducts = (compass as { products?: unknown[] }).products;
  if (Array.isArray(overviewProducts)) {
    for (const p of overviewProducts) {
      const row = p as Record<string, unknown>;
      const name = String(row.name || row.product || "").trim();
      if (!name) continue;
      if (
        upsertProduct(store, {
          name,
          brand: "",
          price: String(row.gmv || ""),
          description: "From Compass sync",
          source: "compass",
        })
      ) {
        count += 1;
      }
    }
  }

  return count;
}

export function importProductsJson(store: JsonStore, items: unknown[]): number {
  let count = 0;
  for (const item of items) {
    const row = item as Record<string, unknown>;
    const name = String(row.name || "").trim();
    if (!name) continue;
    const id = String(row.id || productId(name, String(row.brand || "")));
    const now = new Date().toISOString();
    store.upsertById("products", {
      id,
      name,
      brand: String(row.brand || ""),
      price: String(row.price || ""),
      description: String(row.description || ""),
      image_url: String(row.image_url || row.imageUrl || ""),
      source: String(row.source || "import"),
      raw_json: JSON.stringify(row),
      created_at: String(row.created_at || now),
      updated_at: now,
    });
    count += 1;
  }
  return count;
}
