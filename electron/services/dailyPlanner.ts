import { randomUUID } from "node:crypto";
import type { JsonStore } from "../db.js";
import { listProductSales, type SalesRow } from "./salesImport.js";
import {
  buildFunnelKnowledge,
  funnelBucketLabel,
  pickReference,
  type FunnelBucket,
  type FunnelReference,
} from "./funnelKnowledge.js";
import { formatInspirationRules, adaptHookTextForProduct, adaptInspiredNote, adaptVisualHookForProduct, adaptVisualTactic } from "./referenceAdaptation.js";
import { callClaudeDirect } from "./claude.js";
import { mergeCosts, type AgentCostBreakdown } from "./agentPricing.js";
import { COMPLIANCE_RULES } from "./hubContextSnapshot.js";
import { buildLibraryContextBlock } from "./libraryContext.js";
import { parseDailyPlanAgentReply } from "./agentJson.js";

export const MAX_DAILY_POSTS = 30;

export type FunnelLimits = {
  top: number;
  middle: number;
  bottom: number;
};

export type ClipInstruction = {
  step: number;
  duration: string;
  whatToFilm: string;
  whatToSay: string;
  onScreenText: string;
};

export type PlanVideo = {
  id: string;
  funnel: FunnelBucket;
  funnelLabel: string;
  productName: string;
  productBrand: string;
  productId: string | null;
  salesRank: number;
  videoIndex: number;
  videoCountForProduct: number;
  title: string;
  summary: string;
  referenceLibraryId: string | null;
  hookType: string;
  funnelCategory: string;
  fullAudioScript: string;
  onScreenCaption: string;
  tiktokCaption: string;
  clips: ClipInstruction[];
};

export type DailyPlan = {
  id: string;
  planDate: string;
  limits: FunnelLimits;
  totalVideos: number;
  salesSource: string | null;
  salesPeriodDays: number;
  videos: PlanVideo[];
  createdAt: string;
  cost?: AgentCostBreakdown;
};

export type GeneratePlanRequest = {
  planDate?: string;
  limits: FunnelLimits;
  selectedProductNames?: string[];
  additionalInfo?: string;
};

function matchProductId(store: JsonStore, product: SalesRow): string | null {
  const products = store.list<{ id: string; name: string; brand?: string }>("products");
  const candidates = [product.product_name, product.full_name, product.full_name.split("|")[0].trim()].filter(Boolean);
  const keys = candidates.map((c) => c.toLowerCase());

  for (const key of keys) {
    const exact = products.find((p) => p.name.toLowerCase() === key);
    if (exact) return exact.id;
  }

  for (const key of keys) {
    const partial = products.find(
      (p) =>
        p.name.toLowerCase().includes(key.slice(0, Math.min(20, key.length))) ||
        key.includes(p.name.toLowerCase().slice(0, Math.min(20, p.name.length)))
    );
    if (partial) return partial.id;
  }

  if (product.brand) {
    const byBrand = products.find((p) => p.brand?.toLowerCase() === product.brand.toLowerCase() && p.name.length > 5);
    if (byBrand) return byBrand.id;
  }
  return null;
}

function salesRowMatchesQuery(row: SalesRow, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  return (
    row.product_name.toLowerCase().includes(q) ||
    row.full_name.toLowerCase().includes(q) ||
    q.includes(row.product_name.toLowerCase())
  );
}

function distributeCounts(total: number, weights: number[]): number[] {
  if (!total || !weights.length) return weights.map(() => 0);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (w / sum) * total);
  const counts = raw.map((v) => Math.floor(v));
  let remaining = total - counts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let n = 0; n < remaining; n++) {
    counts[order[n % order.length].i] += 1;
  }
  return counts;
}

function salesScore(row: SalesRow): number {
  return row.gmv || row.orders * 20 || row.units * 10 || row.commission * 5;
}

