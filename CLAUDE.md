# TikTikAssistant — Full Project Reference

This monorepo contains two connected projects that form a single TikTok affiliate creator intelligence system.

---

## Monorepo Structure

```
TikTikAssistant/
├── tiktok-hook-analyzer/        Chrome Extension (Vanilla JS, MV3)
├── tiktok-intelligence-hub/     Electron Desktop App (React / TypeScript / Vite)
└── tiktok.code-workspace        Open both in Cursor at once
```

Open `tiktok.code-workspace` to get both folders active in one Cursor session.

---

## System Overview

```
TikTok (browser)
    │
    ▼
Chrome Extension (tiktok-hook-analyzer)
    │  scrapes DOM, captures frame, calls Grok for video analysis
    │  stores analyses in chrome.storage.local
    │  exports: library.json, positive_memory.json, personal_library.json
    │
    ▼
Whisper Server (localhost:5050, shared)
    │  Flask server — audio transcription (yt-dlp + Whisper)
    │  also proxies Grok video uploads and extension sync requests
    │
    ▼
Electron Hub (tiktok-intelligence-hub)
    │  imports JSON/XLSX from extension or TikTok Shop
    │  stores in local JSON database (%APPDATA%/tiktok-intelligence-hub/)
    │  syncs to Claude managed-agent memory store (/hub/*.md)
    │
    ▼
Claude (Anthropic) — two paths
    │  DIRECT API (Script Writer) — full prompt built locally, no memory store read
    │  MANAGED AGENT (Daily Planner, Agent Chat) — reads /hub/*.md memory documents
```

### End-to-end data flow

1. **Browse TikTok** → extension analyses competitor videos on demand (Grok vision) → saves to local library.
2. **Export** → `library.json`, `positive_memory.json`, `personal_library.json` dropped into hub `hub-data/` (or auto-sync via whisper server).
3. **Hub imports** → JSON/XLSX parsed into `%APPDATA%/tiktok-intelligence-hub/database/*.json`.
4. **Script Writer** → reads database locally, builds one big prompt, calls Claude **direct API** → saves script + optional ElevenLabs MP3.
5. **Send to Google Drive** → MP3→MP4 via whisper server → uploads to `Root / YYYY-MM-DD / Product/` on Drive.
6. **Memory sync** (silent) → hub snapshots written to `/hub/*.md` for the managed agent (Daily Planner, Agent chat) — Script Writer does **not** depend on this sync.

---

## Project 1 — TikTok Hook Analyzer (Chrome Extension)

### Purpose
Sits as a sidebar on TikTok while the user browses. On demand, analyses competitor/trending videos for hooks, CTAs, visual tactics, funnel category, and engagement data. Builds a swipe-file library over time.

### Tech Stack
- Manifest V3 Chrome Extension, Vanilla JS — no frameworks
- `chrome.sidePanel` API — persistent sidebar on tiktok.com
- `content.js` — injected into TikTok DOM, scrapes caption/description/stats
- **Grok API** (`grok-4.3`) — primary video analysis engine (vision model, video upload)
- **Claude API** (`claude-sonnet-4-6`) — fallback analysis and frame-only analysis
- `chrome.storage.local` — analysis library, personal library, performance data
- `chrome.storage.sync` — API keys from settings page

