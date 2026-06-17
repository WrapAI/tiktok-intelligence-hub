# Hub data (git-synced)

This folder mirrors the TikTok Intelligence Hub runtime data so you can `git pull` on another machine and get the same library, products, sales, and dashboard state.

| Path | Contents |
|------|----------|
| `hub-data/library/` | Extension library exports (`library.json`) |
| `hub-data/personal_library.json` | Your own videos from extension (→ `my_videos` on import) |
| `hub-data/memory/` | Extension `positive_memory.json` export |
| `hub-data/products/` | Product catalog XLSX/JSON |
| `hub-data/sales-data/` | Affiliate sales CSV/XLSX |
| `hub-data/studio/` | TikTok Studio sync |
| `hub-data/compass/` | Compass sync |
| `hub-data/archive/` | Timestamped import copies |
| `database/*.json` | Parsed tables (`library_items`, `products`, `product_sales`, `my_videos`, `positive_memory`, etc.) |
| `database/settings.device.json` | Non-secret prefs (handle, agent IDs, voice ID, planner limits) — safe to commit |
| `audio/` | Generated ElevenLabs script MP3s |

**Not synced:** `settings.json` API keys — stay in `%APPDATA%` only. Paste keys in Settings on each device once.

## After git pull (second device)

```powershell
git pull
cd tiktok-intelligence-hub
npm run data:import
npm run dev
```

`data:import` copies into **all** AppData roots (production + Electron dev cache) and merges `settings.device.json` into local settings without overwriting API keys.

## Before git push (when data changed)

```powershell
npm run data:export:force
git add data/
git commit -m "Sync hub data"
git push
```

Or use `npm run data:push` to export + stage in one step.