function buildClipList(
  bucket: FunnelBucket,
  product: SalesRow,
  ref: FunnelReference | null,
  videoIndex: number
): ClipInstruction[] {
  const productLine = product.product_name;
  const brand = product.brand ? ` (${product.brand})` : "";
  const visualHook = ref
    ? adaptVisualHookForProduct(ref.visualHook, productLine)
    : `Close-up of ${productLine} — grab attention fast`;
  const hookLine = ref
    ? adaptHookTextForProduct(ref.hookText, productLine, ref.hookType)
    : `Stop scrolling — here's why everyone's talking about this.`;
  const inspiredReason = ref
    ? adaptInspiredNote(ref.primaryReason || ref.replicationNotes, productLine)
    : "";

  if (bucket === "top") {
    return [
      {
        step: 1,
        duration: "0–3 sec",
        whatToFilm: visualHook,
        whatToSay: hookLine,
        onScreenText: "Worth knowing 👀",
      },
      {
        step: 2,
        duration: "3–15 sec",
        whatToFilm: `Show the problem this product solves. Use your face or hands on camera.`,
        whatToSay: `Explain the pain point in one sentence. Don't mention price yet.`,
        onScreenText: "",
      },
      {
        step: 3,
        duration: "15–25 sec",
        whatToFilm: `Quick demo or before/after of ${productLine}${brand}`,
        whatToSay: inspiredReason.slice(0, 140) || `This is what actually helped me.`,
        onScreenText: "",
      },
      {
        step: 4,
        duration: "25–30 sec",
        whatToFilm: `Hold product to camera, soft smile`,
        whatToSay: `Link in bio if you want to try it — no pressure.`,
        onScreenText: "Save for later ✨",
      },
    ];
  }

  if (bucket === "middle") {
    return [
      {
        step: 1,
        duration: "0–3 sec",
        whatToFilm: visualHook || `Unbox or reveal ${productLine} on camera`,
        whatToSay: hookLine || `Let me show you what this actually does.`,
        onScreenText: "Honest review",
      },
      {
        step: 2,
        duration: "3–12 sec",
        whatToFilm: `Demo ${productLine} — show texture, application, or result`,
        whatToSay: `Talk through 2–3 real benefits. Be specific.`,
        onScreenText: ref?.visualTactics[0]
          ? adaptVisualTactic(ref.visualTactics[0], productLine)
          : "",
      },
      {
        step: 3,
        duration: "12–22 sec",
        whatToFilm: `Show proof — your results, reviews on screen, or side-by-side with ${productLine}`,
        whatToSay:
          adaptInspiredNote(ref?.replicationNotes || ref?.primaryReason || "", productLine).slice(0, 140) ||
          `This is why I keep restocking it.`,
        onScreenText: "",
      },
      {
        step: 4,
        duration: "22–30 sec",
        whatToFilm: `Product + orange cart gesture`,
        whatToSay: `It's on TikTok Shop if you want to grab it.`,
        onScreenText: "Orange cart 🛒",
      },
    ];
  }

  // bottom funnel
  return [
    {
      step: 1,
      duration: "0–2 sec",
      whatToFilm: visualHook || `Slam ${productLine} on counter or hold to camera`,
      whatToSay: hookLine || `This sold out twice — here's why.`,
      onScreenText: "DEAL",
    },
    {
      step: 2,
      duration: "2–10 sec",
      whatToFilm: `Show price/value — multiple units, bundle, or sale tag`,
      whatToSay: `Stack the value. Mention savings or bundle deal.`,
      onScreenText: product.gmv ? `Top seller` : "Limited",
    },
    {
      step: 3,
      duration: "10–20 sec",
      whatToFilm: `Fast demo — 2–3 quick cuts showing it working`,
      whatToSay: inspiredReason.slice(0, 140) || `Best seller for a reason. Tap the cart.`,
      onScreenText: "",
    },
    {
      step: 4,
        duration: "20–27 sec",
      whatToFilm: `Point at orange cart / link sticker on screen`,
      whatToSay: `Don't wait — link in orange cart before it sells out again.`,
      onScreenText: "Tap orange cart",
    },
  ];
}

function buildVideoTitle(bucket: FunnelBucket, product: SalesRow, index: number): string {
  const prefix =
    bucket === "top" ? "Awareness" : bucket === "middle" ? "Demo" : "Convert";
  return `${prefix} video ${index + 1}: ${product.product_name.slice(0, 50)}`;
}

