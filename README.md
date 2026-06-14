# TikTok Intelligence Hub

Desktop companion for the **TikTok Hook Analyzer** Chrome extension.

## What it does

- **Database** for extension exports (`library.json`, `positive_memory.json`, Studio, Compass)
- **Script Writer** — Claude generates voiceover scripts by **hook type** + product, using all your winning memory (no manual inspiration notes)
- **Sync** — requests Studio/Compass scrape via whisper-server + extension polling
- **Products** — from extension JSON, TikTok Shop/Affiliate **XLSX** exports, or library analyses

## Setup

```bash
cd C:\Users\liamb\Projects\tiktok-intelligence-hub
npm install
npm run dev
```

1. Open **Settings** → add Anthropic API key (`sk-ant-...`)
2. **Dashboard** → Import **JSON / XLSX** (extension exports or TikTok Shop spreadsheets)
3. **My Products** — auto-filled from imports
4. **Script Writer** → Pick hook type (from memory) + search product → Generate

## Extension sync

Requires `whisper-server` from TikTikAnalyzer running on port 5050 and the Chrome extension loaded.

Hub registers its data folder with `POST http://localhost:5050/config`. Sync requests go to `/sync-request`; extension polls every 10s.

## Data folder

Default: `%APPDATA%/tiktok-intelligence-hub/hub-data/`

Place extension JSON exports or TikTok `.xlsx` product exports here, or use **Import JSON / XLSX**.

## Troubleshooting

**App won't open / `Network service crashed` in terminal**

This usually means stale Electron processes are fighting over the same cache (common after stopping `npm run dev` mid-run).

1. Open Task Manager → end every **Electron** process
2. Start again:

```powershell
cd C:\Users\liamb\Projects\tiktok-intelligence-hub
npm.cmd run dev
```

The hub now uses a single-instance lock and opens the window before background imports run.

## Stack

Electron 34 · Vite · React · TypeScript · JSON store · Claude API
