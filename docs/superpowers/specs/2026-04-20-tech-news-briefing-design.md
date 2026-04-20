# Tech News Briefing — Design Spec

**Date:** 2026-04-20
**Status:** Draft — awaiting approval
**Replaces:** `ai-briefing` (AI-only summarizer built 2026-04-03, migrated to Claude Haiku 2026-04-20)
**Target consumer:** Leo, for TWiT / MacBreak Weekly / Intelligent Machines show prep

---

## 1. Problem

Leo scans ~200 RSS feeds daily via `beatcheck` to surface stories for three weekly shows:

- **TWiT** — general tech news
- **MBW** (MacBreak Weekly) — Apple news
- **IM** (Intelligent Machines) — AI news

The current `ai-briefing` service summarizes only AI-relevant stories into a daily Obsidian note. It provides morning context but doesn't help with per-show selection. The manual pipeline is:

```
OPML → beatcheck (scan + Raindrop bookmark) → collect-stories (.org file) →
       manual edit → prepare-briefing → twit.show (final hand-curated pages)
```

Leo wants an ML-assisted pre-filter that slots **before** this pipeline, narrowing the day's candidate pool to a per-show ranked shortlist so the subsequent manual scan is shorter and higher-quality.

## 2. Goal

Replace the current AI-only briefing with a **daily tech news briefing** that scores each new story against three shows and outputs a per-show ranked list. The evaluation target — what the model is trying to reproduce — is Leo's final hand-curated `twit.show` page for each show.

Long-term, use the autoresearch overnight-loop pattern on macmini to iteratively improve the scorer against real labels (twit.show history + daily bookmark signal).

## 3. Non-goals (v1)

- No modification of the existing downstream pipeline (`beatcheck`, `collect-stories`, org editing, `prepare-briefing`, `twit.show`).
- No Raindrop writes — the briefing produces clickable links; bookmarking is manual via Leo's existing browser workflow (or via `beatcheck`).
- No Google Sheets integration — `twit.show` is the authoritative label source.
- No show-transcript ingestion — deferred to Phase 2+.

## 4. Data model

Two local SQLite databases on Framework:

### 4.1 `~/.local/share/ai-briefing/archive.db` — candidate corpus

Every story ever fetched from the OPML. Append-only. This becomes the negative-example corpus for Phase 3 supervised training.

```sql
CREATE TABLE stories (
  id INTEGER PRIMARY KEY,
  url_canonical TEXT UNIQUE NOT NULL,
  url_original TEXT,              -- if different from canonical (e.g. aggregator resolved)
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,      -- feed name, e.g. "Daring Fireball"
  source_domain TEXT NOT NULL,    -- e.g. "daringfireball.net"
  published_at TEXT NOT NULL,     -- ISO 8601
  first_para TEXT,                -- first paragraph for context
  ingested_at TEXT NOT NULL
);
CREATE INDEX idx_stories_published ON stories(published_at);
CREATE INDEX idx_stories_source ON stories(source_domain);
```

### 4.2 `~/.local/share/ai-briefing/labels.db` — positive examples

Scraped from `twit.show/{twit,mbw,im}` — the final hand-curated version for each show.

**Ephemerality constraint:** the twit.show pages reset after each show airs. The final curated version only exists during a narrow window — from when Leo finishes editing (typically same day as recording) until that night's overwrite. The scraper must capture each show's page within that window or the labels for that week are lost.

**Show record times** (America/Los_Angeles):
- **TWiT** — 2:00 PM Sundays
- **MBW** — 11:00 AM Tuesdays
- **IM** — 2:00 PM Wednesdays

**Scrape schedule** (systemd user timers on Framework, local Pacific time). The page is frozen the instant each show starts — Leo won't edit after that. Primary scrape fires at show-start; fallback sweeps the window in case of transient failure.
- **TWiT** — primary Sundays **2:00 PM PT**; fallback hourly Sun 2 PM – 11 PM.
- **MBW** — primary Tuesdays **11:00 AM PT**; fallback hourly Tue 11 AM – 11 PM.
- **IM** — primary Wednesdays **2:00 PM PT**; fallback hourly Wed 2 PM – 11 PM.