function allocateVideos(
  sales: SalesRow[],
  limits: FunnelLimits,
  selectedNames?: string[]
): { bucket: FunnelBucket; product: SalesRow; rank: number }[] {
  const filtered = selectedNames?.length
    ? sales.filter((s) => selectedNames.some((n) => salesRowMatchesQuery(s, n)))
    : sales;

  const pool = filtered.length ? filtered : sales;
  if (!pool.length) return [];

  const weights = pool.map((p) => salesScore(p));
  const bottomCounts = distributeCounts(limits.bottom, weights.slice(0, Math.min(8, pool.length)));
  const middleCounts = distributeCounts(
    limits.middle,
    weights.slice(0, Math.min(5, pool.length))
  );
  const topCounts = distributeCounts(limits.top, weights.slice().reverse().slice(0, Math.min(5, pool.length)));

  const slots: { bucket: FunnelBucket; product: SalesRow; rank: number }[] = [];

  pool.slice(0, bottomCounts.length).forEach((product, i) => {
    const count = bottomCounts[i] || 0;
    for (let v = 0; v < count; v++) {
      slots.push({ bucket: "bottom", product, rank: i + 1 });
    }
  });

  pool.slice(0, middleCounts.length).forEach((product, i) => {
    const count = middleCounts[i] || 0;
    for (let v = 0; v < count; v++) {
      slots.push({ bucket: "middle", product, rank: i + 1 });
    }
  });

  const topPool = [...pool].reverse();
  topPool.slice(0, topCounts.length).forEach((product, i) => {
    const count = topCounts[i] || 0;
    for (let v = 0; v < count; v++) {
      slots.push({ bucket: "top", product, rank: pool.indexOf(product) + 1 });
    }
  });

  return slots;
}

export function validateLimits(limits: FunnelLimits): { ok: true; total: number } | { ok: false; error: string } {
  const total = limits.top + limits.middle + limits.bottom;
  if (total > MAX_DAILY_POSTS) {
    return { ok: false, error: `Total posts (${total}) cannot exceed ${MAX_DAILY_POSTS} per day.` };
  }
  if (total < 1) {
    return { ok: false, error: "Set at least 1 post for the day." };
  }
  for (const [key, val] of Object.entries(limits)) {
    if (val < 0 || val > MAX_DAILY_POSTS) {
      return { ok: false, error: `${key} must be between 0 and ${MAX_DAILY_POSTS}.` };
    }
  }
  return { ok: true, total };
}

export function generateDailyPlan(store: JsonStore, req: GeneratePlanRequest): Promise<DailyPlan> {
  return generateDailyPlanViaAgent(store, req);
}

function buildPlanAgentContext(store: JsonStore, req: GeneratePlanRequest) {
  const sales = listProductSales(store);
  const filtered = req.selectedProductNames?.length
    ? sales.filter((s) => req.selectedProductNames!.some((n) => salesRowMatchesQuery(s, n)))
    : sales;
  const pool = filtered.length ? filtered : sales;
  const knowledge = buildFunnelKnowledge(store);

  const productLines = pool
    .slice(0, 20)
    .map(
      (s, i) =>
        `${i + 1}. ${s.product_name} — GMV £${s.gmv.toFixed(0)} · units ${s.units} · brand ${s.brand || "—"}`
    )
    .join("\n");

  return `## Plan date
${req.planDate || new Date().toISOString().slice(0, 10)}

## Funnel limits (must match exactly)
- Top funnel: ${req.limits.top} videos
- Middle funnel: ${req.limits.middle} videos
- Bottom funnel: ${req.limits.bottom} videos
- Total: ${req.limits.top + req.limits.middle + req.limits.bottom} videos (max ${MAX_DAILY_POSTS})

## Sales pool (${pool.length} products)
${productLines}

## Library references available
- Top funnel refs: ${knowledge.top.length}
- Middle funnel refs: ${knowledge.middle.length}
- Bottom funnel refs: ${knowledge.bottom.length}

## Library analyses (separated hooks from TikTok Hook Analyzer)
${buildLibraryContextBlock(store, 12)}

${formatInspirationRules()}${req.additionalInfo?.trim() ? `

## Creator notes (read carefully — apply these to today's plan)
${req.additionalInfo.trim()}` : ""}`;
}

