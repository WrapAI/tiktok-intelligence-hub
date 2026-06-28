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
import { formatCreatorGuidanceMarkdown } from "./creatorGuidance.js";
import { formatScriptFeedbackForPrompt, formatValidationLessonsInject } from "./scriptFeedback.js";

export { buildScriptWriterSystemPrompt } from "./scriptSystemPrompt.js";

export type HubMemoryDocument = {
  path: string;
  content: string;
};

const MAX_DOC_CHARS = 95_000;

export const COMPLIANCE_RULES = `# TikTok Shop Affiliate — Compliance & Script Rules

These rules are ABSOLUTE. Apply them to every script, daily plan, and content suggestion. Violations risk account bans.

---

## VIOLATIONS — NEVER DO THESE

### Health & Body Claims (Instant Ban Risk)
- NEVER make promises about bodily function or health outcomes
- NEVER say what a product does to the body (e.g. "helps digestion", "boosts energy", "improves sleep")
- NEVER use medical or quasi-medical language
- WildGut Capsules — NEVER describe what they do to the body. Name only: "the WildGut Capsules"
- Careleaf Gummies — NEVER describe effects. Name only: "the Collagen Gummies", "the Beetroot Gummies", "the Good Sleep Gummies"

### Fake Urgency / Misleading Claims
- NEVER invent stock levels or countdown timers unless confirmed
- NEVER claim a price is limited if you don't know it is
- Use "I don't know how long this deal is gonna last" — this is honest urgency, not fabricated

### Competitor Misrepresentation
- NEVER name a competitor product negatively
- NEVER make direct price comparisons that could be inaccurate

---

## SCRIPT STRUCTURE (always follow)

1. **HOOK** — Don't Buy This OR Not 1 Not 2 counting hook
2. **RELATABLE MISTAKE** — personal confession the viewer recognises in themselves
3. **DISCOUNT REVEAL + URGENCY** — TikTok Shop deal, honest urgency
4. **PRODUCT DETAILS** — full proper names, never shortened
5. **CTA** — always exactly: "I don't know how long this deal is gonna last but I've left the link in the yellow basket below."

---

## PRODUCT NAMING RULES

- Always say "the" before a product name
- Always use the FULL proper product name — never shorten
- WildGut → always "the WildGut Capsules"
- Careleaf → always name each individually: "the Collagen Gummies", "the Beetroot Gummies", "the Good Sleep Gummies"

---

## HOOK RULES

### Don't Buy This
- Say ONCE only: "Don't buy the [Full Product Name]."
- Then STOP — never reveal why in the same line
- Curiosity gap — viewer thinks "wait, why?"

### Not 1, Not 2, Not X, But X (Ragebait)
- Count UP to the total number of items
- Repeat the SAME number after "but" — that's the ragebait
- e.g. 3 items = "Not 1, Not 2, Not 3, But 3"

### Hook length
- Maximum 7 words. Minimum 1 word. Count before writing — length kills the pattern interrupt
- GOOD: "Stop." / "Don't buy this." / "I can't believe this." / "There is no way this is legal." / "Do not waste your money."
- BAD: "Don't buy the Umberto Giannini Curl Jelly Kit until you've seen this deal" — too long
- Countdown hooks (Not 1, Not 2...) are the only exception — repetition IS the retention mechanic

### Repetition
- Never repeat the same word, phrase, or product name more than once unless it is the CTA line
- Product name: say once in full, use pronouns ("it", "this", "the kit", "the bundle") after
- Price or discount: mention once only
- No dramatic stutter ("Every. Single. Time.") or filler restatement
- Restating the same fact two ways — pick one, cut the other

---

## BANNED PHRASES

- "not a single [x] — not yet" — retired, never use
- Any bodily function claim or health outcome promise
- Describing WildGut's purpose or mechanism
- Revealing the "why" of Don't Buy This in the same line as the hook
- Repeating "don't buy" more than once in the hook
- Hook longer than 7 words (countdown hooks starting with "Not" exempt)
- Repeating product name more than twice — use pronouns after first mention
- Repeating any 4+ word phrase twice in the same script
- "I had to say that out loud because I could not believe it" — filler restatement, banned
- Shortened or half-formed product names

### Banned output example — repetition (never reproduce)

Original (REJECTED): Opens with product value instead of a hook. "Umberto Giannini" ×4, "for more than half price" ×2, "Every. Single. Time." stutter, filler "I had to say that out loud because I could not believe it."

Corrected: LINE 1 hook max 7 words → "Over eighty pounds. More than half price." → relatable mistake with product name once → discount reveal with "the full kit" → product details with pronouns → standard CTA.

---

## SAFE DISCOUNT LANGUAGE

Triple discount · Half price · Third of the price · Flash sale · For basically nothing · 2 for the price of 1 · Massive discount · Slashed the price

---

## CTA — EXACT LINE ALWAYS

"I don't know how long this deal is gonna last but I've left the link in the yellow basket below."
`;


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