Each scrape parses the page date from the HTML `<title>` (e.g. "Sunday, 19 April 2026"). Matching date → stored as authoritative; fallback checks skip storing (deduped by page date + URL hash). Stale/mismatched page at the primary fire → retried on next fallback tick. If no authoritative capture by 11 PM, fires a `ntfy`/Discord alert so Leo can manually save the page before overnight reset.

**Backfill strategy:**

1. **Historical archive (maintained by Leo):** each show has an `archive/` subfolder at `twit.show/<show>/archive/` holding past final-version pages. Assumed filename convention `YYYY-MM-DD.html` (Leo to confirm; scraper adapts). The archive is crawled **once** at deployment to populate historical labels, then checked incrementally for any new dated pages Leo adds.
2. **Live capture:** forward-looking per the schedule above — captures each new show's page as it airs, before overnight reset.

```sql
CREATE TABLE picks (
  id INTEGER PRIMARY KEY,
  show TEXT NOT NULL,             -- "twit" | "mbw" | "im"
  episode_date TEXT NOT NULL,     -- the dated twit.show page this came from
  section_name TEXT,              -- e.g. "1. AI", "2. End of Work"
  section_order INTEGER,          -- 1, 2, 3...
  rank_in_section INTEGER,        -- 1 = canonical, 2+ = derivative sources
  story_url TEXT NOT NULL,
  story_title TEXT,
  scraped_at TEXT NOT NULL
);
CREATE INDEX idx_picks_show_date ON picks(show, episode_date);
```

Populated by a separate scraper run daily (or when a new show page appears). Initial backfill pulls whatever archive `twit.show` exposes.

### 4.3 Briefing output (Obsidian)

Files at `~/Obsidian/lgl/AI/News/YYYY/MM/YYYY-MM-DD.md` — matches existing `Daily Notes/YYYY/MM/` convention. Linked from daily note above `#### Exercise` as `[[AI/News/YYYY/MM/YYYY-MM-DD|📰 Tech Briefing]]`.

## 5. Scoring (Phase A)

### 5.1 Fetch window

Only stories published in the **past 24 hours**. Typical pool size: ~10 new stories/day across the 200-feed universe.

### 5.2 Pipeline per daily run

