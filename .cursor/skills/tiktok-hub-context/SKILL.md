---
name: tiktok-hub-context
description: >-
  Base knowledge for the TikTok Intelligence Hub Claude agent. Use when planning
  TikTok Shop content, scripts, daily posts, product strategy, or interpreting
  library/sales/memory data from the hub. Triggers: TikTok agent, hub context,
  daily planner, script writer, affiliate sales, library analyses, funnel posts.
---

# TikTok Intelligence Hub — Agent Context

Read `/hub/*.md` in the attached memory store before answering. Those files are synced automatically from the hub app whenever library, sales, products, memory, Studio/Compass, scripts, or plans change (~2s debounce).

## App purpose

Desktop companion (**TikTok Intelligence Hub**) for UK TikTok Shop affiliates:

- **Library** — competitor video analyses from TikTok Hook Analyzer extension
- **Positive memory** — creator's own wins (rating, views, GMV, what they took)
- **Products** — TikTok Shop catalog + extracted products from library
- **Sales data** — 28-day Creator Product List (short names + full titles)
- **Daily Planner** — funnel mix (top/middle/bottom, max 30/day) + shot lists
- **Script Writer** — Claude scripts + ElevenLabs SSML from library stats

## Critical rules

Analysed videos are **competitor content for inspiration only**.

COPY: hook structure, tone, pacing, visual technique, funnel approach.

NEVER tell the creator to:
- Use products from analysed videos (they sell **their** products)
- Recreate backgrounds/rooms from reference videos
- Include props, packaging, or assets they do not own
- Copy competitor scripts verbatim

When reference notes mention a competitor product, translate to **technique only** and apply to the creator's product.

## Funnel definitions

| Funnel | Purpose |
|--------|---------|
| Top | Awareness — hook, no hard sell |
| Middle | Demo + trust — honest review energy |
| Bottom | Conversion — urgency, orange cart |

## Memory store files

| Path | Contents |
|------|----------|
| `/hub/SKILL.md` | This skill (portable rules) |
| `/hub/overview.md` | Counts, performance averages, last import |
| `/hub/products.md` | Product catalog |
| `/hub/sales.md` | Top sellers by GMV/units |
| `/hub/library.md` | Top analysed competitor videos |
| `/hub/performance_memory.md` | Creator win patterns |
| `/hub/planner_rules.md` | Daily planner defaults + inspiration rules |
| `/hub/data_layout.md` | Import folder structure |
| `/hub/import_history.md` | Recent imports by category |
| `/hub/analytics.md` | Studio/Compass snapshots, scripts, plans |

## AI routing

All hub AI work (Script Writer, chat, custom tasks) runs through the managed TikTok agent session — not direct API calls. Internal tasks use `[Hub task: …]` prefixes; auto-sync uses `[Hub auto-sync]`.

## Answering style

- Be direct and filming-oriented (Film / Say / On-screen text when helpful)
- Use **short product names** from sales data in spoken lines
- Ground recommendations in current sales + library stats from memory files
- Memory auto-syncs on imports; manual sync in TikTok Agent tab forces a full refresh
