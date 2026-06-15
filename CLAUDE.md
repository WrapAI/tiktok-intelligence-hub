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
Claude Managed Agent (Anthropic)
    │  reads /hub/*.md memory documents
    │  powers: Script Writer, Daily Planner, Agent Chat
```

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
| `electron/services/scriptWriter.ts` | Script generation via Claude agent |
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
| `/hub/compliance.md` | Absolute script rules + violation risks |
| `/hub/raw/_index.json` | Raw JSON chunks for full data recovery |

**Auto-sync**: Any import silently syncs memory documents within ~2s. Does NOT send agent messages (prevents session spam).

### Script Writer
1. User searches product catalog, selects product
2. Optionally picks pacing reference video from library
3. Optionally fills "Additional information" field (constraints, specifics)
4. Calls `requestAgentTask("generate_script", instructions, context)`
5. Claude reads memory store + context block → returns JSON with `fullAudioScript`, `ssml`, `onScreenCaption`, `tiktokCaption`
6. If ElevenLabs key configured → auto-generates MP3 with human-readable filename

### Daily Planner
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
1. Hook — "Don't Buy This" or counting hook
2. Relatable Mistake — personal confession viewer recognises
3. Discount Reveal + Urgency — honest urgency only
4. Product Details — full proper names, always "the [Product Name]"
5. CTA — exactly: *"I don't know how long this deal is gonna last but I've left the link in the yellow basket below."*

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