## Compliance

\`/hub/compliance.md\` contains ABSOLUTE script rules and TikTok Shop violation risks. Read it before every script, plan, or content suggestion. Health claims = account ban. Never skip this file.
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

  const myVideos = store.list<Record<string, unknown>>("my_videos")
    .filter((v) => v.analysis_status === "complete")
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));

  const myVideosDoc = clip(`# My Videos — performance library (${myVideos.length} analysed)

Scored videos from the creator's own TikTok account. Use these to learn what hook types, structures, and CTAs convert for THIS creator.

${myVideos.slice(0, 20).map((v, i) => {
    const a = v.analysis as Record<string, unknown> | null;
    return `## ${i + 1}. Score ${v.score ?? "—"}/100 · ${String(v.upload_date || "").slice(0, 10)}
- Views: ${v.views ?? "—"} · Likes: ${v.likes ?? "—"} · Watch time: ${v.watch_time_pct ?? "—"}%
- GMV: £${v.gmv ?? "—"} · Commission: £${v.commission ?? "—"} · Sales: ${v.sales ?? "—"} units
- Audience: ${v.audience_male_pct ?? "—"}% M / ${v.audience_female_pct ?? "—"}% F
${a ? `- Hook type: ${a.hook_type ?? "—"} · Funnel: ${a.funnel_category ?? "—"}
- Onscreen hook: ${String(a.onscreen_hook || "—").slice(0, 100)}
- Analysis: ${String(a.detailed_analysis || "").slice(0, 200)}` : "- Not yet analysed"}`;
  }).join("\n\n")}
`);

  const agentRulesDoc = `# Agent Behaviour Rules

These rules govern how this agent operates. Follow them on every task.

## Cost & session safety

- NEVER call sendAgentMessage or create a new session from background or automatic tasks — only respond when the user explicitly sends a message or triggers a script/plan
- NEVER auto-research products in bulk. Product packaging research runs ONE TIME per product, only when that product is first used in a script. Do not loop or retry unless the user asks.
- NEVER trigger repeated API calls in response to data imports or syncs. Memory store updates are handled silently by the hub — you do not need to acknowledge them.
- If you are asked to do something that would create many API calls in a loop, refuse and explain why.

## What triggers a valid task

Valid user-triggered tasks:
- Generate a script (Script Writer)
- Generate a daily plan (Daily Planner)
- User sends a message in Agent Chat
- User explicitly requests product research
- User explicitly requests a memory sync

NOT valid triggers (do not act on these):
- A product being imported or updated
- A library file being imported
- A sales file being imported
- Any background startup event

## Session management

- One session is reused across all tasks. Do not create a new session unless the user resets it in Settings.
- The session ID is managed by the hub — never suggest creating a new session unless the current one has expired.

## Response style