async function generateDailyPlanViaAgent(store: JsonStore, req: GeneratePlanRequest): Promise<DailyPlan> {
  const validation = validateLimits(req.limits);
  if (!validation.ok) throw new Error(validation.error);

  const sales = listProductSales(store);
  if (!sales.length) {
    throw new Error("Import your 28-day product sales CSV or XLSX first (Dashboard or Daily Planner).");
  }

  if (!store.getSetting("anthropicApiKey")) {
    throw new Error("Add your Anthropic API key in Settings first.");
  }

  const expectedTotal = validation.total;
  const context = buildPlanAgentContext(store, req);

  const instructions = `Create a complete daily TikTok Shop filming plan for a UK affiliate creator.

All library, sales, and product data is in the context below — do NOT use bash, grep, or file tools. Reply with JSON in one turn only.

Library entries have SEPARATE fields: on-screen hook, audio hook, visual hook, caption hook, CTA, funnel category, views/likes/comments.

Rules:
- Allocate exactly ${req.limits.bottom} bottom-funnel, ${req.limits.middle} middle-funnel, and ${req.limits.top} top-funnel videos (${expectedTotal} total).
- Weight bottom-funnel toward highest GMV sellers.
- Copy hook STRUCTURE and pacing from library analyses only — never competitor products, backgrounds, or props.
- Each video needs a complete spoken voiceover script (UK English, natural TikTok cadence).
- Use correct packaging words (tub, bottle, can, bag) from /hub/products.md research when mentioning the physical product.

CRITICAL output rules:
- Return ONLY a raw JSON object — no markdown fences, no commentary before or after.
- Escape line breaks inside string values as \\n (do not use literal newlines inside JSON strings).
- The root object must have a "videos" array with exactly ${expectedTotal} item(s).

For EACH video return:
- fullAudioScript: complete word-for-word voiceover
- onScreenCaption: on-screen text overlay if needed, or empty string
- tiktokCaption: full TikTok post caption with hashtags (ready to paste)
- productName, funnelCategory (Top/Middle/Bottom Funnel label), funnel (top|middle|bottom)

Return ONLY valid JSON:
{
  "videos": [
    {
      "funnel": "bottom",
      "funnelCategory": "Bottom Funnel",
      "productName": "short name",
      "productBrand": "",
      "salesRank": 1,
      "title": "Video title",
      "summary": "one line",
      "hookType": "pattern interrupt",
      "fullAudioScript": "Full spoken script on one line with \\n for pauses",
      "onScreenCaption": "HOW IS THIS EVEN LEGAL?",
      "tiktokCaption": "Caption with hashtags #tiktokshop..."
    }
  ]
}`;

  let reply: string;
  let cost: AgentCostBreakdown | undefined;

  const planSystem = `${COMPLIANCE_RULES}

${formatInspirationRules()}`;

  const first = await callClaudeDirect(
    store,
    planSystem,
    `${instructions}\n\n---\n\n${context}`,
    { task: "generate_daily_plan", maxTokens: 16384 }
  );
  reply = first.reply;
  cost = first.cost;

  let parsed: { videos: Array<Record<string, unknown>> };
  try {
    parsed = parseDailyPlanAgentReply(reply);
  } catch {
    const retry = await callClaudeDirect(
      store,
      planSystem,
      `Your last reply was not valid JSON. Return ONLY a JSON object: {"videos":[...]} with exactly ${expectedTotal} video object(s).
No markdown, no explanation. Escape newlines in strings as \\n.
Required fields per video: funnel, funnelCategory, productName, title, fullAudioScript, onScreenCaption, tiktokCaption, hookType.

Broken reply to fix:
${reply.slice(0, 4000)}`,
      { task: "generate_daily_plan", maxTokens: 16384 }
    );
    reply = retry.reply;
    cost = cost && retry.cost ? mergeCosts(cost, retry.cost) : retry.cost || cost;
    parsed = parseDailyPlanAgentReply(reply);
  }

  if (!parsed.videos?.length) {
    throw new Error("Agent returned an empty plan — try again.");
  }

  if (parsed.videos.length !== expectedTotal) {
    throw new Error(
      `Agent returned ${parsed.videos.length} videos but you requested ${expectedTotal}. Try again or adjust limits.`
    );
  }

  const productVideoCounts = new Map<string, number>();
  for (const raw of parsed.videos) {
    const name = String(raw.productName || "");
    productVideoCounts.set(name, (productVideoCounts.get(name) || 0) + 1);
  }

  const perProductIndex = new Map<string, number>();
  const videos: PlanVideo[] = parsed.videos.map((raw) => {
    const funnel = String(raw.funnel || "middle") as FunnelBucket;
    if (!["top", "middle", "bottom"].includes(funnel)) {
      throw new Error(`Invalid funnel "${raw.funnel}" in agent plan.`);
    }

    const productName = String(raw.productName || "Unknown product");
    const productBrand = String(raw.productBrand || "");
    const videoIndex = (perProductIndex.get(productName) || 0) + 1;
    perProductIndex.set(productName, videoIndex);

    const salesRow =
      sales.find((s) => s.product_name.toLowerCase() === productName.toLowerCase()) ||
      sales.find((s) => s.full_name.toLowerCase().includes(productName.toLowerCase()));

    const fullAudioScript = String(raw.fullAudioScript || raw.audioScript || "")
      .trim()
      .replace(/\\n/g, "\n");
    if (!fullAudioScript) {
      throw new Error(`Agent plan missing fullAudioScript for ${productName}.`);
    }

    const onScreenCaption = String(raw.onScreenCaption || raw.on_screen_caption || "").trim();
    const tiktokCaption = String(raw.tiktokCaption || raw.tiktok_caption || "").trim();
    const funnelCategory =
      String(raw.funnelCategory || funnelBucketLabel(funnel)).trim();

    const clipsRaw = Array.isArray(raw.clips) ? raw.clips : [];
    const clips: ClipInstruction[] = clipsRaw.length
      ? clipsRaw.map((c, i) => ({
          step: Number((c as Record<string, unknown>).step) || i + 1,
          duration: String((c as Record<string, unknown>).duration || ""),
          whatToFilm: String((c as Record<string, unknown>).whatToFilm || ""),
          whatToSay: String((c as Record<string, unknown>).whatToSay || ""),
          onScreenText: String((c as Record<string, unknown>).onScreenText || ""),
        }))
      : [
          {
            step: 1,
            duration: "full",
            whatToFilm: `Film ${productName} — face, hands, product`,
            whatToSay: fullAudioScript,
            onScreenText: onScreenCaption,
          },
        ];

    return {
      id: randomUUID(),
      funnel,
      funnelLabel: funnelBucketLabel(funnel),
      productName,
      productBrand,
      productId: salesRow ? matchProductId(store, salesRow) : null,
      salesRank: Number(raw.salesRank) || 1,
      videoIndex,
      videoCountForProduct: productVideoCounts.get(productName) || 1,
      title: String(raw.title || buildVideoTitle(funnel, salesRow || { product_name: productName, brand: productBrand } as SalesRow, videoIndex - 1)),
      summary: String(raw.summary || ""),
      referenceLibraryId: null,
      hookType: String(raw.hookType || "pattern interrupt"),
      funnelCategory,
      fullAudioScript,
      onScreenCaption,
      tiktokCaption,
      clips,
    };
  });

  const plan: DailyPlan = {
    id: randomUUID(),
    planDate: req.planDate || new Date().toISOString().slice(0, 10),
    limits: req.limits,
    totalVideos: videos.length,
    salesSource: store.getSetting("lastSalesImportFile"),
    salesPeriodDays: Number(store.getSetting("salesPeriodDays", "28")) || 28,
    videos,
    createdAt: new Date().toISOString(),
    cost,
  };

  store.upsertById("daily_plans", {
    id: plan.id,
    plan_date: plan.planDate,
    payload_json: JSON.stringify(plan),
    total_videos: plan.totalVideos,
    created_at: plan.createdAt,
  });

  store.setSetting("plannerLimits", JSON.stringify(req.limits));
  return plan;
}

