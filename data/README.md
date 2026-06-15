# Hub data (git-synced)

This folder mirrors the TikTok Intelligence Hub runtime data so you can `git pull` on another machine and get the same library, products, sales, and dashboard state.

| Path | Contents |
|------|----------|
| `hub-data/library/` | Extension library exports (`library.json`) |
| `hub-data/products/` | Product catalog XLSX/JSON |
| `hub-data/sales-data/` | Affiliate sales CSV/XLSX |
| `hub-data/studio/` | TikTok Studio sync |
| `hub-data/compass/` | Compass sync |
| `hub-data/archive/` | Timestamped import copies |
| `database/*.json` | Parsed tables (`library_items`, `products`, `product_sales`, etc.) |

**Not synced:** `settings.json` (API keys stay in `%APPDATA%/tiktok-intelligence-hub/database/` only).

## After git pull

```powershell
npm run data:import
npm run dev
```

## Before git push (when data changed)

```powershell
npm run data:export
git add data/
git commit -m "Sync hub data"
```