- Be direct and practical — the user is a TikTok affiliate creator, not a developer
- Always follow /hub/compliance.md rules before generating any script or content idea
- Use data from /hub/sales.md and /hub/products.md when recommending products — never invent figures
- Keep responses concise unless a detailed plan or script is requested
`;

  return [
    { path: "/hub/SKILL.md", content: buildSkillMarkdown() },
    { path: "/hub/compliance.md", content: COMPLIANCE_RULES },
    { path: "/hub/agent-rules.md", content: agentRulesDoc },
    { path: "/hub/creator-guidance.md", content: formatCreatorGuidanceMarkdown(store) },
    {
      path: "/hub/script_feedback.md",
      content: (() => {
        const rated = formatScriptFeedbackForPrompt(store);
        const lessons = formatValidationLessonsInject(store);
        const parts: string[] = [];
        if (rated) parts.push(rated);
        if (!lessons.startsWith("(No auto-rejected")) {
          parts.push(`## Auto-learned validation rejections\n\n${lessons}`);
        }
        return parts.join("\n\n") || "# Script section feedback\n\nNo section ratings yet.";
      })(),
    },
    { path: "/hub/overview.md", content: overview },
    { path: "/hub/products.md", content: productsDoc },
    { path: "/hub/sales.md", content: salesDoc },
    { path: "/hub/library.md", content: libraryDoc },
    { path: "/hub/performance_memory.md", content: performanceDoc },
    { path: "/hub/planner_rules.md", content: plannerDoc },
    { path: "/hub/data_layout.md", content: layoutDoc },
    { path: "/hub/import_history.md", content: importDoc },
    { path: "/hub/analytics.md", content: analyticsDoc },
    { path: "/hub/my_videos.md", content: myVideosDoc },
  ];
}

export function buildHubContextBundle(store: JsonStore, dataDir: string, dbDir: string): string {
  return buildHubMemoryDocuments(store, dataDir, dbDir)
    .map((doc) => `# ${doc.path}\n\n${doc.content}`)
    .join("\n\n---\n\n");
}

const RAW_SYNC_TABLES = [
  "library_items",
  "products",
  "positive_memory",
  "product_sales",
  "scripts",
  "creator_guidance",
  "daily_plans",
  "my_videos",
] as const;

const MAX_RAW_CHARS = 90_000;

export function buildRawDataDocuments(store: JsonStore): HubMemoryDocument[] {
  const docs: HubMemoryDocument[] = [];

  for (const table of RAW_SYNC_TABLES) {
    const rows = store.list<unknown>(table);
    if (!rows.length) continue;

    const json = JSON.stringify(rows);
    if (json.length <= MAX_RAW_CHARS) {
      docs.push({ path: `/hub/raw/${table}.json`, content: json });
    } else {
      let chunk: unknown[] = [];
      let chunkStr = "[]";
      let chunkIdx = 0;

      for (const row of rows) {
        const candidate = [...chunk, row];
        const candidateStr = JSON.stringify(candidate);
        if (candidateStr.length > MAX_RAW_CHARS && chunk.length > 0) {
          docs.push({ path: `/hub/raw/${table}_${chunkIdx}.json`, content: chunkStr });
          chunkIdx++;
          chunk = [row];
          chunkStr = JSON.stringify(chunk);
        } else {
          chunk = candidate;
          chunkStr = candidateStr;
        }
      }
      if (chunk.length) {
        docs.push({
          path: chunkIdx === 0 ? `/hub/raw/${table}.json` : `/hub/raw/${table}_${chunkIdx}.json`,
          content: chunkStr,
        });
      }
    }
  }

  const index = RAW_SYNC_TABLES.map((t) => ({
    table: t,
    paths: docs.filter((d) => d.path.includes(`/${t}`)).map((d) => d.path),
  }));
  docs.unshift({ path: "/hub/raw/_index.json", content: JSON.stringify(index) });

  return docs;
}