/** @deprecated Local rule-based planner — kept for tests/reference only. */
export function generateDailyPlanLocal(store: JsonStore, req: GeneratePlanRequest): DailyPlan {
  const validation = validateLimits(req.limits);
  if (!validation.ok) throw new Error(validation.error);

  const sales = listProductSales(store);
  if (!sales.length) {
    throw new Error("Import your 28-day product sales CSV or XLSX first (Dashboard or Daily Planner).");
  }

  const knowledge = buildFunnelKnowledge(store);
  const slots = allocateVideos(sales, req.limits, req.selectedProductNames);
  if (!slots.length) {
    throw new Error("Could not build a plan — check your sales import has product rows with GMV or orders.");
  }

  const productVideoCounts = new Map<string, number>();
  for (const slot of slots) {
    const key = slot.product.full_name || slot.product.product_name;
    productVideoCounts.set(key, (productVideoCounts.get(key) || 0) + 1);
  }

  const perProductIndex = new Map<string, number>();
  const refIndex: Record<FunnelBucket, number> = { top: 0, middle: 0, bottom: 0 };

  const videos: PlanVideo[] = slots.map((slot) => {
    const key = slot.product.full_name || slot.product.product_name;
    const videoIndex = perProductIndex.get(key) || 0;
    perProductIndex.set(key, videoIndex + 1);

    const ref = pickReference(knowledge, slot.bucket, refIndex[slot.bucket]++);
    const clips = buildClipList(slot.bucket, slot.product, ref, videoIndex);

    return {
      id: randomUUID(),
      funnel: slot.bucket,
      funnelLabel: funnelBucketLabel(slot.bucket),
      productName: slot.product.product_name,
      productBrand: slot.product.brand,
      productId: matchProductId(store, slot.product),
      salesRank: slot.rank,
      videoIndex: videoIndex + 1,
      videoCountForProduct: productVideoCounts.get(key) || 1,
      title: buildVideoTitle(slot.bucket, slot.product, videoIndex),
      summary:
        slot.bucket === "top"
          ? `Awareness post — introduce ${slot.product.product_name} without hard selling.`
          : slot.bucket === "middle"
            ? `Trust-building demo — show how ${slot.product.product_name} works, soft shop CTA.`
            : `Conversion post — push ${slot.product.product_name} with urgency and orange cart CTA.`,
      referenceLibraryId: ref?.libraryId || null,
      hookType: ref?.hookType || "pattern interrupt",
      funnelCategory: funnelBucketLabel(slot.bucket),
      fullAudioScript: clips.map((c) => c.whatToSay).filter(Boolean).join(" "),
      onScreenCaption: clips.map((c) => c.onScreenText).find(Boolean) || "",
      tiktokCaption: "",
      clips,
    };
  });

  const plan: DailyPlan = {
    id: randomUUID(),
    planDate: req.planDate || new Date().toISOString().slice(0, 10),
    limits: req.limits,
    totalVideos: videos.length,
    salesSource: store.getSetting("lastSalesImportFile"),
    salesPeriodDays: Number(store.getSetting("salesPeriodDays", "28")) || 28,
    videos,
    createdAt: new Date().toISOString(),
  };

  store.upsertById("daily_plans", {
    id: plan.id,
    plan_date: plan.planDate,
    payload_json: JSON.stringify(plan),
    total_videos: plan.totalVideos,
    created_at: plan.createdAt,
  });

  store.setSetting("plannerLimits", JSON.stringify(req.limits));

  return plan;
}