1. **Fetch** all OPML feeds, same as current `ai-briefing`.
2. **Filter** to stories with `published_at` within past 24h.
3. **Archive**: insert every fetched story into `archive.db`. This happens regardless of whether it makes the briefing — we need the negative pool.
4. **Dedupe**: URL canonicalization (strip `utm_*` and other tracking params, drop fragment, lowercase host, strip trailing slash) + title trigram Jaccard similarity. Stories with sim > 0.85 are grouped into a topic cluster.
5. **Score per cluster** via Claude Haiku 4.5 with a prompt containing:
   - Short description of each show (TWiT/MBW/IM) and Leo's curation rules
   - Few-shot examples: the **20 most recent picks per show** from `labels.db` (approximately the last 3-4 episodes' worth), each labeled with section name, canonical URL, story title
   - The candidate cluster's stories (title + source + first paragraph)
   - Request: for each show, output `{score: 0-1, canonical_url, section_guess, reasoning}`
6. **Selection (v1, broad net)**: per show, take the **top 15 clusters by score** for that show regardless of threshold. Remaining clusters that scored > 0.3 for *any* show go to "Other notable". Everything else is archived but not surfaced. Phase B/C will replace this with tuned thresholds as precision improves.
7. **Write briefing** to Obsidian.

### 5.3 Source preference (within-cluster ordering)

No explicit citation extraction. Within a cluster, rank stories by source preference learned from historical `twit.show` ordering:

- For each pair (topic, source), count how often that source was listed first vs. later in historical picks covering similar topics.
- When scoring a new cluster, the source that historically led similar clusters appears first (canonical); others appear as derivatives.
- For unfamiliar sources: default to earliest `published_at` as a tiebreaker.

Implementation detail: this preference table is built once from `labels.db` and refreshed weekly.

## 6. Output format

Single daily file. Per-show sections appear only when they have content.

```markdown
---
date: 2026-04-20
type: tech-briefing
pool_size: 11
---

# Tech Briefing — April 20, 2026

## TWiT (general tech) — 3 candidates

- **Anthropic releases Claude Opus 4.7** — benchmark-leading coding and agentic performance. ([Axios](https://...))
  - ([TheNextWeb](https://...)) — additional coverage
- **Live Nation monopoly verdict** — federal jury rules concert business is a monopoly. ([Engadget](https://...))
- ...

## MBW (Apple) — 2 candidates

- **Apple Vision Pro 2 rumor** — ... ([Bloomberg](https://...))
- ...

## IM (AI) — 4 candidates

- ...

## Other notable — 3 below-threshold items

*(Items the model scored too low for show inclusion but might be worth a glance.)*

- **...** — summary ([Source](url))
```

## 7. Integration with existing ai-briefing

Replace in-place. Code lives in `~/Projects/ai-briefing/`. Same systemd timer (`ai-briefing.timer` at 3am PDT). Same secrets (`ANTHROPIC_API_KEY` already in sops `ai-briefing.env`). Same `decrypt-secrets` pattern.

Legacy files under `~/Obsidian/lgl/AI/News/YYYY-MM-DD.md` (flat) remain in place as history. New output uses the `YYYY/MM/` subfolder convention. `linkInDailyNote` updates its wikilink to the new path.

## 8. Phase gating

| Phase | Timeline | Adds |
|-------|----------|------|
| **A — ship v1** | ~1 week | Pipeline in §5. Archive + labels databases. Few-shot LLM scoring. Broad threshold. |
| **B — embeddings** | +3 weeks | Embed every archived story (Voyage or OpenAI). Embed every `twit.show` pick. For each candidate, add "max cosine sim to prior picks per show" as extra prompt feature. Same output, better precision. |
| **C — supervised + autoresearch** | Timeline depends on backfill depth. If Leo's archive covers ≥ 2 months of shows, Phase C can start ~2 weeks after deployment (enough forward negatives matched to historical positives). Without backfill, data-gated at ~4+ weeks forward collection. | Once enough labeled data exists: train per-show classifier (logistic regression on embeddings, or small MLP). Blend classifier score with LLM score. Run autoresearch-style tuning loops on macmini over the search space {prompt templates, few-shot selection strategy, model, clustering thresholds, blend weights}. Metric: recall@weekly-20-picks on held-out `twit.show` weeks. |

Nothing in B or C requires changes to A's data or output format — `archive.db` is the forward-compatible foundation.

## 9. Autoresearch tuning (Phase C detail)

The overnight loop optimizes a single objective: **recall at cumulative-weekly pick count on held-out `twit.show` weeks**.

**Cadence:**
- **Active tuning phase (default during Phase C rollout):** weekly, **Wednesday night** after IM's page has been scraped. Agent wakes, replays held-out weeks, writes journal to Obsidian, Leo reads Thursday morning.
- **Steady-state (once metrics plateau):** monthly + on-demand. Weekly runs on a stable config mostly churn noise — avoid that once ΔR@20 between runs is consistently < σ.

**Where it runs:** Framework (not macmini, despite the apr19 precedent). This loop is LLM-scoring-only — no MLX training, no GPU, no Apple Silicon dependency. Framework is always on, the pipeline already lives there, and macmini may sleep.

**Objective:**
- Hold out the most recent 4 weeks of `twit.show` picks across all three shows.
- For each candidate configuration, replay the daily briefing process using `archive.db` snapshots from those weeks.
- Measure: for each held-out week W, `|candidates ∩ twit.show picks| / |twit.show picks|` — averaged across weeks.

**Configuration search space:**
  - Prompt template (which show descriptions, which curation rules to include)
  - Few-shot selection (K most recent, K nearest by embedding, K diverse)
  - K itself (3 / 5 / 10 / 20)
  - Claude model (Haiku 4.5 / Sonnet 4.6 — cost/quality tradeoff)
  - Clustering threshold (0.75 / 0.85 / 0.95 trigram Jaccard)
  - Blend weights (LLM score vs classifier prob vs embedding sim)
  - Classifier architecture (logistic / small MLP / gradient boost)

**Output:** journal written to `~/Obsidian/lgl/AI/Research/autoresearch/<tag>.md` directly (Framework writes to its own vault copy; Obsidian sync propagates). Structure mirrors apr19 — reasoning, experiments table, kept/discarded decisions, conclusion.

## 10. Implementation notes

- **Language**: Bun/TypeScript, consistent with existing `ai-briefing` codebase.
- **Dependencies added (v1):** `better-sqlite3` (SQLite driver for Bun) — to be pinned to a version ≥14 days old per the release-age rule.
- **Twit.show scraper**: separate module, Playwright not needed — `twit.show` is static HTML. Simple `fetch` + cheerio or regex parsing. Scrape `twit.show/{twit,mbw,im}` for current page (= most recent) on each daily run; scrape dated archive URLs for backfill.
- **Raindrop**: not needed for v1. Stub module reserved for future side-channel signal.
- **Testing**: TDD required (per user preference). Parser/dedupe/scoring-prompt-build all unit tested. Integration test hits sandboxed Haiku with a small fixture.
- **Schema migrations**: hand-written `*.sql` files in `src/migrations/`, applied on startup if not yet present.

## 11. Risks and open questions

| Risk | Mitigation |
|------|------------|
| Leo's tastes are "unpredictable" — model may plateau at low precision | Broad net threshold early; autoresearch tuning once enough data; accept that Phase C may cap below 100% |
| `twit.show` pages are ephemeral — reset after each show airs | Per-show scrape timers fire at show-start (page is frozen then); hourly fallback until 11 PM. Labels start accruing from deployment day forward. |
| Missing a scrape window loses that show's weekly labels entirely | Hourly fallback on show day; `ntfy`/Discord alert if no authoritative capture by 11 PM PT. Leo can manually save the page as a recovery path. |
| Archive filename convention not yet confirmed | Scraper probes `YYYY-MM-DD.html` first, falls back to directory listing if the server permits it. Leo can override with exact pattern in `config.yaml`. |
| 24h window misses delayed-publish stories | Acceptable for v1. Phase B could add a "look back 48h for anything not-yet-seen" secondary pass |
| Claude Haiku insufficient for nuanced show-fit judgment | Phase C autoresearch will compare Haiku vs Sonnet as a tunable parameter |
| Few-shot prompt grows too long as history accumulates | Cap few-shot at K recent + K nearest; embeddings (Phase B) make "nearest" meaningful |

## 12. Acceptance criteria

Phase A is considered shipped when:

1. New briefing runs daily at 3am via existing `ai-briefing` systemd timer.
2. Output file appears at `~/Obsidian/lgl/AI/News/YYYY/MM/YYYY-MM-DD.md` with per-show sections and "Other notable".
3. Daily note is linked to the new path.
4. `archive.db` and `labels.db` exist, populated, and queryable.
5. `twit.show` backfill scraper has populated `labels.db` with whatever archive pages are accessible.
6. All code is TDD-tested; baseline test suite (minus 2 pre-existing RSS-parser failures) passes.
7. After 7 days of operation, Leo can compare the briefing's suggestions against his actual Raindrop bookmarks and the next twit.show page as subjective "is this useful?" signal — ahead of any quantitative tuning.
