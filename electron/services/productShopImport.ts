import type { JsonStore } from "../db.js";
import { upsertCatalogProduct } from "./productExtractor.js";

const WHISPER_URL = "http://localhost:5050";

export type ShopProductData = {
  name: string;
  brand: string;
  price: string;
  description: string;
  image_url: string;
  shop_url: string;
  tiktok_product_id: string;
};

export async function fetchShopProductFromLink(url: string): Promise<ShopProductData> {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("Paste a TikTok Shop product link.");

  const res = await fetch(`${WHISPER_URL}/shop-product`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: trimmed }),
    signal: AbortSignal.timeout(45_000),
  });

  let data: { ok?: boolean; error?: string; product?: ShopProductData };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error("Whisper server returned an invalid response.");
  }

  if (!res.ok || !data.ok || !data.product?.name) {
    throw new Error(
      data.error ||
        "Could not fetch product from that link. Start whisper-server/start.bat and refresh cookies.txt if needed."
    );
  }

  return data.product;
}

export function importShopProductToCatalog(
  store: JsonStore,
  product: ShopProductData
): { id: string; isNew: boolean; product: ShopProductData } {
  const products = store.list<Record<string, unknown>>("products");
  const existing =
    (product.tiktok_product_id &&
      products.find((p) => p.tiktok_product_id === product.tiktok_product_id)) ||
    (product.shop_url && products.find((p) => p.shop_url === product.shop_url));

  const result = upsertCatalogProduct(
    store,
    {
      name: product.name,
      brand: product.brand,
      price: product.price,
      description: product.description,
      source: "tiktok_shop",
      image_url: product.image_url,
      shop_url: product.shop_url,
      tiktok_product_id: product.tiktok_product_id,
    },
    { id: existing ? String(existing.id) : undefined }
  );

  if (!result) throw new Error("Product name was missing from TikTok Shop page.");

  return { id: result.id, isNew: result.isNew && !existing, product };
}

export async function importProductFromShopLink(
  store: JsonStore,
  url: string
): Promise<{ id: string; isNew: boolean; product: ShopProductData }> {
  const product = await fetchShopProductFromLink(url);
  return importShopProductToCatalog(store, product);
}
