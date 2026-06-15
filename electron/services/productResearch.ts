import type { JsonStore } from "../db.js";
import { requestAgentTask } from "./tiktokAgent.js";
import { guessPackagingFromName, PACKAGING_KNOWLEDGE } from "./productPackaging.js";

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
  return !product.research_completed_at;
}

export async function researchProduct(store: JsonStore, productId: string): Promise<ProductResearch | null> {
  if (!store.getSetting("anthropicApiKey")) return null;

  const product = store.list<Record<string, unknown>>("products").find((p) => p.id === productId);
  if (!product || !productNeedsResearch(product)) return null;

  const guess = guessPackagingFromName(String(product.name || ""), String(product.description || ""));

  const instructions = `Research this TikTok Shop product for script writing. One-time product profile.

${PACKAGING_KNOWLEDGE}

Return JSON only:
{
  "packaging_type": "tub|bottle|can|bag|jar|tube|pouch|sachet|pack|box|container",
  "container_nouns": ["tub", "scoop"],
  "category": "electrolytes|hair|skincare|snacks|etc",
  "research_notes": "2-4 sentences: what it is, how it's packaged, how UK creators describe holding/showing it on camera"
}`;

  const context = `Product name: ${product.name}
Brand: ${product.brand || "—"}
Price: ${product.price || "—"}
Description: ${product.description || "—"}
Heuristic guess: ${guess.packaging_type} (${guess.container_nouns.join(", ")})`;

  try {
    const { reply } = await requestAgentTask(store, "analyze_data", instructions, context, 120_000);
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

    store.upsertById("products", {
      ...product,
      id: productId,
      packaging_type: research.packaging_type,
      container_nouns: JSON.stringify(research.container_nouns),
      product_category: research.category,
      research_notes: research.research_notes,
      research_completed_at: researched_at,
      updated_at: researched_at,
    } as Record<string, unknown> & { id: string });

    store.appendLog("product_research", "ok", `Researched ${product.name}`);
    return research;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.appendLog("product_research", "error", msg);
    return null;
  }
}

/** Fire-and-forget research for new products. */
export function scheduleProductResearch(store: JsonStore, productId: string) {
  void researchProduct(store, productId);
}

export function scheduleResearchForNewProducts(store: JsonStore, productIds: string[]) {
  for (const id of productIds) {
    const p = store.list<Record<string, unknown>>("products").find((row) => row.id === id);
    if (p && productNeedsResearch(p)) scheduleProductResearch(store, id);
  }
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
