import type { JsonStore } from "../db.js";
import { callClaudeDirect } from "./claude.js";
import { guessPackagingFromName, PACKAGING_KNOWLEDGE } from "./productPackaging.js";

export type ProductResearchStatus = "pending" | "researching" | "complete" | "error" | "skipped";

export type ProductResearch = {
  packaging_type: string;
  container_nouns: string[];
  category: string;
  research_notes: string;
  researched_at: string;
};

function parseResearchJson(raw: string): Partial<ProductResearch> {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/i);
  const text = fenced ? fenced[1] : raw;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1)) as Partial<ProductResearch>;
  } catch {
    return {};
  }
}

export function productNeedsResearch(product: Record<string, unknown>): boolean {
  if (product.research_completed_at) return false;
  if (product.research_status === "skipped") return false;
  if (product.source === "library") return false;
  return true;
}

const researchInFlight = new Set<string>();

function setProductResearchStatus(
  store: JsonStore,
  productId: string,
  status: ProductResearchStatus,
  error = ""
) {
  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === productId);
  if (!product) return;

  store.upsertById("products", {
    ...product,
    id: productId,
    research_status: status,
    research_error: error,
    updated_at: new Date().toISOString(),
  } as Record<string, unknown> & { id: string });
}

function saveProductResearch(
  store: JsonStore,
  product: Record<string, unknown>,
  productId: string,
  research: ProductResearch
) {
  store.upsertById("products", {
    ...product,
    id: productId,
    packaging_type: research.packaging_type,
    container_nouns: JSON.stringify(research.container_nouns),
    product_category: research.category,
    research_notes: research.research_notes,
    research_completed_at: research.researched_at,
    research_status: "complete",
    research_error: "",
    updated_at: research.researched_at,
  } as Record<string, unknown> & { id: string });
}

/** Apply name-based packaging guess locally — no API call. */
export function applyHeuristicProductPackaging(store: JsonStore, productId: string): ProductResearch | null {
  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === productId);
  if (!product || product.research_completed_at) return null;

  const guess = guessPackagingFromName(String(product.name || ""), String(product.description || ""));
  const researched_at = new Date().toISOString();
  const research: ProductResearch = {
    packaging_type: guess.packaging_type,
    container_nouns: guess.container_nouns,
    category: "general",
    research_notes: "",
    researched_at,
  };

  saveProductResearch(store, product, productId, research);
  return research;
}

/** User-triggered deep research via direct Claude API (not managed agent). */
export async function researchProduct(store: JsonStore, productId: string): Promise<ProductResearch | null> {
  if (!store.getSetting("anthropicApiKey")) {
    setProductResearchStatus(store, productId, "error", "Add your Anthropic API key in Settings first.");
    return null;
  }

  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === productId);
  if (!product || !productNeedsResearch(product)) return null;

  setProductResearchStatus(store, productId, "researching");

  const guess = guessPackagingFromName(String(product.name || ""), String(product.description || ""));

  const system = `You research TikTok Shop products for script writing. Return JSON only.

${PACKAGING_KNOWLEDGE}`;

  const user = `Product name: ${product.name}
Brand: ${product.brand || "—"}
Price: ${product.price || "—"}
Description: ${product.description || "—"}
Heuristic guess: ${guess.packaging_type} (${guess.container_nouns.join(", ")})

Return JSON:
{
  "packaging_type": "tub|bottle|can|bag|jar|tube|pouch|sachet|pack|box|container",
  "container_nouns": ["tub", "scoop"],
  "category": "electrolytes|hair|skincare|snacks|etc",
  "research_notes": "2-4 sentences: what it is, how it's packaged, how UK creators describe holding/showing it on camera"
}`;

  try {
    const reply = await callClaudeDirect(store, system, user, undefined, "product_research");
    const parsed = parseResearchJson(reply);
    const researched_at = new Date().toISOString();

    const research: ProductResearch = {
      packaging_type: String(parsed.packaging_type || guess.packaging_type),
      container_nouns: Array.isArray(parsed.container_nouns)
        ? (parsed.container_nouns as string[]).map(String).filter(Boolean)
        : guess.container_nouns,
      category: String(parsed.category || "general"),
      research_notes: String(parsed.research_notes || "").trim(),
      researched_at,
    };

    saveProductResearch(store, product, productId, research);
    store.appendLog("product_research", "ok", `Researched ${product.name}`);
    return research;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setProductResearchStatus(store, productId, "error", msg);
    store.appendLog("product_research", "error", msg);
    return null;
  }
}

/** User-triggered only (Products page retry). Never call from import/sync paths. */
export function scheduleProductResearch(store: JsonStore, productId: string) {
  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === productId);
  if (!product || product.research_completed_at || !productNeedsResearch(product)) return;
  if (researchInFlight.has(productId)) return;

  researchInFlight.add(productId);
  setProductResearchStatus(store, productId, "pending");

  void researchProduct(store, productId).finally(() => {
    researchInFlight.delete(productId);
  });
}

export function retryProductResearch(store: JsonStore, productId: string) {
  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === productId);
  if (!product || product.research_completed_at) return;

  store.upsertById("products", {
    ...product,
    id: productId,
    research_status: "pending",
    research_error: "",
    research_completed_at: "",
    updated_at: new Date().toISOString(),
  } as Record<string, unknown> & { id: string });

  scheduleProductResearch(store, productId);
}

/** One-time local backfill — no API. Clears pending/researching products left from old auto-research loop. */
export function backfillHeuristicPackagingForAllPendingProducts(store: JsonStore): number {
  let count = 0;
  for (const product of store.list<Record<string, unknown>>("products")) {
    if (!productNeedsResearch(product)) continue;
    if (applyHeuristicProductPackaging(store, String(product.id))) count += 1;
  }
  return count;
}

export function getProductResearchContext(store: JsonStore, productId: string): string {
  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === productId);
  if (!product) return "";
  const nouns = product.container_nouns;
  let nounList: string[] = [];
  if (typeof nouns === "string") {
    try {
      nounList = JSON.parse(nouns) as string[];
    } catch {
      nounList = [];
    }
  } else if (Array.isArray(nouns)) {
    nounList = nouns as string[];
  }

  const lines = [
    `Packaging type: ${product.packaging_type || guessPackagingFromName(String(product.name || "")).packaging_type}`,
    nounList.length ? `Container words to use: ${nounList.join(", ")}` : "",
    product.research_notes ? `Research: ${product.research_notes}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}
