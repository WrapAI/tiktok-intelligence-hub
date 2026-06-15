import type { JsonStore } from "../db.js";
import { getDataLayoutSummary } from "./dataFolders.js";
import { getPlannerSummary } from "./dailyPlanner.js";
import { buildFunnelKnowledge } from "./funnelKnowledge.js";
import { buildLibraryInsights } from "./libraryPerformance.js";
import { buildMemorySummary } from "./memoryInsights.js";
import { listProductSales } from "./salesImport.js";
import { formatInspirationRules } from "./referenceAdaptation.js";

export type HubMemoryDocument = {
  path: string;
  content: string;
};

const MAX_DOC_CHARS = 95_000;

function clip(text: string, max = MAX_DOC_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…(truncated)`;
}

function buildSkillMarkdown(): string {
  return clip(`# TikTok Intelligence Hub — Agent Base Skill

You assist a UK TikTok Shop affiliate creator using the **TikTok Intelligence Hub** desktop app (Electron + Claude).

## App purpose

- Import and store competitor video analyses from the **TikTok Hook Analyzer** Chrome extension
- Track **products**, **28-day sales**, **positive memory** (what worked on their account), Studio/Compass syncs
- **Daily Planner**: funnel post mix (top/middle/bottom, max 30/day) + shot lists per product
- **Script Writer**: voiceover scripts + ElevenLabs SSML from library performance stats

## Critical rules (always follow)

${formatInspirationRules()}

## Product naming

Sales imports use **short script-friendly names** (e.g. "EHPlabs Hydreau") while keeping full TikTok titles in \`full_name\`. Never confuse competitor library products with the creator's products to sell.

## Data folders (imports)

- \`library/\` — analysed competitor videos
- \`memory/\` — creator win-rate memory
- \`products/\` — TikTok Shop catalog exports
- \`sales-data/\` — Creator Product List / affiliate sales
- \`studio/\`, \`compass/\` — extension sync exports
- \`archive/\` — timestamped import history

## Funnel definitions

- **Top funnel**: awareness, hook only, soft CTA
- **Middle funnel**: demo + trust, honest review energy
- **Bottom funnel**: conversion, urgency, orange cart

## When answering

1. Read \`/hub/*.md\` in the attached memory store for current counts and top sellers
2. Recommend actions using **their products and sales**, not products from analysed competitor videos
3. Prefer concrete filming steps (Film / Say / On-screen text) over generic advice
4. Reference library patterns as **style inspiration** only
`);
}

export function buildHubMemoryDocuments(store: JsonStore, dataDir: string, dbDir: string): HubMemoryDocument[] {
  const memory = buildMemorySummary(store);
  const library = buildLibraryInsights(store, 15);
  const sales = listProductSales(store);
  const planner = getPlannerSummary(store);
  const funnel = buildFunnelKnowledge(store);
  const layout = getDataLayoutSummary(dataDir, dbDir, store.list("import_history").length);
  const products = store.list<{ name: string; brand?: string; price?: string; description?: string }>("products");

  const overview = clip(`# Hub overview (${new Date().toISOString()})

## Counts
- Library videos: ${store.list("library_items").length}
- Positive memory: ${memory.totalMemoryEntries}
- Products: ${products.length}
- Sales rows (28d): ${sales.length}
- Scripts saved: ${store.list("scripts").length}
- Import history entries: ${layout.importHistoryCount}
- Archived files: ${layout.archiveCount}

## Creator performance memory
- Avg rating: ${memory.avgRating.toFixed(1)}/5
- Avg views on copies: ${Math.round(memory.avgMyViews).toLocaleString()}
- Avg GMV on copies: £${memory.avgMyGmv.toFixed(2)}

## Last sales import
- File: ${planner.lastSalesFile || "—"}
- Period days: ${planner.salesPeriodDays}
`);

  const productsDoc = clip(`# Products (${products.length})

${products
  .slice(0, 80)
  .map((p, i) => `${i + 1}. **${p.name}**${p.brand ? ` (${p.brand})` : ""}${p.price ? ` · ${p.price}` : ""}`)
  .join("\n")}
`);

  const salesDoc = clip(`# Sales — top sellers (${sales.length} with sales in period)

${sales
  .slice(0, 40)
  .map(
    (s, i) =>
      `${i + 1}. **${s.product_name}** — GMV £${s.gmv.toFixed(0)} · units ${s.units} · commission £${s.commission.toFixed(0)}` +
      (s.full_name !== s.product_name ? `\n   Full: ${s.full_name.slice(0, 120)}` : "")
  )
  .join("\n\n")}
`);

  const libraryDoc = clip(`# Library — top analysed videos

${library
  .slice(0, 12)
  .map(
    (v, i) =>
      `${i + 1}. ${v.hookType} · ${v.funnelCategory || "—"} · ${v.views.toLocaleString()} views\n` +
      `   Hook: ${v.hookText.slice(0, 100)}\n` +
      `   Visual: ${v.visualHook.slice(0, 120)}\n` +
      `   Why: ${(v.primaryReason || v.replicationNotes).slice(0, 140)}`
  )
  .join("\n\n")}

## Funnel library counts
- Top: ${funnel.top.length}
- Middle: ${funnel.middle.length}
- Bottom: ${funnel.bottom.length}
`);

  const performanceDoc = clip(`# Creator positive memory

${memory.topPatterns
  .slice(0, 15)
  .map(
    (p, i) =>
      `${i + 1}. [${p.source}] "${p.hook.slice(0, 80)}"` +
      (p.whatWorked ? `\n   Tactic: ${p.whatWorked.slice(0, 120)}` : "") +
      (p.myGmv ? `\n   GMV £${p.myGmv}` : "") +
      (p.rating ? `\n   Rating ${p.rating}/5` : "")
  )
  .join("\n\n")}

## Hook type wins
${Object.entries(memory.hookTypeWins)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}
`);

  const plannerDoc = clip(`# Daily planner defaults

- Max posts/day: ${planner.maxDailyPosts}
- Default mix: top ${planner.defaultLimits.top} · middle ${planner.defaultLimits.middle} · bottom ${planner.defaultLimits.bottom}

## Top products in planner
${planner.topProducts
  .map((p) => `- #${p.rank} ${p.name} — GMV £${p.gmv.toFixed(0)}`)
  .join("\n")}

${formatInspirationRules()}
`);

  const layoutDoc = clip(`# Data folder layout

Root: ${layout.root}
Database: ${layout.database}

${layout.folders.map((f) => `- **${f.label}** (\`${f.path.split(/[/\\]/).pop()}/\`) — ${f.fileCount} files`).join("\n")}
`);

  return [
    { path: "/hub/SKILL.md", content: buildSkillMarkdown() },
    { path: "/hub/overview.md", content: overview },
    { path: "/hub/products.md", content: productsDoc },
    { path: "/hub/sales.md", content: salesDoc },
    { path: "/hub/library.md", content: libraryDoc },
    { path: "/hub/performance_memory.md", content: performanceDoc },
    { path: "/hub/planner_rules.md", content: plannerDoc },
    { path: "/hub/data_layout.md", content: layoutDoc },
  ];
}

export function buildHubContextBundle(store: JsonStore, dataDir: string, dbDir: string): string {
  return buildHubMemoryDocuments(store, dataDir, dbDir)
    .map((doc) => `# ${doc.path}\n\n${doc.content}`)
    .join("\n\n---\n\n");
}
