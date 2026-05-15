# ai-briefing

Daily tech-news briefing pipeline that scores RSS candidates for three TWiT podcasts — **This Week in Tech**, **MacBreak Weekly**, and **Intelligent Machines** — using few-shot examples drawn from Leo Laporte's own historical show picks.

Runs nightly via systemd timer; output lands in an Obsidian vault as per-show markdown.

## How it works

```
OPML feeds ─► RSS fetch ─► archive.db ─► 24h window ─► topic clusters
                                                              │
  Leo's saved show rundowns ─► labels.db ─► few-shot prompt ──┤
                                                              ▼
                                                      Claude Haiku scores
                                                       each cluster for
                                                       all three shows
                                                              │
                                         top-N per show + "Other notable"
                                                              │
                                                              ▼
                                            Obsidian/AI/News/YYYY/MM/YYYY-MM-DD.md
```

Two local SQLite DBs:

- **`archive.db`** — every RSS candidate ever seen, URL-canonicalized and deduped. Growing corpus for future supervised training.
- **`labels.db`** — Leo's actual picks from past episodes, ingested from `~/Documents/archive-{twit,mbw,im}/` (HTML > org > CSV priority per episode). Feeds the few-shot prompt; grows every week.

## Install

```bash
bun install
# edit config.yaml — paths + OPML location
```

`ANTHROPIC_API_KEY` must be in the environment (systemd `EnvironmentFile=` for production).

## Run

```bash
# Full pipeline
bun run src/index.ts

# One-shot archive ingest (populate labels.db from show-archive folders)
bun run src/bin/ingest-archive.ts
```

## Tests

```bash
bun test
```

## Project board

Work is tracked on the GitHub Projects v2 board:

- Board: https://github.com/users/leolaporte/projects/1
- Local convention doc: `docs/project-board.md`

Jared treats that board as the mirror of reality. New durable work should be
represented by an issue on the board before implementation starts. The board
uses GitHub's built-in Status field (`Todo`, `In Progress`, `Done`) plus custom
fields for `Priority` and `Work Stream`.

Work streams:

- `Ingestion` — RSS, OPML, archive, label import, and corpus growth.
- `Scoring` — prompts, few-shot examples, Claude scoring, classifier work, and evaluation.
- `Briefing Generation` — candidate selection, show-specific output, and markdown formatting.
- `Delivery` — Obsidian publishing path, notifications, and downstream consumption.
- `Operations` — systemd timers, retraining jobs, config, dependency hygiene, and reliability.

Quick status check from the repo root:

```bash
jared summary
```

## Tech stack

- **Bun** + TypeScript
- **bun:sqlite** (built-in — no external DB)
- **@anthropic-ai/sdk** — Claude Haiku for cluster scoring
- Systemd user timer for daily scheduling

## Project layout

```
src/
├── db.ts              # Shared SQLite migration runner
├── archive.ts         # ArchiveStore — candidate corpus
├── labels.ts          # LabelStore — Leo's pick history
├── cluster.ts         # URL canonicalization + trigram topic clustering
├── prompt.ts          # Few-shot scoring prompt builder
├── scorer.ts          # Claude Haiku cluster scoring
├── selection.ts       # Per-show top-N + "Other notable"
├── writer.ts          # Per-show markdown output, YYYY/MM/ path
├── index.ts           # 8-step main pipeline
├── sources/rss.ts     # RSS/Atom parser with OPML support
├── twitshow/
│   ├── parse.ts       # HTML rundown parser
│   ├── parse-org.ts   # Org-mode rundown parser
│   ├── parse-csv.ts   # LINKS.csv rundown parser
│   └── ingest.ts      # Orchestrator (HTML > org > CSV per episode)
└── migrations/        # SQL schemas
```

## Phases

- **Phase A** (shipped) — Per-show scoring with few-shot from `labels.db`, local-archive ingest, per-show markdown output.
- **Phase B** (planned) — Bounded-parallel scoring, URL canonicalization on pick insert, writer-side markdown escaping, `"Other notable"` cap.
- **Phase C** (planned) — Local classifier trained on `labels.db` as a Haiku pre-filter, once ~12 weeks of picks have accumulated.
