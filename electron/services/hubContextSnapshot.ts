import type { JsonStore } from "../db.js";
import { getDataLayoutSummary } from "./dataFolders.js";
import { getPlannerSummary } from "./dailyPlanner.js";
import { buildFunnelKnowledge } from "./funnelKnowledge.js";
import { buildLibraryInsights } from "./libraryPerformance.js";
import { buildMemorySummary } from "./memoryInsights.js";
import { listProductSales } from "./salesImport.js";
import { formatInspirationRules } from "./referenceAdaptation.js";
import { buildLibraryContextBlock } from "./libraryContext.js";
import { PACKAGING_KNOWLEDGE } from "./productPackaging.js";

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
- **Script Writer**: voiceover scripts + ElevenLabs MP3 + on-screen & TikTok captions
- **Library analyses** (from TikTok Hook Analyzer): each video has SEPARATE fields — \`hooks.on_screen_text\`, \`hooks.audio_spoken\`, \`hooks.visual_action\`, \`hooks.caption_text\`, \`cta\`, \`timeline\`, \`duration_seconds\`, views/likes/comments/saves

${PACKAGING_KNOWLEDGE}

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

## Auto-sync

The hub app automatically syncs all new data to this memory store when:
- Library.json / competitor analyses are imported
- Sales CSV/XLSX is imported
- Product catalog updates
- Positive memory (what worked on their account)
- Studio or Compass analytics syncs
- Scripts or daily plans are generated
- Products are edited manually

Always treat \`/hub/*.md\` as the live source of truth.
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

  const productsList = store.list<Record<string, unknown>>("products");
  const productsDoc = clip(`# Products (${productsList.length})

${productsList
  .slice(0, 80)
  .map((p, i) => {
    let nouns = "";
    try {
      const parsed = JSON.parse(String(p.container_nouns || "[]")) as string[];
      if (parsed.length) nouns = ` · containers: ${parsed.join(", ")}`;
    } catch {
      /* skip */
    }
    return `${i + 1}. **${p.name}**${p.brand ? ` (${p.brand})` : ""}${p.price ? ` · ${p.price}` : ""}${p.packaging_type ? ` · ${p.packaging_type}` : ""}${nouns}${p.research_notes ? `\n   Research: ${String(p.research_notes).slice(0, 120)}` : ""}`;
  })
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

  const libraryDoc = clip(`# Library — analysed competitor videos (separated hooks)

Each entry from TikTok Hook Analyzer has distinct on-screen, audio, visual, and caption hooks plus CTA and stats.

${buildLibraryContextBlock(store, 20)}

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

  const importHistory = store
    .list<{
      category: string;
      file_name: string;
      import_type: string;
      record_count: number;
      imported_at: string;
    }>("import_history")
    .sort((a, b) => b.imported_at.localeCompare(a.imported_at))
    .slice(0, 30);

  const importDoc = clip(`# Import history (recent)

${importHistory.length ? importHistory.map((row, i) => `${i + 1}. **${row.category}** · ${row.file_name} · ${row.record_count} rows · ${row.imported_at.slice(0, 10)}`).join("\n") : "No imports yet."}
`);

  const studioSnaps = store.list<{ synced_at: string; imported_at: string; payload_json: string }>("studio_snapshots");
  const compassSnaps = store.list<{ synced_at: string; imported_at: string; payload_json: string }>("compass_snapshots");
  studioSnaps.sort((a, b) => b.imported_at.localeCompare(a.imported_at));
  compassSnaps.sort((a, b) => b.imported_at.localeCompare(a.imported_at));

  function summarizeStudioPayload(raw: string): string {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const videos = Array.isArray(data.videos) ? data.videos.length : 0;
      return `${videos || data.totalVideos || 0} videos`;
    } catch {
      return "snapshot";
    }
  }

  function summarizeCompassPayload(raw: string): string {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const gmv = data.gmv ?? (data.overview as Record<string, unknown> | undefined)?.gmv;
      return gmv != null ? `GMV ${gmv}` : "metrics snapshot";
    } catch {
      return "snapshot";
    }
  }

  const analyticsDoc = clip(`# Video performance & analytics

## TikTok Studio (latest)
${studioSnaps[0] ? `- Synced: ${studioSnaps[0].synced_at || studioSnaps[0].imported_at}\n- Data: ${summarizeStudioPayload(studioSnaps[0].payload_json)}` : "No Studio sync yet — use Dashboard → Request sync."}

## TikTok Compass (latest)
${compassSnaps[0] ? `- Synced: ${compassSnaps[0].synced_at || compassSnaps[0].imported_at}\n- Data: ${summarizeCompassPayload(compassSnaps[0].payload_json)}` : "No Compass sync yet — use Dashboard → Request sync."}

## Saved scripts
- Total: ${store.list("scripts").length}
- Latest: ${store.list<{ created_at: string; title?: string }>("scripts").sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.title || "—"}

## Daily plans saved
- Total: ${store.list("daily_plans").length}
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
    { path: "/hub/import_history.md", content: importDoc },
    { path: "/hub/analytics.md", content: analyticsDoc },
  ];
}

export function buildHubContextBundle(store: JsonStore, dataDir: string, dbDir: string): string {
  return buildHubMemoryDocuments(store, dataDir, dbDir)
    .map((doc) => `# ${doc.path}\n\n${doc.content}`)
    .join("\n\n---\n\n");
}