export function listDailyPlans(store: JsonStore): Array<{ id: string; planDate: string; totalVideos: number; createdAt: string }> {
  return store
    .list<{ id: string; plan_date: string; total_videos: number; created_at: string }>("daily_plans")
    .map((row) => ({
      id: row.id,
      planDate: row.plan_date,
      totalVideos: row.total_videos,
      createdAt: row.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getDailyPlan(store: JsonStore, id: string): DailyPlan | null {
  const row = store.list<{ id: string; payload_json: string }>("daily_plans").find((r) => r.id === id);
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as DailyPlan;
  } catch {
    return null;
  }
}

export function getDefaultLimits(store: JsonStore): FunnelLimits {
  const raw = store.getSetting("plannerLimits", "");
  if (raw) {
    try {
      return JSON.parse(raw) as FunnelLimits;
    } catch {
      // fall through
    }
  }
  return { top: 5, middle: 5, bottom: 20 };
}

export function getPlannerSummary(store: JsonStore) {
  const sales = listProductSales(store);
  const knowledge = buildFunnelKnowledge(store);
  return {
    salesCount: sales.length,
    lastSalesImport: store.getSetting("lastSalesImportAt"),
    lastSalesFile: store.getSetting("lastSalesImportFile"),
    salesPeriodDays: Number(store.getSetting("salesPeriodDays", "28")) || 28,
    topProducts: sales.slice(0, 10).map((s, i) => ({
      rank: i + 1,
      name: s.product_name,
      fullName: s.full_name,
      brand: s.brand,
      gmv: s.gmv,
      orders: s.orders,
      units: s.units,
    })),
    funnelLibraryCounts: {
      top: knowledge.top.length,
      middle: knowledge.middle.length,
      bottom: knowledge.bottom.length,
    },
    defaultLimits: getDefaultLimits(store),
    maxDailyPosts: MAX_DAILY_POSTS,
  };
}