### Key Files
| File | Role |
|------|------|
| `manifest.json` | MV3 permissions, sidepanel registration |
| `sidepanel.html` | UI shell — tabs: Analyze, Scan, Dash, Library, Memory, Perf |
| `sidepanel.js` | Main sidebar logic — analyze, render, save, library, performance |
| `sidepanel.css` | Dark theme (#0a0a0a bg, #fe2c55 red accents, white text) |
| `analysis-core.js` | All analysis logic — Grok/Claude prompts, video upload, funnel classification, hook separation |
| `content.js` | DOM scraper — captions, stats, description, hashtags, URL |
| `background.js` | Service worker — tab capture, frame grabbing |
| `export-data.js` | Exports: library.json, positive_memory.json, personal_library.json |
| `options.html/js` | Settings page — API key input, handle config |
| `library-store.js` | chrome.storage.local wrapper for the analysis library |
| `performance-store.js` | Stores + retrieves user's own video performance vs competitor benchmarks |
| `positive-memory-store.js` | Positive memory entries (what worked on user's account) |
| `profile-scan.js` | Auto-scan a competitor profile — batch analyze videos |
| `compass-scraper.js` | Scrapes TikTok Affiliate Compass data |
| `studio-scraper.js` | Scrapes TikTok Studio analytics |
| `dashboard.js` | Dashboard tab — summary stats of library |
| `my-performance.js` | Perf tab — compares user's video performance vs studied competitors |
| `whisper-server/server.py` | Flask local server on port 5050 |

### Analysis Pipeline (per video)
1. `content.js` scrapes: URL, description, hashtags, captions, DOM stats
2. Background captures current frame as base64
3. If Grok key present: whisper-server downloads video → uploads to Grok Files API → `buildGrokVideoPrompt()` sent with MP4
4. Grok returns full JSON: hooks (on-screen/audio/visual/caption separated), timeline, CTA, funnel category, stats, why-it-worked, pacing
5. If no Grok key: Claude analyses frame + captions only
6. Result rendered in sidebar, user clicks "Save to Library" or "Save to Personal Library" (own videos)

### Funnel Classification (Grok)
Defined in `analysis-core.js → formatFunnelClassificationBlock()`. Five categories with explicit TikTok Shop definitions + real examples. Injected into every Grok prompt — Grok must not guess from generic marketing knowledge.

```
Top Funnel        — awareness, hook only, no hard sell
Top/Mid Funnel    — curiosity/education, light product mention
Middle Funnel     — demo + trust, honest review, moderate CTA
Middle/Bottom     — strong proof, offer tease, approaching hard sell
Bottom Funnel     — orange cart, bundle deal, urgency, direct buy push
```

### Personal Library (own videos — @vexcile_)
When the extension detects the creator's own handle, a red "⭐ Save to Personal Library" button appears. Saves analysis to `chrome.storage.local → personalLibrary` with `pending_hub_review: true` and `null` placeholders for GMV, commission, sales, watch time, audience split. Exported as `personal_library.json` → imported into hub's `my_videos` table.

### Audio Transcription (Whisper Server)
- Layer 1: TikTok DOM captions (free, ~80% coverage)
- Layer 2: `POST http://localhost:5050/transcribe` — downloads audio via yt-dlp, transcribes with OpenAI Whisper (base model), returns transcript
- Server health shown as green/grey dot in sidebar

### Sidebar Tabs
| Tab | Content |
|-----|---------|
| Analyze | Main analysis — button, results cards (hooks, message, tactics, CTA, timeline, why-it-worked) |
| Scan | Batch profile scanner — auto-browse competitor accounts |
| Dash | Library summary stats |
| Library | All saved analyses — expandable cards |
| Memory | Positive memory — what worked on user's own account |
| Perf | Performance comparison — user's stats vs competitor benchmarks |

---

## Project 2 — TikTok Intelligence Hub (Electron App)

### Purpose
Desktop companion app. Imports extension exports, builds a product/sales knowledge base, and uses a Claude managed agent to write scripts and generate daily filming plans.

### Tech Stack
- Electron 34, React, TypeScript, Vite
- `electron/main.ts` — IPC handlers, background startup, all hub:* channels
- `electron/preload.ts` — exposes `window.hub.*` to renderer
- `electron/db.ts` — `JsonStore` — simple JSON file-based database
- Claude Managed Agent API (Anthropic) — `claude-sonnet-4-6`
- ElevenLabs API — text-to-speech for scripts
- Grok API — video analysis in My Videos feature

### Key Files
| File | Role |
|------|------|
| `electron/main.ts` | All IPC handlers — 50+ `hub:*` channels |
| `electron/preload.ts` | Bridges `window.hub.*` to IPC |
| `electron/db.ts` | JsonStore class + all table definitions |
| `electron/services/scriptWriter.ts` | Script generation via Claude **direct API** + `validateScript()` |
| `electron/services/scriptSystemPrompt.ts` | **Full Script Writer system prompt** — compliance, hook/repetition rules, banned example, SSML skeleton |
| `electron/services/scriptFeedback.ts` | Section ratings → prompt + `/hub/script_feedback.md` |
| `electron/services/creatorGuidance.ts` | Rules/ideas from Agent tab → prompt + `/hub/creator-guidance.md` |
| `electron/services/scriptVariety.ts` | Weighted hook/pacing rotation + anti-repetition block |
| `electron/services/pendingAnalysis.ts` | Post-upload workflow — TikTok URL → stats → finalize |
| `electron/services/googleDrive.ts` | OAuth, daily date folders, voiceover upload |
| `electron/services/dailyPlanner.ts` | Daily plan generation via Claude agent |
| `electron/services/tiktokAgent.ts` | Agent session management, memory sync/pull |
| `electron/services/hubContextSnapshot.ts` | Builds /hub/*.md documents for memory store |
| `electron/services/importService.ts` | All file import logic (JSON, XLSX, CSV) |
| `electron/services/myVideoAnalysis.ts` | Grok video analysis for My Videos |
| `electron/services/funnelKnowledge.ts` | Library funnel grouping and reference builder |
| `electron/services/productResearch.ts` | One-time Claude product packaging research |
| `electron/services/elevenlabs.ts` | Text-to-speech synthesis |
| `electron/services/agentPricing.ts` | Cost estimation for agent actions |
| `electron/services/agentBridge.ts` | Auto-sync to memory store (silent, no agent messages) |
| `src/pages/PendingAnalysis.tsx` | Post-film analysis queue |
| `src/pages/ScriptWriter.tsx` | Script Writer UI |
| `src/pages/DailyPlanner.tsx` | Daily Planner UI |
| `src/pages/MyVideos.tsx` | My Videos — import + Grok analysis + scoring |
| `src/pages/TikTokAgent.tsx` | Agent chat + session management |
| `src/pages/Dashboard.tsx` | Import files, data summary |
| `src/pages/Products.tsx` | Product catalog |
| `src/pages/Settings.tsx` | All API keys |
| `src/hub.d.ts` | Full TypeScript types for window.hub.* |

### Database Tables (JsonStore — JSON files in %APPDATA%)
| Table | Contents |
|-------|----------|
| `settings` | API keys, agent IDs — never committed |
| `products` | Product catalog from imports |
| `library_items` | Competitor video analyses from extension |
| `positive_memory` | Creator's own win-rate memory entries |
| `product_sales` | 28-day sales data from TikTok Shop XLSX |
| `daily_plans` | Generated daily filming plans |
| `scripts` | Generated scripts + SSML |
| `studio_snapshots` | TikTok Studio analytics syncs |
| `compass_snapshots` | Affiliate Compass syncs |
| `my_videos` | Creator's own videos with Grok analysis + performance scores |
| `sync_log` | Import/sync event log |
| `import_history` | File import audit trail |
| `pending_analysis` | Voiceovers uploaded to Drive awaiting TikTok URL + performance |
| `pending_dismissals` | Durable deletes from pending queue |
| `creator_guidance` | Rules & ideas from TikTok Agent tab |
| `video_outcomes` | Finalized pending analysis performance records |
| `predictions` | (reserved) |

### Data Folder Layout (%APPDATA%/tiktok-intelligence-hub/)
```
hub-data/
├── library/          library.json from extension
├── memory/           positive_memory.json
├── products/         products.json or XLSX
├── sales-data/       Creator Product List XLSX / affiliate CSV
├── studio/           my_studio_data.json
├── compass/          my_compass_data.json
├── inbox/            unclassified drops
└── archive/          timestamped copy of every import

database/
├── settings.json     API keys — gitignored
├── library_items.json
├── products.json
└── ...               all other tables
```

### Claude Managed Agent
- Agent ID: `agent_01NxQdQvuQLXgJgMgXbQ1LNz`
- Default Environment ID: `env_0139W3beYzg2rMpMX18KQ69M`
- Default Memory Store ID: `memstore_01Vp97M6cAtSRivSiWnGsL67`
- Session ID: stored in settings, refreshed when expired

Memory documents synced to `/hub/` path in the memory store:
| Path | Content |
|------|---------|
| `/hub/context.md` | Hub system context, product catalog, sales rankings |
| `/hub/library.md` | Top library analyses — hooks, funnel, tactics |
| `/hub/products.md` | Full product list with packaging research |
| `/hub/my_videos.md` | Creator's own video performance data |
| `/hub/creator-guidance.md` | Rules & ideas from TikTok Agent tab |
| `/hub/script_feedback.md` | Script section ratings (liked/disliked/notes) |
| `/hub/compliance.md` | Absolute script rules + violation risks |
| `/hub/raw/_index.json` | Raw JSON chunks for full data recovery |

**Auto-sync**: Any import silently syncs memory documents within ~2s. Does NOT send agent messages (prevents session spam).

### Script Writer
1. User selects product, optional pacing reference, duration, optional "Additional information"
2. User clicks **Generate script** → IPC `hub:generate-script` → `generateScript()` in `scriptWriter.ts`
3. Hub reads **local JSON database** (not the managed agent memory store) and assembles prompt blocks
4. Calls **`callClaudeDirect()`** in `claude.ts` — model `claude-sonnet-4-6`, `max_tokens: 4096`
5. Parses JSON response → saves to `scripts` table with `section_feedback: {}`, `awaiting_feedback: true`
6. Optional ElevenLabs auto-generates MP3 → `ScriptTitle_YYYY-MM-DD.mp3`
7. User rates sections → stored in `scripts.json` → injected into **next** script's system prompt
8. **Send to Google Drive** → requires today's date folder → creates product subfolder on upload

See **[Script Writer — Claude API prompt](#script-writer--claude-api-prompt)** below for the exact request shape.

### Daily Planner
Uses the **managed agent** (`requestAgentTask`) — reads synced `/hub/*.md` memory.
1. Import 28-day sales XLSX from TikTok Shop / Affiliate Centre
2. Set funnel limits (top/middle/bottom, total ≤ 30)
3. Tick focus products
4. Optionally fill "Additional information" (filming constraints for today)
5. Agent generates full filming plan: `clips[]` per video, full audio script, on-screen caption, TikTok caption
6. Plan displayed grouped by funnel, expandable per video

### My Videos Feature
Creator imports their own videos (URL or via extension). Fields:
- Auto-pulled: views, likes, comments
- Manual: watch time %, sales, GMV, commission, audience split %, upload date
- Grok analysis (via whisper-server): transcript, onscreen hook, timeline, CTA timestamps, video structure
- Score calculated: weighted combination of sales conversion, watch time, engagement, commission

Extension flow: analyse own `@vexcile_` video → "Save to Personal Library" → `personal_library.json` export → Hub import → appears in My Videos with red "needs review" banner until performance fields filled.

---

## Shared: Whisper Server

**Location:** `tiktok-hook-analyzer/whisper-server/`  
**Port:** 5050  
**Start:** double-click `start.bat` or `python server.py`

| Endpoint | Used By | Purpose |
|----------|---------|---------|
| `POST /transcribe` | Extension | Download audio, Whisper transcription |
| `GET /health` | Extension + Hub | Status check |
| `POST /config` | Hub | Register hub data folder path |
| `POST /sync-request` | Hub | Request extension Studio/Compass scrape |
| `POST /analyse-video` | Hub (My Videos) | Download + proxy video to Grok |

---

## API Keys Used

| Key | Stored In | Purpose |
|-----|-----------|---------|
| Anthropic API key | Hub Settings + chrome.storage.sync | Claude analysis (extension) + agent (hub) |
| Grok / xAI API key | Hub Settings + chrome.storage.sync | Video analysis (extension + hub) |
| ElevenLabs API key | Hub Settings | Script audio generation |
| ElevenLabs Voice ID | Hub Settings | Which voice to use |

**NEVER hardcode any key.** Always read from storage at call time.

---

## Compliance Rules (ABSOLUTE — always apply)

Stored in `hubContextSnapshot.ts → COMPLIANCE_RULES` and synced to `/hub/compliance.md`.

### Never do:
- Make health claims or describe bodily effects (instant ban risk)
  - WildGut Capsules — name only, NEVER describe what they do
  - Careleaf Gummies — name each individually, NEVER describe effects
- Invent stock levels or countdown timers
- Name competitors negatively
- Fabricate price claims

### Script structure (always follow):
1. Hook — max **7 words** (countdown hooks starting with "Not" exempt); pattern interrupt only
2. Relatable Mistake — personal confession viewer recognises; product name once, pronouns after
3. Discount Reveal + Urgency — honest urgency only; discount phrase once only
4. Product Details — full proper names, always "the [Product Name]"
5. CTA — exactly: *"I don't know how long this deal is gonna last but I've left the link in the yellow basket below."*

**Repetition bans:** no dramatic stutter ("Every. Single. Time."), no filler restatement ("I had to say that out loud…"), no repeating product name more than twice, no duplicate 4+ word phrases.

Full rules + banned output example live in `electron/services/scriptSystemPrompt.ts` (Script Writer) and `COMPLIANCE_RULES` in `hubContextSnapshot.ts` (synced to `/hub/compliance.md` for Daily Planner / agent).

---

---

## Script Writer — Claude API prompt

Script Writer does **not** use the managed agent. All context is assembled in `electron/services/scriptWriter.ts` and sent in one shot via `callClaudeDirect()` (`electron/services/claude.ts`).

### Call site

```typescript
// scriptWriter.ts
const raw = await callClaudeDirect(
  store,
  system,                                          // → API `system` param
  `${instructions}\n\n---\n\n${context}`,          // → API messages[0].content
  undefined,                                       // model default: claude-sonnet-4-6
  "generate_script",
  { skipDuplicateCheck, skipDirectApiLimit }
);

// claude.ts
await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  system,
  messages: [{ role: "user", content: user }],
});
```

Guardrails run first via `assertAgentCallAllowed(store, "direct_api", …)` — hourly/daily caps, payload size, duplicate detection.

### What gets built (in order)

| Piece | Source function | Goes into |
|-------|-----------------|-----------|
| Full system prompt | `buildScriptWriterSystemPrompt(store)` in `scriptSystemPrompt.ts` | **system** |
| — compliance + hook/repetition rules | inline in `scriptSystemPrompt.ts` | **system** |
| — creator rules & ideas | `formatCreatorGuidanceRulesInject()` ← `creator_guidance.json` | **system** |
| — disliked / keep feedback | `formatDislikedFeedbackInject()` + `formatKeepNotesInject()` ← `scripts.json` | **system** |
| Library performance stats | `formatLibraryPerformanceForPrompt()` | **user** (context) |
| Library hook examples | `buildLibraryContextBlock()` | **user** |
| Pacing reference SSML/transcript | `formatPacingBlock()` | **user** |
| Variety assignment | `buildVarietyDirectiveBlock()` + `SCRIPT_VARIETY_INSTRUCTIONS` | **user** |
| Product + packaging + research | product row + `formatProductPackagingForPrompt()` | **user** |
| Per-script notes | `req.additionalInfo` from UI textarea | **user** |

**Priority (mandated in system prompt):** Compliance → creator rules & disliked feedback → section notes → variety rotation → library/pacing.

### Data files that feed the prompt

| Data | Path | Used for |
|------|------|----------|
| Creator rules/ideas | `database/creator_guidance.json` | System — TikTok Agent → Add rule / Add idea |
| Section feedback | `database/scripts.json` → `section_feedback` | System — Script Writer like/dislike buttons |
| Library analyses | `database/library_items.json` | User context — performance + hook examples |
| Products | `database/products.json` | User context — product block + packaging |
| Positive memory | `database/positive_memory.json` | User context — via memory summary in performance block |
| Recent scripts | `database/scripts.json` (same product) | User context — variety anti-repetition |

Memory sync to `/hub/*.md` is for the **managed agent** (Daily Planner, chat). Script Writer reads the JSON files directly at generate time.

---

### Example API request (exact shape)

Below is a **representative** request as sent to `POST https://api.anthropic.com/v1/messages`. Compliance and library blocks are abbreviated; real requests are ~15–30k chars.

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 4096,
  "system": "# TikTok Shop Affiliate — Compliance & Script Rules\n\nThese rules are ABSOLUTE...\n\n[full COMPLIANCE_RULES from hubContextSnapshot.ts]\n\n# CREATOR MANDATES (highest priority after compliance)\n\n## CREATOR RULES & IDEAS — MANDATORY\n\nSaved by the creator in TikTok Agent. Rules MUST be followed on every script.\nIf library stats, pacing reference, or variety assignment conflict with a rule, the rule wins.\n\n### Rules (always follow — non-negotiable)\n\n- Never say anything is free or \"basically free\"\n- Do not use the same on-screen caption in consecutive videos...\n- never reuse the same script - word for word...\n\n## SCRIPT SECTION FEEDBACK — MANDATORY\n\nCreator ratings from Script Writer. These override library patterns and variety suggestions.\n\n### NEVER repeat (disliked — highest priority)\n\n- **Audio script** (WildGut Bottom Funnel): Said \"basically free\" — never use free language\n  Was: \"This is basically free on the TikTok shop right now...\"\n\n### Techniques that worked (vary execution — do not copy verbatim)\n\n- **On-screen caption** (Hydreau Curiosity Gap): HOW IS THIS LEGAL\n\nPriority when writing this script:\n1. Compliance rules (above)\n2. Creator rules & disliked script feedback\n3. Section notes (keep with notes)\n4. Variety rotation for this script\n5. Library performance & pacing reference\n\n[inspiration rules from referenceAdaptation.ts]\n\n[PACKAGING_KNOWLEDGE from productPackaging.ts]",
  "messages": [
    {
      "role": "user",
      "content": "You are an expert TikTok Shop affiliate scriptwriter for UK creators.\n\nVariety rules (apply only where they do NOT conflict with creator rules or disliked script feedback above):\n- Performance data guides WHICH families work — rotate hook types...\n- Never produce the same \"don't buy this\" / bundle / countdown script with swapped product words.\n\nRules:\n- Do NOT use bash, grep, or file tools — all context is in this message. Reply with JSON in one turn only.\n- Creator rules and disliked feedback in the system prompt are mandatory — they override library hooks and variety assignment.\n- Read library stats and SEPARATED hooks (on-screen, audio, visual) — adapt structure only.\n- Mirror top-performing speaking PACE in SSML (breaks, prosody) from reference pacing data.\n- Use correct container nouns (tub, bottle, can, bag) for this product when showing/holding it.\n- Never copy competitor products, backgrounds, or props from library videos.\n\nReturn JSON only:\n{\n  \"title\": \"Script title\",\n  \"fullAudioScript\": \"Complete spoken voiceover word-for-word\",\n  \"ssml\": \"<speak>...ElevenLabs SSML with <break time=\\\"300ms\\\"/> pacing from top performers...</speak>\",\n  \"onScreenCaption\": \"On-screen text overlay for the video (or empty string)\",\n  \"tiktokCaption\": \"Full TikTok post caption with hashtags, ready to paste\"\n}\n\n---\n\n## Library performance data (use this to decide structure — do NOT ask the creator to pick a hook type)\n\n### Hook types ranked by total engagement in library\n1. **curiosity gap** — 42 videos · avg 85.2K views...\n\n**Assigned hook approach for this script:** \"curiosity gap\" — performance-weighted pick with rotation (not always #1).\n\n[library context — top 5 competitor analyses with separated hooks]\n\n## Reference video pacing (match speaking SPEED and rhythm — same beat structure, not same words or products)\nReference hook studied for structure only: \"DON'T BUY THIS\"\n### Timestamp pacing from winning video\n[0.0s] Don't buy this...\n### Reference SSML break pattern\n<speak><prosody rate=\"medium\">Don't buy this<break time=\"400ms\"/>...\n\n## THIS SCRIPT — variety assignment (mandatory)\n\n**Hook approach for this script:** \"curiosity gap\" (picked from 6 performance-weighted options — not always the #1 stat).\n\n### Do NOT repeat from recent scripts for this product\n**Recent audio openings (do not echo):**\n1. \"Stop scrolling if you've been paying full price for...\"\n\n## Product to sell\n- Name: WildGut Colon Reset\n- Brand: WildGut\n- Price: £24.99\n- Notes: —\n- Container: tub · show/hold the tub\n\n## Target length\n~45 seconds at the same speaking pace as the reference video.\n\n## Creator notes (read carefully — apply these to this script)\nno face on camera, bottom funnel style"
    }
  ]
}
```

### Example response (expected JSON in assistant message)

```json
{
  "title": "WildGut Colon Reset Curiosity Gap Hook No Face Bottom Funnel",
  "fullAudioScript": "Don't buy the WildGut Colon Reset tub from TikTok Shop until you've seen this deal...",
  "ssml": "<speak><prosody rate=\"medium\">Don't buy the WildGut Colon Reset tub<break time=\"400ms\"/>from TikTok Shop until you've seen this deal...</speak>",
  "onScreenCaption": "DON'T BUY THIS (until you see the deal)",
  "tiktokCaption": "WildGut Colon Reset on TikTok Shop #tiktokshop #wildgut"
}
```

Parsed by `parseScriptResponse()` in `scriptWriter.ts` → **`validateScript()`** runs before save. If violations found, script is returned with `validationBlocked: true` (preview only — not saved to `scripts.json`, no ElevenLabs, no Drive upload).

### Script validation (`validateScript` in `scriptWriter.ts`)

Runs on generate, manual edit save, ElevenLabs generate, and Google Drive upload.

| Check | Rule |
|-------|------|
| Banned phrases | `BANNED_PHRASES` list — free language, health claims, stutter/filler phrases |
| Hook length | First sentence max 7 words (countdown hooks starting with "not" exempt) |
| Product name | Full product name mentioned >2 times |
| Phrase duplication | Same 4-word sequence appearing twice |
| "don't buy this" | More than once in script |

Pass `productName` from `products.json` for product repetition check.

---

### curl equivalent (for manual testing)

```bash
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 4096,
    "system": "...",
    "messages": [{"role": "user", "content": "...instructions...\n\n---\n\n...context..."}]
  }'
```

---

## Session log (recent)

- **Jun 27 2026** — TikTok Shop product import (`/shop-product` + My Products UI); Pending Analysis performance form (GMV, watch time, audience); Script Writer loop fixes (context trim, dual-call revoke, bypass duplicate+API, generation nonce); `npm run data:export` backs up database + audio to repo
- **Jun 21 2026** — Validation auto-lessons (`validation_lessons.json`); API bypass checkbox + spend-cap skip; validator rejects don't count toward hourly limit
- **Jun 20 2026** — Dedicated `scriptSystemPrompt.ts`; hook max 7 words + repetition rules (rules 12–13); Umberto Giannini banned-output example; `validateScript()` blocks save/audio/Drive; `COMPLIANCE_RULES` updated; commits `11aef33`, `28e5c8b`, `c25c63a`
- **Jun 18 2026** — Script variety rotation; creator rules + section feedback moved to system prompt; Google Drive daily date folders; Pending Analysis tab; API limit bypass on Script Writer
- **Jun 16 2026** — Script section feedback; creator guidance (Agent rules/ideas); force sync bypass
- Product research loop — 608 library products marked "Competitor/skipped", banner cleared on restart
- Additional information field — Script Writer + Daily Planner (optional textarea, injected into Claude prompt)
- Grok funnel classification — explicit definitions + real examples injected into every Grok prompt via `formatFunnelClassificationBlock()`
- My Videos — `↓ Sync from extension` button + auto-import on page open
- UI fix — textarea overflow on Additional information fields (box-sizing: border-box)
- Pricing estimates — tightened token counts for script (~$0.05-0.07), plan (~$0.19-0.36), chat (~$0.015)
- CLAUDE.md + Cursor rules — full project reference, low-cost agent rules, project conventions
- `settings.example.json` — all 20+ keys documented
- Grok Collections — decided NOT to use; prompt enrichment is sufficient for funnel accuracy
- Personal library extension flow: `@vexcile_` detected → red "⭐ Save to Personal Library" button → POSTs to whisper server → written to hub data folder → imported into My Videos with red "needs review" banner

---

## Development

### Running the Hub
```powershell
cd tiktok-intelligence-hub
npm install          # first time only
npm run dev          # starts Vite + Electron
```

### Running the Whisper Server
```powershell
cd tiktok-hook-analyzer/whisper-server
# double-click start.bat  OR:
pip install -r requirements.txt
python server.py
```

### Loading the Extension
1. Chrome → `chrome://extensions` → Developer mode ON
2. "Load unpacked" → select `tiktok-hook-analyzer/` folder
3. Open TikTok, click extension icon, add API keys in Settings

### Git / Data Sync
```powershell
# Export hub data before pushing
cd tiktok-intelligence-hub
npm run data:export

# After pulling
npm run data:import
npm run dev
```

---

## Key Constraints

- **No auto API calls** — every analysis fires only on explicit user click
- **No frameworks in extension** — Vanilla JS only, keep bundle small
- **Product research is one-time** — products tagged `library` source are never auto-researched
- **Agent sessions are precious** — never send `sendAgentMessage` from background sync tasks (causes session proliferation)
- **ElevenLabs audio filenames** — human-readable: `ScriptTitle_YYYY-MM-DD.mp3`
- **Funnel classification** — always use explicit definitions from `formatFunnelClassificationBlock()`, not Grok's default marketing knowledge
- **`settings.json` is always gitignored** — contains API keys
