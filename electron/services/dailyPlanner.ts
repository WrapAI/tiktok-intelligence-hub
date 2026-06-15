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
};

export type GeneratePlanRequest = {
  planDate?: string;
  limits: FunnelLimits;
  selectedProductNames?: string[];
};

function matchProductId(store: JsonStore, salesName: string, brand: string): string | null {
  const products = store.list<{ id: string; name: string; brand?: string }>("products");
  const key = salesName.toLowerCase();
  const exact = products.find((p) => p.name.toLowerCase() === key);
  if (exact) return exact.id;
  const partial = products.find(
    (p) => p.name.toLowerCase().includes(key.slice(0, 20)) || key.includes(p.name.toLowerCase().slice(0, 20))
  );
  if (partial) return partial.id;
  if (brand) {
    const byBrand = products.find((p) => p.brand?.toLowerCase() === brand.toLowerCase() && p.name.length > 5);
    if (byBrand) return byBrand.id;
  }
  return null;
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

  if (bucket === "top") {
    return [
      {
        step: 1,
        duration: "0–3 sec",
        whatToFilm: ref?.visualHook || `Close-up of ${productLine} — grab attention fast`,
        whatToSay: ref?.hookText || `Stop scrolling — here's why everyone's talking about this.`,
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
        whatToSay: ref?.primaryReason.slice(0, 120) || `This is what actually helped me.`,
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
        whatToFilm: ref?.visualHook || `Unbox or reveal ${productLine} on camera`,
        whatToSay: ref?.hookText || `Let me show you what this actually does.`,
        onScreenText: "Honest review",
      },
      {
        step: 2,
        duration: "3–12 sec",
        whatToFilm: `Demo the product — show texture, application, or result`,
        whatToSay: `Talk through 2–3 real benefits. Be specific.`,
        onScreenText: ref?.visualTactics[0]?.slice(0, 40) || "",
      },
      {
        step: 3,
        duration: "12–22 sec",
        whatToFilm: `Show proof — your results, reviews on screen, or side-by-side`,
        whatToSay: ref?.replicationNotes.slice(0, 140) || `This is why I keep restocking it.`,
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
      whatToFilm: ref?.visualHook || `Slam ${productLine} on counter or hold to camera`,
      whatToSay: ref?.hookText || `This sold out twice — here's why.`,
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
      whatToSay: ref?.primaryReason.slice(0, 120) || `Best seller for a reason. Tap the cart.`,
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
    ? sales.filter((s) => selectedNames.some((n) => s.product_name.toLowerCase().includes(n.toLowerCase())))
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

export function generateDailyPlan(store: JsonStore, req: GeneratePlanRequest): DailyPlan {
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
    const key = slot.product.product_name;
    productVideoCounts.set(key, (productVideoCounts.get(key) || 0) + 1);
  }

  const perProductIndex = new Map<string, number>();
  const refIndex: Record<FunnelBucket, number> = { top: 0, middle: 0, bottom: 0 };

  const videos: PlanVideo[] = slots.map((slot) => {
    const key = slot.product.product_name;
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
      productId: matchProductId(store, slot.product.product_name, slot.product.brand),
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
