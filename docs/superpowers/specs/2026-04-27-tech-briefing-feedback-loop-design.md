# Tech Briefing Feedback Loop & Per-Show Classifier

**Date:** 2026-04-27
**Status:** Design approved, awaiting implementation plan
**Affects:** `~/Projects/ai-briefing/`, `~/Projects/raindrop-briefing/` (read-only consumer)

## Problem

The current Phase A briefing pipeline (deployed 2026-04-20) uses Claude Haiku 4.5 with few-shot examples drawn from `labels.db`. `labels.db` is seeded from historical show rundowns (`~/Documents/archive-{twit,mbw,im}/`) and has no automatic update path. There is no signal for whether a story the briefing surfaces is actually used on the show.

A better ground-truth source exists: the **show notes Links section** at the bottom of each episode page on twit.tv (e.g. `https://twit.tv/shows/this-week-in-tech/episodes/1081`). This lists the URLs Leo actually used. Combined with the Raindrop bookmarks (Leo's first-pass curation, which goes back >1 year for the manually-curated era and Phase A onward for the pipeline-curated era) and the RSS pool in `archive.db` (Phase A onward only), there is a three-tier signal:

| Tier | Meaning | Label |
|---|---|---|
| In show-notes Links | Used on the show | strong positive (1.0) |
| In Raindrop, not in show-notes | Curated but cut | weak positive (0.5) |
| In `archive.db` pool, in neither | Available, rejected | negative (0.0) |

## Goal

A per-show classifier that learns Leo's taste from the three-tier signal, pre-filters the daily candidate pool, and improves week over week as new (predicted, actual) pairs accumulate.

**Success criterion:** rolling 4-week recall@40 ≥ 80% per show — i.e. of the URLs that end up in the show notes, the classifier shortlists at least 80% of them in its top-40.

## Non-Goals

- Replacing Haiku entirely. Haiku still scores the shortlist and writes selection rationale.
- Cross-show models. Each show gets its own classifier; no shared multi-head model.
- Going further back than 6 months in the backfill. TWiT and IM are mid-pivot; older taste is stale.
- Auto-applying the eval reports as a feedback signal beyond the weekly retrain. The 4-week-rolling-recall fallback is the only automatic action; everything else is for Leo to read.

## Architecture

### Daily briefing path (3am, modified)

```
RSS feeds (existing)
  ↓
archive.db (existing)
  ↓
cluster (existing) — ~400 clusters
  ↓
NEW: per-show classifier (twit/mbw/im) scores each cluster
  ↓ shortlist top-40 per show by classifier probability
Haiku scores just the shortlist (10× cheaper than current per-day call)
  ↓
top-N + "Other notable" per show (existing)
  ↓
write briefing.md → Obsidian (existing)
  ↓
raindrop-briefing pushes to Raindrop (existing)
```

If the classifier model artifact is missing or 4-week recall@40 < 80% for a show, that show falls back to the current path (Haiku scores all 400 clusters). Voiced + logged.

### Feedback loop (post-show, per-show)

```
Show airs → editor publishes notes (next morning)
  ↓
NEW: harvester scrapes twit.tv/shows/<slug>/episodes/<N>
  ↓ extract "### Links" URLs
  ↓ canonicalize via existing cluster.ts logic
  ↓ match against archive.db (RSS pool that day) and Raindrop API
  ↓ INSERT into labels.db.picks with weight column (NEW)
  ↓
NEW: trigger per-show retrain
  ↓ load all positives + weighted weak-positives + negatives for this show, last 6 months
  ↓ recency-weight (0.5 for >1 month old)
  ↓ embed via sentence-transformers, train logistic regression
  ↓ atomic swap of model artifact at ~/.local/share/ai-briefing/models/<show>.pkl
  ↓
NEW: write eval report to ~/Obsidian/lgl/AI/News/eval/YYYY-MM-DD-<show>.md
```

### Pre-training (one-shot, runs once at deploy)

Walks 6 months of historical episode pages and Raindrop bookmarks, populates `labels.db`, trains seed models. Output is three model artifacts and a backfill summary report. Re-runnable safely (idempotent on `labels.db` UNIQUE constraint).

## Components

### 1. Show-notes harvester

`src/sources/show-notes.ts` (or `bin/harvest-show-notes.ts`)

- Input: show slug + episode number (or date range for backfill)
- Resolves episode URL via `https://twit.tv/shows/<slug>/episodes` listing page
- Fetches episode page, extracts `### Links` section
- Returns array of `{ url, title }` for each link
- Deduplicates and canonicalizes URLs using existing cluster.ts canonicalization

Show slug map:
- `twit` → `this-week-in-tech`
- `mbw` → `macbreak-weekly`
- `im` → `intelligent-machines`

### 2. Label store extension

`labels.db` schema additions:

```sql
ALTER TABLE picks ADD COLUMN weight REAL NOT NULL DEFAULT 1.0;
ALTER TABLE picks ADD COLUMN source TEXT NOT NULL DEFAULT 'archive';
-- source ∈ {archive, show_notes, raindrop, negative}
```

Existing rows (sourced from `~/Documents/archive-*`) get `source='archive'`, `weight=1.0`. New rows from the harvester get `source='show_notes'` (weight 1.0) or `source='raindrop'` (weight 0.5). Synthetic negatives get `source='negative'` with weight 1.0.

The UNIQUE on `(show, episode_date, story_url)` is preserved; on conflict, upgrade source/weight to the strongest signal (show_notes > raindrop > archive > negative).

### 3. Raindrop reader

The existing `raindrop-briefing` Go tool only writes. We need a read-side. Two options:

- **Option A (chosen):** New small Go binary `raindrop-history` in the same repo, reads bookmarks for a date range from the "News Links" collection, emits JSON. Reuses `raindrop.go` client code.
- Option B: Inline Raindrop API call in the harvester. Rejected — splits the auth/client logic across two languages.

Tagged by show via the `Sections` field that the existing pusher writes (TWiT/MBW/IM). Older manually-curated bookmarks lack tags; the harvester treats untagged bookmarks as ambiguous and uses the Raindrop bookmark date + nearest episode date to assign a show.

### 4. Trainer (Python sidecar)

`bin/train.py`, run via `uv run`.

- Reads `labels.db` for one show
- Filters to last 6 months
- Embeds `title + " — " + summary` via `sentence-transformers/all-MiniLM-L6-v2` (cached locally)
- Concatenates additional features: source name (one-hot, top-50 sources), cluster size, recency in hours
- Trains scikit-learn `LogisticRegression(class_weight='balanced')` with sample weights from the `weight` column × recency factor
- Saves pickle to `~/.local/share/ai-briefing/models/<show>.pkl` atomically (write to `.tmp`, rename)
- Writes eval report to `~/Obsidian/lgl/AI/News/eval/YYYY-MM-DD-<show>.md` using a 2-week holdout

Inference mode (same script, `--score`):

- Reads candidates as JSON on stdin: `[{url, title, summary, source, cluster_size, published_at}, ...]`
- Loads model + embedding model
- Emits scores as JSON on stdout: `[{url, score}, ...]`
- Single process per briefing run (embedding model loads once)

Embedding model is a 22MB download cached at `~/.cache/huggingface/`. First run downloads; subsequent runs are offline.

### 5. Pipeline integration

`src/scorer.ts` gets a new pre-filter step before the Haiku call:

```typescript
async function scorePerShow(clusters: Cluster[], show: ShowKey): Promise<Cluster[]> {
  const modelPath = `~/.local/share/ai-briefing/models/${show}.pkl`;
  if (!await Bun.file(modelPath).exists()) {
    return clusters; // fallback: classifier missing, score all
  }
  if (await rollingRecall4w(show) < 0.80) {
    return clusters; // fallback: classifier degraded
  }
  const candidates = clusters.map(toClassifierInput);
  const scores = await runPython('bin/train.py', ['--score', '--show', show], JSON.stringify(candidates));
  const ranked = clusters
    .map((c, i) => ({ c, s: scores[i] }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 40);
  return ranked.map(r => r.c);
}
```

The Haiku call then runs on ~40 clusters per show instead of ~400.

### 6. Cadence (systemd timers)

| Timer | Schedule | Action |
|---|---|---|
| `ai-briefing.timer` (existing) | 03:00 daily | Run briefing, classifier inference inline |
| `ai-briefing-harvest-twit.timer` (NEW) | Mon 10:00 | Harvest TWiT episode that aired Sun, retrain TWiT |
| `ai-briefing-harvest-mbw.timer` (NEW) | Wed 10:00 | Harvest MBW episode that aired Tue, retrain MBW |
| `ai-briefing-harvest-im.timer` (NEW) | Thu 10:00 | Harvest IM episode that aired Wed, retrain IM |

Each harvest timer:
1. Looks up the most recent episode for that show on twit.tv
2. Runs harvester → updates `labels.db`
3. Runs `uv run bin/train.py --train --show <show>`
4. Writes eval report
5. Voices a one-line summary via localhost:8888 ("TWiT classifier retrained: recall@40 89%")

If the harvest fails (notes not yet published, network error, parse failure), retry once at +2h. After that, log + voice a warning, do not retrain. Next week's harvest catches up.

## Backfill scope

Effective training weight = `label_weight × recency_factor` where `label_weight` lives in `labels.db` (1.0 strong positive, 0.5 weak positive, 1.0 negative) and `recency_factor` is computed at training time (1.0 if ≤ 1 month old, 0.5 otherwise).

| Era | Sources available | Notes |
|---|---|---|
| Last ~1 week (Phase A) | `archive.db` pool + Raindrop + show-notes | Full triplets, full recency weight |
| Prior 6 months | Raindrop + show-notes only | No real RSS pool; recency factor 0.5 |
| > 6 months ago | Skip | TWiT and IM are mid-pivot; older taste is stale |

Synthetic negatives for the prior-6-months window: random sample from current `archive.db`, sized to 3× positives per show. This is the weakest part of pre-training — these negatives come from the wrong time period. Acknowledged: precision in the first 1-2 weeks may be poor; weekly retrains with real triplets correct it.

The backfill script (`bin/pretrain.ts`) is idempotent: re-running does not duplicate rows in `labels.db` (UNIQUE constraint) and re-trains models on whatever is present. Safe to run multiple times during development.

## Evaluation

**Metrics:**

- **Recall@40** (primary): of URLs in show-notes Links, fraction in the classifier's top-40 shortlist
- **Precision@N** (secondary): of URLs the briefing emits as top-N (where N = `pipeline.top_n_per_show`, currently 15), fraction that made the show

**Methodology:** holdout most recent 2 weeks during training, evaluate on those.

**Reports:** `~/Obsidian/lgl/AI/News/eval/YYYY-MM-DD-<show>.md` after each retrain (directory created on first run). Format:

```
# TWiT classifier eval — episode 1081 (2026-04-26)

Trained on: 2026-04-27
Holdout: episodes 1080, 1079

Recall@40:    24/27 (89%)
Precision@N:  9/15 (60%)
4-week rolling recall@40: 86%

Missed (in show-notes, not in shortlist):
- https://example.com/story-1 — diagnosis: not in archive.db (RSS gap)
- https://example.com/story-2 — diagnosis: in archive.db, classifier scored 0.18 (60th percentile)
- https://example.com/story-3 — diagnosis: in archive.db, clustered with another story

Top training-example influences for top-3 shortlist picks: <auditability hook>
```

**Safety net:** `rollingRecall4w(show) < 0.80` triggers per-show fallback to current Haiku-only path until next retrain. Surfaced in next briefing's voice notification.

## Stack summary

- **Harvester:** TypeScript, runs in Bun process. New file `src/sources/show-notes.ts` plus `bin/harvest-show-notes.ts` entrypoint.
- **Raindrop reader:** Go, new binary `raindrop-history` in `~/Projects/raindrop-briefing/`, emits JSON.
- **Trainer/scorer:** Python via `uv run`, single script `bin/train.py` with `--train` and `--score` modes. Uses `sentence-transformers`, `scikit-learn`, `numpy`. Dependencies pinned in `pyproject.toml`.
- **Glue:** `src/scorer.ts` adds the pre-filter step. Subprocess pattern matches existing `bin/weather.sh` integration.
- **Schema:** `labels.db` migration adds `weight`, `source` columns.
- **Models:** `~/.local/share/ai-briefing/models/{twit,mbw,im}.pkl`.
- **Embedding cache:** `~/.cache/huggingface/sentence-transformers/all-MiniLM-L6-v2`.

## Open issues

None blocking. Worth noting for the implementation plan:

- The aggregator-pubDate stash (`stash@{0}` in ai-briefing) should be popped and committed *before* this work starts, since the harvester depends on accurate `published_at` for time-windowing the archive.db pool.
- The Raindrop bookmark tagging strategy for the "manually-curated era" (>1 year of untagged bookmarks) is heuristic. If accuracy turns out to matter, we can add a one-shot `bin/tag-raindrop-history.ts` that uses the show airing date and bookmark date to assign tags.
- `cluster.ts` URL canonicalization is currently used at cluster time; we need to expose it as a callable function for the harvester. Small refactor.
