# Tech Briefing Feedback Loop & Per-Show Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-show classifier that pre-filters the daily candidate pool before Haiku scoring, plus a feedback loop that retrains weekly from twit.tv show-notes.

**Architecture:** A TypeScript harvester scrapes the `### Links` section from each twit.tv episode page, joins it with the Raindrop "News Links" collection (filtered by show tag), and writes weighted labels to `labels.db`. A Python sidecar (`bin/train.py`) trains and serves a per-show logistic-regression classifier on top of `sentence-transformers/all-MiniLM-L6-v2` embeddings. The briefing pipeline calls the classifier between `clusterStories` and `scoreCluster`, taking the top-40 per show as input to Haiku. A 4-week-rolling-recall safety net falls back to Haiku-only mode if the classifier degrades.

**Tech Stack:** TypeScript/Bun (existing), Go (raindrop reader), Python via `uv` + scikit-learn + sentence-transformers, sqlite via `bun:sqlite`, systemd user timers.

**Spec:** `docs/superpowers/specs/2026-04-27-tech-briefing-feedback-loop-design.md`

---

## File Structure

### `~/Projects/ai-briefing/`

| Path | Action | Responsibility |
|---|---|---|
| `src/migrations/003_labels_weight_source.sql` | Create | Add `weight` and `source` columns to `picks` |
| `src/labels.ts` | Modify | New `insertLabeledPicks` method, new `LabelRow` type |
| `src/types.ts` | Modify | New types for show-notes, classifier candidates/scores |
| `src/sources/show-notes.ts` | Create | Scrape `### Links` from twit.tv episode pages |
| `src/sources/show-notes.test.ts` | Create | Tests for scraper using fixture HTML |
| `src/sources/raindrop.ts` | Create | Wrapper around the `raindrop-history` Go binary |
| `src/sources/raindrop.test.ts` | Create | Tests for Raindrop wrapper using fixture JSON |
| `src/harvest.ts` | Create | Orchestration: scrape + raindrop + write labels |
| `src/harvest.test.ts` | Create | Tests for label assignment logic |
| `src/classifier.ts` | Create | Wrapper around `bin/train.py --score` subprocess |
| `src/classifier.test.ts` | Create | Tests for classifier wrapper |
| `src/eval.ts` | Create | `rollingRecall4w`, `writeEvalReport` |
| `src/eval.test.ts` | Create | Tests for eval logic |
| `src/index.ts` | Modify | Insert pre-filter step between cluster + score |
| `bin/harvest.ts` | Create | Per-show harvest entrypoint |
| `bin/seed.ts` | Create | Initial seeding entrypoint |
| `bin/train.py` | Create | Python trainer/scorer (--train, --score modes) |
| `bin/train.test.py` | Create | Pytest for trainer |
| `pyproject.toml` | Create | Python dependencies pinned via `uv` |
| `config.yaml` | Modify | Add `classifier:` section |
| `tests/fixtures/twit-1081.html` | Create | Captured snapshot of TWiT 1081 episode page |
| `tests/fixtures/raindrop-week.json` | Create | Captured Raindrop API response for one week |

### `~/Projects/raindrop-briefing/` (Go)

| Path | Action | Responsibility |
|---|---|---|
| `briefing.go`, `cache.go`, `raindrop.go` | Modify | Change `package main` → `package raindrop`; export `Run()` from main.go logic |
| `cmd/raindrop-briefing/main.go` | Create | Existing main.go logic, moved here |
| `cmd/raindrop-history/main.go` | Create | New binary: read tagged bookmarks for a date range, emit JSON |
| `history.go` | Create | History fetch logic (paginate Raindrop API by date range) |
| `history_test.go` | Create | Tests for history logic |
| `main.go` | Delete | Replaced by `cmd/raindrop-briefing/main.go` |

### `~/.config/systemd/user/`

| Path | Action | Responsibility |
|---|---|---|
| `ai-briefing-harvest@.service` | Create | Templated harvest+retrain unit (`%i` = show key) |
| `ai-briefing-harvest-twit.timer` | Create | Mon 10:00 |
| `ai-briefing-harvest-mbw.timer` | Create | Wed 10:00 |
| `ai-briefing-harvest-im.timer` | Create | Thu 10:00 |

---

## Task 0: Prereq — Pop and Commit Aggregator-PubDate Stash

The harvester relies on accurate `published_at` for matching show-notes URLs against the `archive.db` window. The stashed work fixes aggregator pubDate handling and must land first.

**Files:**
- Modify: `src/sources/rss.ts`, `src/types.ts`, `config.yaml`, `package.json`, `bun.lock`
- Create: `src/sources/publish-date.ts`, `tests/sources/publish-date.test.ts`

- [ ] **Step 0.1: Inspect the stash**

```bash
cd ~/Projects/ai-briefing
git stash show -p stash@{0} | head -50
```

Expected: diff showing aggregator pubDate fix; matches description in spec.

- [ ] **Step 0.2: Pop the stash**

```bash
git stash pop stash@{0}
git status
```

Expected: `On branch main`, the same modified + untracked files as before stashing, no merge conflicts.

- [ ] **Step 0.3: Run full test suite**

```bash
bun test
```

Expected: all tests pass, including the new `tests/sources/publish-date.test.ts`. If anything fails, fix it before proceeding — the rest of this plan depends on a green baseline.

- [ ] **Step 0.4: Commit**

```bash
git add src/sources/rss.ts src/sources/publish-date.ts src/types.ts \
        config.yaml package.json bun.lock tests/sources/publish-date.test.ts
git commit -m "feat(rss): drop aggregator stories with unverifiable publish dates"
```

---

## Task 1: Schema Migration — `weight` and `source` Columns

Add the columns the classifier training data needs. Existing rows (sourced from `~/Documents/archive-*`) get `source='archive'`, `weight=1.0` by default.

**Files:**
- Create: `src/migrations/003_labels_weight_source.sql`
- Modify: `src/labels.ts:18` (load the new migration), `src/labels.ts` (extend `PickRow`)
- Test: `tests/labels.test.ts`

- [ ] **Step 1.1: Write the failing test**

```typescript
// tests/labels.test.ts
import { test, expect, beforeEach } from "bun:test";
import { LabelStore } from "../src/labels";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "/tmp/ai-briefing-test-labels.db";

beforeEach(() => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

test("labels.db schema has weight and source columns after migration 003", () => {
  const store = new LabelStore(TEST_DB);
  const cols = store.tableColumns("picks");
  expect(cols).toContain("weight");
  expect(cols).toContain("source");
  store.close();
});

test("inserting a pick with weight=0.5 source='raindrop' round-trips", () => {
  const store = new LabelStore(TEST_DB);
  store.insertLabeledPicks([{
    show: "twit",
    episode_date: "2026-04-26",
    story_url: "https://example.com/a",
    story_title: "Test story",
    source: "raindrop",
    weight: 0.5,
  }]);
  const rows = store.allPicks("twit");
  expect(rows).toHaveLength(1);
  expect(rows[0].weight).toBe(0.5);
  expect(rows[0].source).toBe("raindrop");
  store.close();
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
bun test tests/labels.test.ts
```

Expected: FAIL — `tableColumns`, `insertLabeledPicks`, and `allPicks` don't exist yet, and the migration hasn't been added.

- [ ] **Step 1.3: Create the migration SQL**

```sql
-- src/migrations/003_labels_weight_source.sql
ALTER TABLE picks ADD COLUMN weight REAL NOT NULL DEFAULT 1.0;
ALTER TABLE picks ADD COLUMN source TEXT NOT NULL DEFAULT 'archive';
CREATE INDEX idx_picks_show_source ON picks(show, source);
```

- [ ] **Step 1.4: Wire the migration into `LabelStore`**

In `src/labels.ts`, change the `SCHEMA` constant area to load both files and pass the array:

```typescript
const SCHEMA_002 = readFileSync(resolve(import.meta.dir, "migrations/002_labels.sql"), "utf-8");
const SCHEMA_003 = readFileSync(resolve(import.meta.dir, "migrations/003_labels_weight_source.sql"), "utf-8");

export class LabelStore {
  private db: Database;
  constructor(path: string) {
    this.db = openDb(path, [SCHEMA_002, SCHEMA_003]);
  }
  // ...
}
```

- [ ] **Step 1.5: Add the new types and methods**

In `src/labels.ts`, add to the existing `PickRow` and add new helpers:

```typescript
export type PickSource = "archive" | "show_notes" | "raindrop" | "negative";

export interface PickRow {
  show: Show;
  episode_date: string;
  section_name: string | null;
  section_order: number | null;
  rank_in_section: number | null;
  story_url: string;
  story_title: string | null;
  source_file: string | null;
  weight: number;       // NEW
  source: PickSource;   // NEW
}

export interface LabeledPickInput {
  show: Show;
  episode_date: string;
  story_url: string;
  story_title: string | null;
  source: PickSource;
  weight: number;
}

// Inside LabelStore class:
tableColumns(table: string): string[] {
  const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

insertLabeledPicks(picks: LabeledPickInput[]): { inserted: number; upgraded: number } {
  const stmt = this.db.prepare(`
    INSERT INTO picks (show, episode_date, story_url, story_title, source, weight, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(show, episode_date, story_url) DO UPDATE SET
      source = CASE
        WHEN excluded.source = 'show_notes' THEN 'show_notes'
        WHEN excluded.source = 'raindrop' AND picks.source IN ('archive','negative') THEN 'raindrop'
        ELSE picks.source
      END,
      weight = MAX(picks.weight, excluded.weight),
      story_title = COALESCE(picks.story_title, excluded.story_title)
  `);
  const now = new Date().toISOString();
  let inserted = 0, upgraded = 0;
  for (const p of picks) {
    const before = this.db.prepare(`SELECT source FROM picks WHERE show=? AND episode_date=? AND story_url=?`)
      .get(p.show, p.episode_date, p.story_url) as { source: string } | null;
    stmt.run(p.show, p.episode_date, p.story_url, p.story_title, p.source, p.weight, now);
    if (!before) inserted++;
    else if (before.source !== p.source) upgraded++;
  }
  return { inserted, upgraded };
}

allPicks(show: Show): PickRow[] {
  return this.db.prepare(`SELECT * FROM picks WHERE show = ? ORDER BY episode_date DESC, id`)
    .all(show) as PickRow[];
}

close(): void {
  this.db.close();
}
```

- [ ] **Step 1.6: Delete old test database, run tests**

```bash
rm -f /tmp/ai-briefing-test-labels.db
bun test tests/labels.test.ts
```

Expected: PASS, both tests.

- [ ] **Step 1.7: Run full suite to ensure no regressions**

```bash
bun test
```

Expected: all existing tests still pass — the migration is additive.

- [ ] **Step 1.8: Apply migration to the live DB and verify**

```bash
sqlite3 ~/.local/share/ai-briefing/labels.db ".schema picks"
```

Expected: shows the original schema (no `weight` / `source` yet — migration applies on next `LabelStore` open).

```bash
bun run -e 'import("./src/labels").then(m => { const s = new m.LabelStore(process.env.HOME + "/.local/share/ai-briefing/labels.db"); console.log(s.tableColumns("picks")); s.close(); })'
```

Expected: array including `weight` and `source`. Re-run the schema check to confirm columns persist.

- [ ] **Step 1.9: Commit**

```bash
git add src/migrations/003_labels_weight_source.sql src/labels.ts tests/labels.test.ts
git commit -m "feat(labels): add weight and source columns + insertLabeledPicks"
```

---

## Task 2: Show-Notes Scraper

Pure function that takes an HTML string and returns the URLs in the `### Links` section. No network in this task — that's the entrypoint's job. Test against a captured fixture.

**Files:**
- Create: `src/sources/show-notes.ts`, `src/sources/show-notes.test.ts`
- Create: `tests/fixtures/twit-1081.html`

- [ ] **Step 2.1: Capture the fixture**

```bash
mkdir -p ~/Projects/ai-briefing/tests/fixtures
curl -sL https://twit.tv/shows/this-week-in-tech/episodes/1081 \
  > ~/Projects/ai-briefing/tests/fixtures/twit-1081.html
wc -l ~/Projects/ai-briefing/tests/fixtures/twit-1081.html
```

Expected: file exists, several hundred lines of HTML. Visually grep for `Links` to confirm the section is present:

```bash
grep -n -A 2 '>Links<' ~/Projects/ai-briefing/tests/fixtures/twit-1081.html | head -20
```

Expected: at least one match showing the Links heading.

- [ ] **Step 2.2: Write the failing test**

```typescript
// src/sources/show-notes.test.ts
import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { extractShowNotesLinks, parseEpisodeListing } from "./show-notes";

const FIXTURE = readFileSync(
  resolve(import.meta.dir, "..", "..", "tests", "fixtures", "twit-1081.html"),
  "utf-8"
);

test("extractShowNotesLinks returns 27 URLs from TWiT 1081 fixture", () => {
  const links = extractShowNotesLinks(FIXTURE);
  expect(links.length).toBeGreaterThanOrEqual(20);
  // Spot-check known URLs from the captured episode
  expect(links.some(l => l.url.includes("global.toyota"))).toBe(true);
  expect(links.some(l => l.url.includes("krebsonsecurity.com"))).toBe(true);
});

test("extractShowNotesLinks returns absolute URLs only", () => {
  const links = extractShowNotesLinks(FIXTURE);
  for (const l of links) {
    expect(l.url).toMatch(/^https?:\/\//);
  }
});

test("extractShowNotesLinks returns empty array if no Links section", () => {
  expect(extractShowNotesLinks("<html><body>no links here</body></html>")).toEqual([]);
});
```

- [ ] **Step 2.3: Run test, verify failure**

```bash
bun test src/sources/show-notes.test.ts
```

Expected: FAIL — `extractShowNotesLinks` doesn't exist.

- [ ] **Step 2.4: Implement the scraper**

```typescript
// src/sources/show-notes.ts
import { canonicalizeUrl } from "../cluster";

export interface ShowNotesLink {
  url: string;
  title: string | null;
}

/**
 * Extract URLs from the "Links" section of a twit.tv episode page.
 * The Links section is identified by an <h3> or <h4> with text "Links",
 * followed by <a href> elements. URLs are canonicalized.
 */
export function extractShowNotesLinks(html: string): ShowNotesLink[] {
  // Find the Links heading. Use a permissive regex — twit.tv markup may
  // change between heading levels or wrap the heading in extra spans.
  const headingRe = /<h[1-6][^>]*>\s*Links\s*<\/h[1-6]>/i;
  const headingMatch = headingRe.exec(html);
  if (!headingMatch) return [];

  // Take everything from the heading to the next <h1>-<h4> heading or
  // to the end of the post body, whichever comes first.
  const sliceStart = headingMatch.index + headingMatch[0].length;
  const tail = html.slice(sliceStart);
  const nextHeading = /<h[1-4][^>]*>/i.exec(tail);
  const section = nextHeading ? tail.slice(0, nextHeading.index) : tail;

  // Extract <a href="..."> ... </a> within the section.
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out: ShowNotesLink[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(section)) !== null) {
    const href = m[1];
    if (!/^https?:\/\//i.test(href)) continue;
    const canonical = canonicalizeUrl(href);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const titleHtml = m[2].replace(/<[^>]+>/g, "").trim();
    out.push({ url: canonical, title: titleHtml || null });
  }
  return out;
}

/**
 * Parse the show's episode listing page and return the most recent
 * episode's number and air date.
 */
export function parseEpisodeListing(html: string): { number: number; date: string } | null {
  const re = /\/episodes\/(\d+)["'][^>]*>[\s\S]{0,200}?(\w+\s+\d+,\s+\d{4})/;
  const m = re.exec(html);
  if (!m) return null;
  const number = parseInt(m[1], 10);
  const date = new Date(m[2]).toISOString().slice(0, 10);
  return { number, date };
}
```

- [ ] **Step 2.5: Run tests, verify pass**

```bash
bun test src/sources/show-notes.test.ts
```

Expected: PASS, all 3 tests.

- [ ] **Step 2.6: Commit**

```bash
git add src/sources/show-notes.ts src/sources/show-notes.test.ts \
        tests/fixtures/twit-1081.html
git commit -m "feat(show-notes): scrape Links section from twit.tv episode pages"
```

---

## Task 3: Restructure raindrop-briefing into cmd/ Layout

Refactor the Go module so it can host a second binary. The existing `raindrop-briefing` push tool keeps working unchanged; we add `raindrop-history` next to it.

**Files (in `~/Projects/raindrop-briefing/`):**
- Modify: `briefing.go`, `cache.go`, `raindrop.go` (`package main` → `package raindrop`)
- Create: `cmd/raindrop-briefing/main.go` (moved logic)
- Create: `cmd/raindrop-briefing/main_test.go` (smoke test)
- Delete: `main.go`

- [ ] **Step 3.1: Write the failing test**

```go
// cmd/raindrop-briefing/main_test.go
package main

import (
	"testing"
	"raindrop-briefing"
)

func TestPackageImports(t *testing.T) {
	// Smoke test: confirm we can import the lib package.
	_ = raindrop.NewClient("test-token", "https://example.com")
}
```

(Replace `raindrop-briefing` import path with the actual module name from `go.mod`. Check it first.)

- [ ] **Step 3.2: Inspect go.mod for module name**

```bash
cd ~/Projects/raindrop-briefing
cat go.mod
```

Expected: `module <name>` line. Use that name as the import path; if it's e.g. `module raindrop-briefing`, the import is `raindrop-briefing`.

- [ ] **Step 3.3: Run the test, verify it fails**

```bash
cd ~/Projects/raindrop-briefing
go test ./cmd/raindrop-briefing/
```

Expected: FAIL — `cmd/raindrop-briefing/` doesn't exist yet.

- [ ] **Step 3.4: Change package declarations**

In each of `briefing.go`, `cache.go`, `raindrop.go`, change line 1:

```go
package main
```

to:

```go
package raindrop
```

Existing test files (`briefing_test.go`, `cache_test.go`, `raindrop_test.go`) have `package main` too — change those to `package raindrop` as well.

- [ ] **Step 3.5: Move main.go into cmd/raindrop-briefing/**

```bash
mkdir -p cmd/raindrop-briefing
git mv main.go cmd/raindrop-briefing/main.go
```

In the new `cmd/raindrop-briefing/main.go`:
- Change `package main` (it stays `package main`, that's correct for the entry binary)
- Add `import "<module>" raindrop` (or `"<module>"` and reference as `raindrop.X`)
- Replace bare references to `Item`, `Client`, `LoadCache`, `NewClient`, `ParseBriefing` with `raindrop.Item`, `raindrop.Client`, etc.

The full file (after edits):

```go
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	raindrop "<MODULE_NAME>" // replace <MODULE_NAME> with go.mod's module
)

const (
	defaultVault      = "/home/leo/Obsidian/lgl"
	defaultCollection = "News Links"
	cacheDir          = "/home/leo/.local/share/raindrop-briefing"
	apiBaseURL        = "https://api.raindrop.io"
)

func main() {
	var (
		dateStr        = flag.String("date", time.Now().Format("2006-01-02"), "briefing date YYYY-MM-DD")
		vault          = flag.String("vault", defaultVault, "Obsidian vault root")
		collectionName = flag.String("collection", defaultCollection, "Raindrop collection name")
		dryRun         = flag.Bool("dry-run", false, "print items without calling Raindrop")
	)
	flag.Parse()

	if err := run(*dateStr, *vault, *collectionName, *dryRun); err != nil {
		fmt.Fprintln(os.Stderr, "raindrop-briefing:", err)
		os.Exit(1)
	}
}

func run(dateStr, vault, collectionName string, dryRun bool) error {
	date, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return fmt.Errorf("bad date %q: %w", dateStr, err)
	}
	briefingPath := filepath.Join(vault, "AI", "News",
		fmt.Sprintf("%d", date.Year()),
		fmt.Sprintf("%02d", int(date.Month())),
		dateStr+".md",
	)
	md, err := os.ReadFile(briefingPath)
	if err != nil {
		return fmt.Errorf("read briefing: %w", err)
	}
	items := raindrop.ParseBriefing(string(md))
	if len(items) == 0 {
		fmt.Printf("no curated items in %s\n", briefingPath)
		return nil
	}

	cache, err := raindrop.LoadCache(filepath.Join(cacheDir, "pushed.txt"))
	if err != nil {
		return fmt.Errorf("load cache: %w", err)
	}
	candidates := make([]raindrop.Item, 0, len(items))
	for _, it := range items {
		if !cache.Has(it.URL) {
			candidates = append(candidates, it)
		}
	}
	localSkipped := len(items) - len(candidates)

	if dryRun {
		fmt.Printf("%s: %d items parsed, %d skipped via local cache, %d candidates for remote check\n",
			dateStr, len(items), localSkipped, len(candidates))
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		for _, it := range candidates {
			_ = enc.Encode(map[string]any{
				"link":  it.URL,
				"title": it.Title,
				"tags":  it.Sections,
			})
		}
		return nil
	}

	if len(candidates) == 0 {
		fmt.Printf("%s: %d items parsed, all %d already pushed locally\n", dateStr, len(items), localSkipped)
		return nil
	}

	token := os.Getenv("RAINDROP_TOKEN")
	if token == "" {
		return fmt.Errorf("RAINDROP_TOKEN not set")
	}
	client := raindrop.NewClient(token, apiBaseURL)
	collectionID, err := resolveCollectionID(client, collectionName)
	if err != nil {
		return err
	}

	candidateURLs := make([]string, len(candidates))
	for i, it := range candidates {
		candidateURLs[i] = it.URL
	}
	existing, err := client.CheckExisting(candidateURLs)
	if err != nil {
		return fmt.Errorf("CheckExisting: %w", err)
	}
	fresh := make([]raindrop.Item, 0, len(candidates))
	for _, it := range candidates {
		if existing[it.URL] {
			if err := cache.Add(it.URL); err != nil {
				return fmt.Errorf("cache.Add (existing): %w", err)
			}
			continue
		}
		fresh = append(fresh, it)
	}
	remoteSkipped := len(candidates) - len(fresh)
	fmt.Printf("%s: %d parsed, %d cached, %d already in Raindrop, %d fresh\n",
		dateStr, len(items), localSkipped, remoteSkipped, len(fresh))
	if len(fresh) == 0 {
		return nil
	}

	if err := client.CreateMany(fresh, collectionID); err != nil {
		return fmt.Errorf("CreateMany: %w", err)
	}
	for _, it := range fresh {
		if err := cache.Add(it.URL); err != nil {
			return fmt.Errorf("cache.Add: %w", err)
		}
	}
	fmt.Printf("pushed %d bookmarks to %s (collection %d)\n", len(fresh), collectionName, collectionID)
	return nil
}

func resolveCollectionID(client *raindrop.Client, name string) (int, error) {
	idPath := filepath.Join(cacheDir, "collection_"+name+".id")
	if b, err := os.ReadFile(idPath); err == nil {
		var id int
		if _, err := fmt.Sscanf(string(b), "%d", &id); err == nil && id > 0 {
			return id, nil
		}
	}
	id, err := client.GetCollectionID(name)
	if err != nil {
		return 0, err
	}
	_ = os.MkdirAll(cacheDir, 0o755)
	_ = os.WriteFile(idPath, []byte(fmt.Sprintf("%d\n", id)), 0o644)
	return id, nil
}
```

- [ ] **Step 3.6: Run all tests**

```bash
go test ./...
```

Expected: PASS — existing `briefing_test.go`, `cache_test.go`, `raindrop_test.go` still work because the package was just renamed. Smoke test in `cmd/raindrop-briefing/main_test.go` compiles.

- [ ] **Step 3.7: Build the binary in its new location**

```bash
go build -o /tmp/raindrop-briefing-new ./cmd/raindrop-briefing/
/tmp/raindrop-briefing-new --help 2>&1 | head -5
```

Expected: usage banner showing `--date`, `--vault`, `--collection`, `--dry-run` flags.

- [ ] **Step 3.8: Replace installed binary**

```bash
go build -o ~/.local/bin/raindrop-briefing ./cmd/raindrop-briefing/
~/.local/bin/raindrop-briefing --help 2>&1 | head -5
```

Expected: same usage banner. The systemd unit (if any) calling this binary keeps working.

- [ ] **Step 3.9: Commit**

```bash
git add -A
git commit -m "refactor: move binary into cmd/raindrop-briefing, package raindrop"
```

---

## Task 4: `raindrop-history` Binary

A new binary that reads bookmarks tagged with a show key (TWiT/MBW/IM) from the "News Links" Raindrop collection within a date range, emits JSON.

**Files (in `~/Projects/raindrop-briefing/`):**
- Create: `history.go`, `history_test.go`
- Create: `cmd/raindrop-history/main.go`

- [ ] **Step 4.1: Write the failing test for the history fetch**

```go
// history_test.go
package raindrop

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFetchHistoryFiltersByTagAndDate(t *testing.T) {
	// Two pages of fake bookmarks.
	page1 := `{"items": [
		{"_id": 1, "link": "https://example.com/a", "title": "A", "tags": ["TWiT"], "created": "2026-04-25T10:00:00.000Z"},
		{"_id": 2, "link": "https://example.com/b", "title": "B", "tags": ["MBW"], "created": "2026-04-21T09:00:00.000Z"}
	], "count": 3}`
	page2 := `{"items": [
		{"_id": 3, "link": "https://example.com/c", "title": "C", "tags": ["TWiT"], "created": "2026-04-19T08:00:00.000Z"}
	], "count": 3}`

	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if hits == 1 {
			w.Write([]byte(page1))
		} else {
			w.Write([]byte(page2))
		}
	}))
	defer srv.Close()

	client := NewClient("test-token", srv.URL)
	start, _ := time.Parse("2006-01-02", "2026-04-20")
	end, _ := time.Parse("2006-01-02", "2026-04-26")

	got, err := FetchHistory(client, 42, "TWiT", start, end)
	if err != nil {
		t.Fatalf("FetchHistory: %v", err)
	}
	if len(got) != 1 {
		t.Errorf("expected 1 TWiT bookmark in date range, got %d", len(got))
	}
	if got[0].URL != "https://example.com/a" {
		t.Errorf("expected example.com/a, got %s", got[0].URL)
	}
}

func TestFetchHistoryEmitsJSONLine(t *testing.T) {
	rec := HistoryRecord{
		URL: "https://example.com/x",
		Title: "X",
		Tags: []string{"TWiT"},
		CreatedAt: "2026-04-25T10:00:00.000Z",
	}
	b, err := json.Marshal(rec)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	want := `{"url":"https://example.com/x","title":"X","tags":["TWiT"],"created_at":"2026-04-25T10:00:00.000Z"}`
	if string(b) != want {
		t.Errorf("got %s, want %s", string(b), want)
	}
}
```

- [ ] **Step 4.2: Run, verify failure**

```bash
go test ./...
```

Expected: FAIL — `FetchHistory` and `HistoryRecord` don't exist.

- [ ] **Step 4.3: Implement `history.go`**

```go
// history.go
package raindrop

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type HistoryRecord struct {
	URL       string   `json:"url"`
	Title     string   `json:"title"`
	Tags      []string `json:"tags"`
	CreatedAt string   `json:"created_at"`
}

type rawHistoryItem struct {
	ID      int      `json:"_id"`
	Link    string   `json:"link"`
	Title   string   `json:"title"`
	Tags    []string `json:"tags"`
	Created string   `json:"created"`
}

type rawHistoryPage struct {
	Items []rawHistoryItem `json:"items"`
	Count int              `json:"count"`
}

const pageSize = 50

// FetchHistory pages through the given collection and returns bookmarks
// containing the given tag whose `created` timestamp falls in [start, end].
// `tag` matching is case-insensitive.
func FetchHistory(c *Client, collectionID int, tag string, start, end time.Time) ([]HistoryRecord, error) {
	var out []HistoryRecord
	tagLower := strings.ToLower(tag)
	for page := 0; ; page++ {
		params := url.Values{}
		params.Set("page", strconv.Itoa(page))
		params.Set("perpage", strconv.Itoa(pageSize))
		params.Set("sort", "-created")
		raw, err := c.fetchRaindrops(collectionID, params)
		if err != nil {
			return nil, err
		}
		if len(raw.Items) == 0 {
			break
		}
		anyInRange := false
		for _, it := range raw.Items {
			created, err := time.Parse(time.RFC3339, it.Created)
			if err != nil {
				continue
			}
			if created.After(end) {
				continue // newer than range; keep paging downward
			}
			if created.Before(start) {
				// Older than range. Since results are sorted descending,
				// once we see one older than `start`, the rest are too.
				return out, nil
			}
			anyInRange = true
			matched := false
			for _, t := range it.Tags {
				if strings.ToLower(t) == tagLower {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
			out = append(out, HistoryRecord{
				URL: it.Link, Title: it.Title, Tags: it.Tags, CreatedAt: it.Created,
			})
		}
		if !anyInRange && raw.Count > 0 && page > 0 {
			// We paged past the range without seeing any in-range items;
			// stop to avoid spinning.
			break
		}
		if (page+1)*pageSize >= raw.Count {
			break
		}
	}
	return out, nil
}

// fetchRaindrops is a thin wrapper around the Raindrop "raindrops/{id}"
// endpoint with arbitrary query params. Adds the bearer token.
func (c *Client) fetchRaindrops(collectionID int, params url.Values) (*rawHistoryPage, error) {
	u := fmt.Sprintf("%s/rest/v1/raindrops/%d?%s", c.baseURL, collectionID, params.Encode())
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("raindrop %d: %s", resp.StatusCode, string(body))
	}
	var page rawHistoryPage
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		return nil, err
	}
	return &page, nil
}
```

Note: this uses `c.baseURL` and `c.token`, which exist on the `Client` struct in `raindrop.go` — confirm by inspection. If those fields are unexported and not accessible, add accessors or fold this method into `raindrop.go`.

- [ ] **Step 4.4: Run history tests**

```bash
go test -run TestFetchHistory ./...
```

Expected: PASS, both `TestFetchHistoryFiltersByTagAndDate` and `TestFetchHistoryEmitsJSONLine`.

- [ ] **Step 4.5: Implement the entry binary**

```go
// cmd/raindrop-history/main.go
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	raindrop "<MODULE_NAME>" // same module name as cmd/raindrop-briefing
)

const (
	cacheDir          = "/home/leo/.local/share/raindrop-briefing"
	defaultCollection = "News Links"
	apiBaseURL        = "https://api.raindrop.io"
)

func main() {
	var (
		startStr       = flag.String("start", "", "start date YYYY-MM-DD (inclusive)")
		endStr         = flag.String("end", time.Now().Format("2006-01-02"), "end date YYYY-MM-DD (inclusive)")
		tag            = flag.String("tag", "", "tag to filter by (TWiT/MBW/IM)")
		collectionName = flag.String("collection", defaultCollection, "Raindrop collection name")
	)
	flag.Parse()

	if *startStr == "" || *tag == "" {
		fmt.Fprintln(os.Stderr, "usage: raindrop-history --start YYYY-MM-DD --tag TWiT [--end YYYY-MM-DD]")
		os.Exit(2)
	}

	start, err := time.Parse("2006-01-02", *startStr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "bad --start:", err)
		os.Exit(2)
	}
	end, err := time.Parse("2006-01-02", *endStr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "bad --end:", err)
		os.Exit(2)
	}
	end = end.Add(24*time.Hour - time.Second) // include the whole end day

	token := os.Getenv("RAINDROP_TOKEN")
	if token == "" {
		fmt.Fprintln(os.Stderr, "RAINDROP_TOKEN not set")
		os.Exit(1)
	}
	client := raindrop.NewClient(token, apiBaseURL)
	collectionID, err := resolveCollectionID(client, *collectionName)
	if err != nil {
		fmt.Fprintln(os.Stderr, "resolve collection:", err)
		os.Exit(1)
	}

	records, err := raindrop.FetchHistory(client, collectionID, *tag, start, end)
	if err != nil {
		fmt.Fprintln(os.Stderr, "fetch history:", err)
		os.Exit(1)
	}

	enc := json.NewEncoder(os.Stdout)
	for _, r := range records {
		_ = enc.Encode(r)
	}
}

func resolveCollectionID(client *raindrop.Client, name string) (int, error) {
	idPath := filepath.Join(cacheDir, "collection_"+name+".id")
	if b, err := os.ReadFile(idPath); err == nil {
		var id int
		if _, err := fmt.Sscanf(string(b), "%d", &id); err == nil && id > 0 {
			return id, nil
		}
	}
	id, err := client.GetCollectionID(name)
	if err != nil {
		return 0, err
	}
	_ = os.MkdirAll(cacheDir, 0o755)
	_ = os.WriteFile(idPath, []byte(fmt.Sprintf("%d\n", id)), 0o644)
	return id, nil
}
```

- [ ] **Step 4.6: Build and smoke-test**

```bash
go build -o ~/.local/bin/raindrop-history ./cmd/raindrop-history/
~/.local/bin/raindrop-history --help 2>&1 | head -10
```

Expected: usage with `--start`, `--end`, `--tag`, `--collection` flags.

Live smoke test (requires `RAINDROP_TOKEN` in env):

```bash
~/.local/bin/raindrop-history --start 2026-04-20 --tag TWiT | head -3
```

Expected: one or more JSON lines with `url`, `title`, `tags`, `created_at`. Visually confirm at least one URL appears that matches a recent TWiT bookmark.

- [ ] **Step 4.7: Commit**

```bash
git add -A
git commit -m "feat(history): add raindrop-history binary for date-range tag fetch"
```

---

## Task 5: TypeScript Wrappers — Show-Notes Fetcher and Raindrop Reader

Wrap the network call to twit.tv (using the scraper from Task 2) and the subprocess call to `raindrop-history` (Task 4) in testable TS modules.

**Files:**
- Modify: `src/sources/show-notes.ts` (add fetcher entrypoint)
- Create: `src/sources/raindrop.ts`, `src/sources/raindrop.test.ts`
- Create: `tests/fixtures/raindrop-week.json`

- [ ] **Step 5.1: Add fetcher to show-notes.ts**

Append to `src/sources/show-notes.ts`:

```typescript
const SHOW_SLUGS: Record<string, string> = {
  twit: "this-week-in-tech",
  mbw: "macbreak-weekly",
  im: "intelligent-machines",
};

export interface FetchedShowNotes {
  show: string;
  episodeNumber: number;
  episodeDate: string; // YYYY-MM-DD
  links: ShowNotesLink[];
}

/**
 * Fetch the most recent episode for a show. If `episode` is given, fetches
 * that specific episode. Returns null on parse failure (notes not yet
 * published, network error, page format change).
 */
export async function fetchLatestShowNotes(
  show: keyof typeof SHOW_SLUGS,
  episode?: number
): Promise<FetchedShowNotes | null> {
  const slug = SHOW_SLUGS[show];
  if (!slug) throw new Error(`unknown show: ${show}`);

  let episodeNumber: number;
  let episodeDate: string;

  if (episode !== undefined) {
    episodeNumber = episode;
    episodeDate = new Date().toISOString().slice(0, 10); // best-effort; caller may override
  } else {
    const listing = await fetch(`https://twit.tv/shows/${slug}`).then(r => r.text());
    const parsed = parseEpisodeListing(listing);
    if (!parsed) return null;
    episodeNumber = parsed.number;
    episodeDate = parsed.date;
  }

  const html = await fetch(`https://twit.tv/shows/${slug}/episodes/${episodeNumber}`).then(r => r.text());
  const links = extractShowNotesLinks(html);
  if (links.length === 0) return null;
  return { show, episodeNumber, episodeDate, links };
}
```

- [ ] **Step 5.2: Capture a Raindrop fixture**

```bash
cd ~/Projects/ai-briefing
mkdir -p tests/fixtures
~/.local/bin/raindrop-history --start 2026-04-20 --tag TWiT --end 2026-04-26 \
  > tests/fixtures/raindrop-week.json
wc -l tests/fixtures/raindrop-week.json
```

Expected: at least one line of JSON. If empty, choose a date range that has bookmarks; the goal is a realistic fixture.

- [ ] **Step 5.3: Write the failing test for the Raindrop wrapper**

```typescript
// src/sources/raindrop.test.ts
import { test, expect, mock } from "bun:test";
import { fetchRaindropHistory, parseRaindropHistoryOutput } from "./raindrop";
import { readFileSync } from "fs";
import { resolve } from "path";

const FIXTURE = readFileSync(
  resolve(import.meta.dir, "..", "..", "tests", "fixtures", "raindrop-week.json"),
  "utf-8"
);

test("parseRaindropHistoryOutput parses NDJSON into array", () => {
  const records = parseRaindropHistoryOutput(FIXTURE);
  expect(records.length).toBeGreaterThan(0);
  for (const r of records) {
    expect(typeof r.url).toBe("string");
    expect(typeof r.title).toBe("string");
    expect(Array.isArray(r.tags)).toBe(true);
    expect(typeof r.created_at).toBe("string");
  }
});

test("parseRaindropHistoryOutput skips blank lines", () => {
  const out = parseRaindropHistoryOutput(`{"url":"a","title":"A","tags":[],"created_at":"x"}\n\n\n`);
  expect(out).toHaveLength(1);
});

test("parseRaindropHistoryOutput throws on malformed JSON", () => {
  expect(() => parseRaindropHistoryOutput("not json")).toThrow();
});
```

- [ ] **Step 5.4: Run, verify failure**

```bash
bun test src/sources/raindrop.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 5.5: Implement the Raindrop wrapper**

```typescript
// src/sources/raindrop.ts
import { spawnSync } from "child_process";
import { canonicalizeUrl } from "../cluster";

export interface RaindropRecord {
  url: string;          // canonicalized
  title: string;
  tags: string[];
  created_at: string;
}

const BINARY = process.env.RAINDROP_HISTORY_BIN ?? `${process.env.HOME}/.local/bin/raindrop-history`;

export function parseRaindropHistoryOutput(stdout: string): RaindropRecord[] {
  const out: RaindropRecord[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as RaindropRecord;
    out.push({ ...r, url: canonicalizeUrl(r.url) });
  }
  return out;
}

/**
 * Shell out to the raindrop-history Go binary for a given tag and date range.
 * Throws on non-zero exit. Caller is responsible for ensuring RAINDROP_TOKEN
 * is set in the environment.
 */
export function fetchRaindropHistory(
  tag: string,
  start: string, // YYYY-MM-DD
  end: string    // YYYY-MM-DD
): RaindropRecord[] {
  const result = spawnSync(BINARY, ["--start", start, "--end", end, "--tag", tag], {
    encoding: "utf-8",
    timeout: 30000,
  });
  if (result.status !== 0) {
    throw new Error(`raindrop-history exit ${result.status}: ${result.stderr}`);
  }
  return parseRaindropHistoryOutput(result.stdout);
}
```

- [ ] **Step 5.6: Run tests, verify pass**

```bash
bun test src/sources/raindrop.test.ts
```

Expected: PASS, all 3 tests.

- [ ] **Step 5.7: Commit**

```bash
git add src/sources/show-notes.ts src/sources/raindrop.ts \
        src/sources/raindrop.test.ts tests/fixtures/raindrop-week.json
git commit -m "feat(sources): show-notes fetcher + raindrop history wrapper"
```

---

## Task 6: Harvest Orchestration

Combine the show-notes fetcher and the Raindrop reader into a single function that, given a show and an episode date, writes the full set of labeled picks to `labels.db`.

**Files:**
- Create: `src/harvest.ts`, `src/harvest.test.ts`
- Create: `bin/harvest.ts`

- [ ] **Step 6.1: Write the failing test**

```typescript
// src/harvest.test.ts
import { test, expect, beforeEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { LabelStore } from "./labels";
import { ArchiveStore } from "./archive";
import { assignLabels } from "./harvest";

const TEST_LABELS = "/tmp/ai-briefing-harvest-labels.db";
const TEST_ARCHIVE = "/tmp/ai-briefing-harvest-archive.db";

beforeEach(() => {
  for (const p of [TEST_LABELS, TEST_ARCHIVE]) {
    if (existsSync(p)) unlinkSync(p);
  }
});

test("assignLabels classifies show-notes URL as strong positive", () => {
  const result = assignLabels({
    showNotesUrls: new Set(["https://example.com/a"]),
    raindropUrls: new Set(["https://example.com/a", "https://example.com/b"]),
    archiveUrls: new Set(["https://example.com/a", "https://example.com/b", "https://example.com/c"]),
  });
  const a = result.find(r => r.url === "https://example.com/a")!;
  expect(a.source).toBe("show_notes");
  expect(a.weight).toBe(1.0);
});

test("assignLabels classifies Raindrop-only URL as weak positive", () => {
  const result = assignLabels({
    showNotesUrls: new Set(["https://example.com/a"]),
    raindropUrls: new Set(["https://example.com/a", "https://example.com/b"]),
    archiveUrls: new Set(["https://example.com/a", "https://example.com/b", "https://example.com/c"]),
  });
  const b = result.find(r => r.url === "https://example.com/b")!;
  expect(b.source).toBe("raindrop");
  expect(b.weight).toBe(0.5);
});

test("assignLabels classifies archive-only URL as negative", () => {
  const result = assignLabels({
    showNotesUrls: new Set(["https://example.com/a"]),
    raindropUrls: new Set(["https://example.com/a"]),
    archiveUrls: new Set(["https://example.com/a", "https://example.com/c"]),
  });
  const c = result.find(r => r.url === "https://example.com/c")!;
  expect(c.source).toBe("negative");
  expect(c.weight).toBe(1.0);
});

test("assignLabels includes show-notes URLs not in archive (out-of-pool positives)", () => {
  const result = assignLabels({
    showNotesUrls: new Set(["https://example.com/x"]),
    raindropUrls: new Set(),
    archiveUrls: new Set(),
  });
  expect(result).toHaveLength(1);
  expect(result[0].source).toBe("show_notes");
});
```

- [ ] **Step 6.2: Run, verify failure**

```bash
bun test src/harvest.test.ts
```

Expected: FAIL.

- [ ] **Step 6.3: Implement the orchestration logic**

```typescript
// src/harvest.ts
import type { Show, LabeledPickInput, PickSource } from "./labels";
import { LabelStore } from "./labels";
import { ArchiveStore } from "./archive";
import { canonicalizeUrl } from "./cluster";
import { fetchLatestShowNotes, type FetchedShowNotes } from "./sources/show-notes";
import { fetchRaindropHistory, type RaindropRecord } from "./sources/raindrop";

export interface AssignInputs {
  showNotesUrls: Set<string>;
  raindropUrls: Set<string>;
  archiveUrls: Set<string>;
  titles?: Map<string, string>;
}

export interface AssignedLabel {
  url: string;
  source: PickSource;
  weight: number;
  title: string | null;
}

export function assignLabels(inputs: AssignInputs): AssignedLabel[] {
  const all = new Set<string>([
    ...inputs.showNotesUrls,
    ...inputs.raindropUrls,
    ...inputs.archiveUrls,
  ]);
  const out: AssignedLabel[] = [];
  for (const url of all) {
    let source: PickSource;
    let weight: number;
    if (inputs.showNotesUrls.has(url)) {
      source = "show_notes";
      weight = 1.0;
    } else if (inputs.raindropUrls.has(url)) {
      source = "raindrop";
      weight = 0.5;
    } else {
      source = "negative";
      weight = 1.0;
    }
    out.push({ url, source, weight, title: inputs.titles?.get(url) ?? null });
  }
  return out;
}

const RAINDROP_TAG: Record<Show, string> = { twit: "TWiT", mbw: "MBW", im: "IM" };

const SHOW_AIR_OFFSET_DAYS: Record<Show, number> = {
  twit: 0,  // TWiT airs Sunday; harvest runs Monday → episode_date = harvest_date - 1
  mbw: 0,
  im: 0,
};

/**
 * End-to-end harvest for one show:
 *   1. Fetch latest episode page → show-notes URL set
 *   2. Fetch Raindrop bookmarks for the show (last 14 days)
 *   3. Pull RSS pool from archive.db for the harvest window
 *   4. Assign labels and write to labels.db
 *
 * Returns counts for logging.
 */
export async function harvestShow(
  show: Show,
  labels: LabelStore,
  archive: ArchiveStore,
  opts: { now?: Date; raindropLookbackDays?: number; archiveLookbackDays?: number } = {}
): Promise<{
  episode_date: string;
  episode_number: number;
  show_notes_count: number;
  raindrop_count: number;
  archive_count: number;
  inserted: number;
  upgraded: number;
} | { error: string }> {
  const now = opts.now ?? new Date();
  const raindropLookback = opts.raindropLookbackDays ?? 14;
  const archiveLookback = opts.archiveLookbackDays ?? 14;

  const fetched = await fetchLatestShowNotes(show);
  if (!fetched) return { error: "show notes not available (parse failed or empty Links)" };

  const titles = new Map<string, string>();
  const showNotesUrls = new Set<string>();
  for (const l of fetched.links) {
    showNotesUrls.add(l.url);
    if (l.title) titles.set(l.url, l.title);
  }

  const raindropEnd = now.toISOString().slice(0, 10);
  const raindropStart = new Date(now.getTime() - raindropLookback * 86400000).toISOString().slice(0, 10);
  let raindropRecords: RaindropRecord[] = [];
  try {
    raindropRecords = fetchRaindropHistory(RAINDROP_TAG[show], raindropStart, raindropEnd);
  } catch (err) {
    console.warn(`[harvest] raindrop-history failed: ${(err as Error).message} — proceeding without weak positives`);
  }
  const raindropUrls = new Set(raindropRecords.map(r => r.url));
  for (const r of raindropRecords) {
    if (!titles.has(r.url) && r.title) titles.set(r.url, r.title);
  }

  const archiveCutoff = new Date(now.getTime() - archiveLookback * 86400000);
  const recent = archive.getStoriesInWindow(archiveCutoff, now);
  const archiveUrls = new Set<string>();
  for (const s of recent) {
    archiveUrls.add(s.url_canonical);
    if (!titles.has(s.url_canonical)) titles.set(s.url_canonical, s.title);
  }

  const assigned = assignLabels({ showNotesUrls, raindropUrls, archiveUrls, titles });
  const writes: LabeledPickInput[] = assigned.map(a => ({
    show,
    episode_date: fetched.episodeDate,
    story_url: a.url,
    story_title: a.title,
    source: a.source,
    weight: a.weight,
  }));
  const { inserted, upgraded } = labels.insertLabeledPicks(writes);

  return {
    episode_date: fetched.episodeDate,
    episode_number: fetched.episodeNumber,
    show_notes_count: showNotesUrls.size,
    raindrop_count: raindropUrls.size,
    archive_count: archiveUrls.size,
    inserted,
    upgraded,
  };
}
```

- [ ] **Step 6.4: Implement the entrypoint**

```typescript
// bin/harvest.ts
import { loadConfig } from "../src/config";
import { LabelStore } from "../src/labels";
import { ArchiveStore } from "../src/archive";
import { harvestShow } from "../src/harvest";

const SHOWS = ["twit", "mbw", "im"] as const;

async function main() {
  const show = process.argv[2];
  if (!SHOWS.includes(show as any)) {
    console.error(`usage: bun bin/harvest.ts <${SHOWS.join("|")}>`);
    process.exit(2);
  }
  const config = loadConfig();
  const labels = new LabelStore(config.storage.labels_db);
  const archive = new ArchiveStore(config.storage.archive_db);
  try {
    const result = await harvestShow(show as any, labels, archive);
    console.log(`[harvest:${show}]`, JSON.stringify(result));
  } finally {
    archive.close();
    labels.close();
  }
}

main().catch(err => {
  console.error("[harvest] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 6.5: Run unit tests, verify pass**

```bash
bun test src/harvest.test.ts
```

Expected: PASS, all 4 tests.

- [ ] **Step 6.6: Smoke test end-to-end**

```bash
cd ~/Projects/ai-briefing
RAINDROP_TOKEN=$(cat $XDG_RUNTIME_DIR/secrets/raindrop.token 2>/dev/null || echo $RAINDROP_TOKEN) \
  bun bin/harvest.ts twit
```

Expected: a JSON line summary like `[harvest:twit] {"episode_date":"2026-04-26","episode_number":1081,"show_notes_count":27,"raindrop_count":15,"archive_count":300,"inserted":314,"upgraded":12}`. Counts will vary.

If RAINDROP_TOKEN isn't set, the harvest still runs but logs a warning and proceeds without weak positives — verify that path works too.

- [ ] **Step 6.7: Commit**

```bash
git add src/harvest.ts src/harvest.test.ts bin/harvest.ts
git commit -m "feat(harvest): orchestrate show-notes + raindrop into labels.db"
```

---

## Task 7: Python Sidecar — Train Mode

A `uv`-managed Python script that loads picks from `labels.db`, embeds titles via sentence-transformers, trains a logistic-regression classifier, and writes a model artifact.

**Files:**
- Create: `pyproject.toml`
- Create: `bin/train.py`
- Create: `bin/test_train.py` (pytest)

- [ ] **Step 7.1: Create `pyproject.toml`**

```toml
[project]
name = "ai-briefing-classifier"
version = "0.1.0"
description = "Per-show classifier for ai-briefing"
requires-python = ">=3.11"
dependencies = [
  "sentence-transformers==3.4.1",
  "scikit-learn==1.6.1",
  "numpy==2.2.4",
  "joblib==1.4.2",
]

[dependency-groups]
dev = ["pytest==8.3.5"]
```

- [ ] **Step 7.2: Initialize uv and install deps**

```bash
cd ~/Projects/ai-briefing
uv sync
```

Expected: creates `.venv/`, installs sentence-transformers + sklearn + numpy + joblib + pytest. May download the embedding model lazily on first use.

- [ ] **Step 7.3: Write the failing test**

```python
# bin/test_train.py
import json
import os
import subprocess
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).parent.parent

def make_test_db(path: Path) -> None:
    """Create a labels.db with the schema we expect, populated with a tiny dataset."""
    conn = sqlite3.connect(path)
    conn.executescript(open(ROOT / "src/migrations/002_labels.sql").read())
    conn.executescript(open(ROOT / "src/migrations/003_labels_weight_source.sql").read())
    conn.executescript("INSERT INTO _migrations (id, applied_at) VALUES (0, '');")
    conn.executescript("INSERT INTO _migrations (id, applied_at) VALUES (1, '');")
    rows = []
    # Strong positives — Anthropic / Claude stories
    for i in range(8):
        rows.append(("twit", "2026-04-26", f"https://example.com/anthropic-{i}",
                     f"Anthropic announces new Claude feature {i}", "show_notes", 1.0))
    # Weak positives
    for i in range(4):
        rows.append(("twit", "2026-04-26", f"https://example.com/raindrop-{i}",
                     f"Apple Vision Pro story {i}", "raindrop", 0.5))
    # Negatives — sports/celebrity (clearly off-topic)
    for i in range(20):
        rows.append(("twit", "2026-04-26", f"https://example.com/neg-{i}",
                     f"Celebrity gossip story {i}", "negative", 1.0))
    conn.executemany(
        "INSERT INTO picks (show, episode_date, story_url, story_title, source, weight, scraped_at) "
        "VALUES (?, ?, ?, ?, ?, ?, '')",
        rows
    )
    conn.commit()
    conn.close()

def test_train_writes_model_artifact():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "labels.db"
        model_dir = Path(tmp) / "models"
        make_test_db(db)
        result = subprocess.run(
            ["uv", "run", "python", str(ROOT / "bin/train.py"),
             "--train", "--show", "twit",
             "--labels-db", str(db),
             "--model-dir", str(model_dir),
             "--no-eval"],  # skip eval report for the unit test
            capture_output=True, text=True, cwd=ROOT,
        )
        assert result.returncode == 0, result.stderr
        assert (model_dir / "twit.pkl").exists()
        # Output is one JSON summary on stdout
        summary = json.loads(result.stdout.strip().splitlines()[-1])
        assert summary["show"] == "twit"
        assert summary["positives"] >= 8
```

- [ ] **Step 7.4: Run, verify failure**

```bash
cd ~/Projects/ai-briefing
uv run pytest bin/test_train.py -v
```

Expected: FAIL — `bin/train.py` doesn't exist.

- [ ] **Step 7.5: Implement `bin/train.py` (train mode only for now)**

```python
#!/usr/bin/env python3
"""Per-show classifier trainer/scorer for ai-briefing.

Modes:
  --train  Read picks from labels.db, embed titles, train logistic regression,
           write model to <model-dir>/<show>.pkl. Optionally write an eval
           report.
  --score  Read JSON candidates from stdin, emit JSON scores on stdout.
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_score

EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
HOLDOUT_DAYS = 14

def load_picks(db_path: Path, show: str) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT story_url, story_title, source, weight, episode_date "
        "FROM picks WHERE show = ? AND story_title IS NOT NULL",
        (show,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def make_xy(picks: list[dict], embedder: SentenceTransformer):
    titles = [p["story_title"] for p in picks]
    if not titles:
        return None, None, None
    X = embedder.encode(titles, show_progress_bar=False, normalize_embeddings=True)
    y = np.array([1 if p["source"] in ("show_notes", "raindrop") else 0 for p in picks])
    w = np.array([p["weight"] for p in picks])
    return X, y, w

def train(args):
    embedder = SentenceTransformer(EMBEDDING_MODEL)
    picks = load_picks(args.labels_db, args.show)

    holdout_cutoff = None
    if not args.no_eval and len(picks) >= 30:
        # Hold out the last HOLDOUT_DAYS for evaluation
        dates = sorted({p["episode_date"] for p in picks})
        if len(dates) >= 2:
            holdout_cutoff = dates[-1]  # most recent episode date

    train_picks = [p for p in picks if p["episode_date"] != holdout_cutoff] if holdout_cutoff else picks
    holdout_picks = [p for p in picks if p["episode_date"] == holdout_cutoff] if holdout_cutoff else []

    X, y, w = make_xy(train_picks, embedder)
    if X is None or len(set(y)) < 2:
        summary = {"show": args.show, "trained": False, "reason": "insufficient label diversity"}
        print(json.dumps(summary))
        sys.exit(0)

    clf = LogisticRegression(class_weight="balanced", max_iter=1000)
    clf.fit(X, y, sample_weight=w)

    args.model_dir.mkdir(parents=True, exist_ok=True)
    artifact = {"clf": clf, "embedding_model": EMBEDDING_MODEL, "trained_at": datetime.utcnow().isoformat()}
    tmp = args.model_dir / f"{args.show}.pkl.tmp"
    final = args.model_dir / f"{args.show}.pkl"
    joblib.dump(artifact, tmp)
    tmp.replace(final)

    summary = {
        "show": args.show, "trained": True,
        "positives": int((y == 1).sum()), "negatives": int((y == 0).sum()),
        "train_size": len(train_picks),
        "holdout_episode_date": holdout_cutoff,
        "holdout_size": len(holdout_picks),
    }

    if holdout_picks and not args.no_eval:
        Xh, yh, _ = make_xy(holdout_picks, embedder)
        scores = clf.predict_proba(Xh)[:, 1]
        # recall@40: assume the briefing always shortlists 40, so for
        # the holdout we approximate with: top-40 of holdout candidates
        # by score, what fraction are positives?
        if len(scores) > 0:
            order = np.argsort(-scores)
            top_k = min(40, len(scores))
            picked = order[:top_k]
            recall_at_k = float(yh[picked].sum() / max(1, yh.sum())) if yh.sum() > 0 else 0.0
            summary["recall_at_40"] = round(recall_at_k, 3)

    print(json.dumps(summary))

def score(args):
    raise NotImplementedError("--score implemented in a later task")

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--train", action="store_true")
    p.add_argument("--score", action="store_true")
    p.add_argument("--show", required=True, choices=["twit", "mbw", "im"])
    p.add_argument("--labels-db", type=Path, default=Path.home() / ".local/share/ai-briefing/labels.db")
    p.add_argument("--model-dir", type=Path, default=Path.home() / ".local/share/ai-briefing/models")
    p.add_argument("--no-eval", action="store_true")
    args = p.parse_args()
    if args.train:
        train(args)
    elif args.score:
        score(args)
    else:
        p.error("must pass --train or --score")

if __name__ == "__main__":
    main()
```

- [ ] **Step 7.6: Run the test**

```bash
cd ~/Projects/ai-briefing
uv run pytest bin/test_train.py -v
```

Expected: PASS. The first run downloads the embedding model (~22MB) and may take a minute; subsequent runs are fast.

- [ ] **Step 7.7: Commit**

```bash
git add pyproject.toml uv.lock bin/train.py bin/test_train.py
git commit -m "feat(classifier): Python sidecar with --train mode"
```

---

## Task 8: Python Sidecar — Score Mode

Add the inference path: read JSON candidates from stdin, return scores.

**Files:**
- Modify: `bin/train.py` (replace the `score` stub)
- Modify: `bin/test_train.py` (add score-mode test)

- [ ] **Step 8.1: Write the failing test**

Append to `bin/test_train.py`:

```python
def test_score_returns_probabilities():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "labels.db"
        model_dir = Path(tmp) / "models"
        make_test_db(db)
        # Train first
        subprocess.run(
            ["uv", "run", "python", str(ROOT / "bin/train.py"),
             "--train", "--show", "twit",
             "--labels-db", str(db), "--model-dir", str(model_dir), "--no-eval"],
            check=True, cwd=ROOT, capture_output=True,
        )
        # Score
        candidates = [
            {"url": "https://example.com/anthropic-new", "title": "Anthropic releases Claude 5"},
            {"url": "https://example.com/celeb", "title": "Kardashian wedding goes viral"},
        ]
        result = subprocess.run(
            ["uv", "run", "python", str(ROOT / "bin/train.py"),
             "--score", "--show", "twit", "--model-dir", str(model_dir)],
            input=json.dumps(candidates), capture_output=True, text=True, cwd=ROOT,
        )
        assert result.returncode == 0, result.stderr
        scores = json.loads(result.stdout)
        assert len(scores) == 2
        for s in scores:
            assert 0.0 <= s["score"] <= 1.0
        # The Anthropic story should outscore the gossip
        anthropic = next(s for s in scores if "anthropic" in s["url"])
        gossip = next(s for s in scores if "celeb" in s["url"])
        assert anthropic["score"] > gossip["score"], (
            f"expected Anthropic > celebrity, got {anthropic['score']} vs {gossip['score']}"
        )
```

- [ ] **Step 8.2: Run, verify failure**

```bash
uv run pytest bin/test_train.py::test_score_returns_probabilities -v
```

Expected: FAIL — `score` raises `NotImplementedError`.

- [ ] **Step 8.3: Implement `score` in `bin/train.py`**

Replace the `score` function and update the import block at the top:

```python
def score(args):
    artifact_path = args.model_dir / f"{args.show}.pkl"
    if not artifact_path.exists():
        # No model yet — emit zero scores so the caller falls back gracefully
        candidates = json.load(sys.stdin)
        out = [{"url": c["url"], "score": 0.0} for c in candidates]
        print(json.dumps(out))
        return
    artifact = joblib.load(artifact_path)
    clf = artifact["clf"]
    embedder = SentenceTransformer(artifact["embedding_model"])
    candidates = json.load(sys.stdin)
    if not candidates:
        print(json.dumps([]))
        return
    titles = [c.get("title") or c.get("url") for c in candidates]
    X = embedder.encode(titles, show_progress_bar=False, normalize_embeddings=True)
    probs = clf.predict_proba(X)[:, 1]
    out = [{"url": c["url"], "score": float(p)} for c, p in zip(candidates, probs)]
    print(json.dumps(out))
```

- [ ] **Step 8.4: Run the test**

```bash
uv run pytest bin/test_train.py::test_score_returns_probabilities -v
```

Expected: PASS. The Anthropic-themed candidate should score higher than the celebrity-themed one (though absolute scores will be modest given the tiny training set).

- [ ] **Step 8.5: Run all Python tests + smoke test from CLI**

```bash
uv run pytest bin/test_train.py -v
echo '[{"url":"https://example.com/x","title":"Anthropic shipped Claude 5"}]' | \
  uv run python bin/train.py --score --show twit --model-dir /tmp/no-such-dir
```

Expected: tests PASS. Smoke test prints `[{"url": "https://example.com/x", "score": 0.0}]` (because the model dir is empty, demonstrating graceful no-model fallback).

- [ ] **Step 8.6: Commit**

```bash
git add bin/train.py bin/test_train.py
git commit -m "feat(classifier): --score mode with empty-model fallback"
```

---

## Task 9: Pipeline Integration — Pre-Filter in `src/index.ts`

Insert the classifier between `clusterStories` and `scoreCluster`. For each show, take the top-40 clusters by classifier probability; the union of those three sets is what Haiku scores.

**Files:**
- Create: `src/classifier.ts`, `src/classifier.test.ts`
- Modify: `src/index.ts`
- Modify: `config.yaml` (add `classifier:` section)
- Modify: `src/config.ts` (add type for the new section)

- [ ] **Step 9.1: Add config section**

Append to `config.yaml`:

```yaml
classifier:
  enabled: true
  model_dir: "~/.local/share/ai-briefing/models"
  shortlist_size: 40
  fallback_recall_threshold: 0.80
```

In `src/types.ts` (or wherever `Config` is defined; check `src/config.ts`), add:

```typescript
export interface ClassifierConfig {
  enabled: boolean;
  model_dir: string;
  shortlist_size: number;
  fallback_recall_threshold: number;
}
```

Add `classifier: ClassifierConfig` to the `Config` interface and default loading.

- [ ] **Step 9.2: Write the failing classifier-wrapper test**

```typescript
// src/classifier.test.ts
import { test, expect } from "bun:test";
import { scoreClustersForShow, shortlistByScore } from "./classifier";

test("shortlistByScore returns top-K cluster indices by score", () => {
  const scores = [
    { idx: 0, score: 0.1 },
    { idx: 1, score: 0.9 },
    { idx: 2, score: 0.5 },
    { idx: 3, score: 0.7 },
  ];
  const top2 = shortlistByScore(scores, 2);
  expect(top2.sort()).toEqual([1, 3]);
});

test("shortlistByScore with K >= len returns all", () => {
  const scores = [{ idx: 0, score: 0.5 }];
  expect(shortlistByScore(scores, 10)).toEqual([0]);
});
```

- [ ] **Step 9.3: Run, verify failure**

```bash
bun test src/classifier.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 9.4: Implement the classifier wrapper**

```typescript
// src/classifier.ts
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { StoryRow } from "./archive";
import type { Show } from "./labels";
import type { ClassifierConfig } from "./types";

const TRAIN_PY = join(import.meta.dir, "..", "bin", "train.py");

export interface ClusterScore {
  idx: number;
  score: number;
}

export interface ClusterCandidate {
  url: string;
  title: string;
}

/**
 * Score every cluster for one show via the Python sidecar.
 * Returns ClusterScore[] in the same order as the input clusters.
 * If the model artifact is missing, returns all zeros (caller treats as
 * "classifier unavailable, score everything").
 */
export function scoreClustersForShow(
  clusters: StoryRow[][],
  show: Show,
  config: ClassifierConfig
): ClusterScore[] {
  const modelPath = join(expandHome(config.model_dir), `${show}.pkl`);
  if (!existsSync(modelPath)) {
    return clusters.map((_, idx) => ({ idx, score: 0.0 }));
  }
  // Pick the first story in each cluster as the canonical representative.
  const candidates: ClusterCandidate[] = clusters.map(c => ({
    url: c[0].url_canonical,
    title: c[0].title,
  }));
  const result = spawnSync(
    "uv",
    ["run", "python", TRAIN_PY, "--score", "--show", show, "--model-dir", expandHome(config.model_dir)],
    { input: JSON.stringify(candidates), encoding: "utf-8", timeout: 60000 }
  );
  if (result.status !== 0) {
    console.warn(`[classifier:${show}] failed (${result.status}): ${result.stderr}`);
    return clusters.map((_, idx) => ({ idx, score: 0.0 }));
  }
  const raw = JSON.parse(result.stdout) as Array<{ url: string; score: number }>;
  return raw.map((r, idx) => ({ idx, score: r.score }));
}

export function shortlistByScore(scores: ClusterScore[], k: number): number[] {
  return [...scores]
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(s => s.idx);
}

function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace("~", process.env.HOME ?? "") : p;
}
```

- [ ] **Step 9.5: Run tests**

```bash
bun test src/classifier.test.ts
```

Expected: PASS, both tests.

- [ ] **Step 9.6: Wire into `src/index.ts`**

Locate the cluster→score block (around lines 116-128 of `src/index.ts`). Replace this section:

```typescript
    // 4. Cluster by topic
    const clusters = clusterStories(recent, config.pipeline.cluster_threshold);
    console.log(`[tech-briefing] ${clusters.length} topic clusters`);

    // 5. Score each cluster via Claude Haiku
    const scored: ScoredCluster[] = [];
    for (const cluster of clusters) {
      const scoring = await scoreCluster(cluster, labels, {
        model: config.claude.model,
        max_tokens: config.claude.max_tokens,
        few_shot_k: config.claude.few_shot_k,
      });
      if (scoring) scored.push({ cluster, scoring });
    }
    console.log(`[tech-briefing] scored ${scored.length}/${clusters.length} clusters`);
```

With:

```typescript
    // 4. Cluster by topic
    const clusters = clusterStories(recent, config.pipeline.cluster_threshold);
    console.log(`[tech-briefing] ${clusters.length} topic clusters`);

    // 4b. Per-show classifier pre-filter
    let toScore: number[] = clusters.map((_, i) => i);
    if (config.classifier.enabled) {
      const showsToFilter: Show[] = ["twit", "mbw", "im"];
      const shortlist = new Set<number>();
      for (const show of showsToFilter) {
        const scores = scoreClustersForShow(clusters, show, config.classifier);
        for (const idx of shortlistByScore(scores, config.classifier.shortlist_size)) {
          shortlist.add(idx);
        }
      }
      toScore = [...shortlist].sort((a, b) => a - b);
      console.log(
        `[tech-briefing] classifier shortlist: ${toScore.length}/${clusters.length} clusters (union of top-${config.classifier.shortlist_size} per show)`
      );
    }

    // 5. Score each cluster via Claude Haiku (only the shortlist)
    const scored: ScoredCluster[] = [];
    for (const idx of toScore) {
      const cluster = clusters[idx];
      const scoring = await scoreCluster(cluster, labels, {
        model: config.claude.model,
        max_tokens: config.claude.max_tokens,
        few_shot_k: config.claude.few_shot_k,
      });
      if (scoring) scored.push({ cluster, scoring });
    }
    console.log(`[tech-briefing] scored ${scored.length}/${toScore.length} clusters via Haiku`);
```

Add the necessary imports at the top of `src/index.ts`:

```typescript
import { scoreClustersForShow, shortlistByScore } from "./classifier";
import type { Show } from "./labels";
```

- [ ] **Step 9.7: Test the integration end-to-end**

With no model artifacts in place yet, the classifier returns all zeros and the shortlist is the first 40 clusters per show (essentially arbitrary), but the pipeline should still complete:

```bash
cd ~/Projects/ai-briefing
bun src/index.ts 2>&1 | grep -E '\[tech-briefing\]'
```

Expected: pipeline runs, includes `[tech-briefing] classifier shortlist: ...` line, and produces a briefing without crashing. Verify the output `.md` exists in `~/Obsidian/lgl/AI/News/2026/04/`.

If you want to test with `classifier.enabled: false` to verify the un-shortlisted path still works, flip the config and re-run.

- [ ] **Step 9.8: Commit**

```bash
git add config.yaml src/types.ts src/config.ts src/classifier.ts \
        src/classifier.test.ts src/index.ts
git commit -m "feat(pipeline): per-show classifier pre-filter before Haiku"
```

---

## Task 10: Initial Seeding Script

A one-shot script that runs `harvestShow` for each show across the Phase A window, then triggers the trainer for each show. Idempotent.

**Files:**
- Create: `bin/seed.ts`

- [ ] **Step 10.1: Implement `bin/seed.ts`**

```typescript
// bin/seed.ts
import { spawnSync } from "child_process";
import { join } from "path";
import { loadConfig } from "../src/config";
import { LabelStore } from "../src/labels";
import { ArchiveStore } from "../src/archive";
import { harvestShow } from "../src/harvest";
import type { Show } from "../src/labels";

const SHOWS: Show[] = ["twit", "mbw", "im"];
const TRAIN_PY = join(import.meta.dir, "..", "bin", "train.py");

async function main() {
  const config = loadConfig();
  const labels = new LabelStore(config.storage.labels_db);
  const archive = new ArchiveStore(config.storage.archive_db);
  try {
    for (const show of SHOWS) {
      console.log(`\n=== seeding ${show} ===`);
      const result = await harvestShow(show, labels, archive);
      if ("error" in result) {
        console.error(`[seed:${show}] harvest failed: ${result.error}`);
        continue;
      }
      console.log(`[seed:${show}] harvest:`, JSON.stringify(result));

      const train = spawnSync("uv", [
        "run", "python", TRAIN_PY,
        "--train", "--show", show,
        "--labels-db", config.storage.labels_db,
        "--model-dir", config.classifier.model_dir.replace("~", process.env.HOME ?? ""),
      ], { encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] });

      if (train.status !== 0) {
        console.error(`[seed:${show}] train exit ${train.status}`);
        continue;
      }
      const summary = (train.stdout || "").trim().split("\n").pop() || "{}";
      console.log(`[seed:${show}] train:`, summary);
    }
  } finally {
    archive.close();
    labels.close();
  }
}

main().catch(err => {
  console.error("[seed] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 10.2: Run the seed script**

```bash
cd ~/Projects/ai-briefing
bun bin/seed.ts
```

Expected output sketch:

```
=== seeding twit ===
[seed:twit] harvest: {"episode_date":"2026-04-26",...,"inserted":314,"upgraded":0}
[seed:twit] train: {"show":"twit","trained":true,"positives":27,"negatives":287,...}

=== seeding mbw ===
[seed:mbw] harvest: {...}
[seed:mbw] train: {...}

=== seeding im ===
[seed:im] harvest: {...}
[seed:im] train: {...}
```

Verify model artifacts exist:

```bash
ls -la ~/.local/share/ai-briefing/models/
```

Expected: `twit.pkl`, `mbw.pkl`, `im.pkl`.

- [ ] **Step 10.3: Re-run to verify idempotency**

```bash
bun bin/seed.ts
```

Expected: harvest results show `inserted: 0` (already in DB) and possibly some `upgraded` count if any URLs changed source tier; train results identical.

- [ ] **Step 10.4: Commit**

```bash
git add bin/seed.ts
git commit -m "feat(seed): one-shot Phase A seeding for all three shows"
```

---

## Task 11: Eval Reports + Rolling-Recall Safety Net

Per-show eval reports written after each retrain, and the `rollingRecall4w` function used by `src/index.ts` to fall back to Haiku-only mode when the classifier degrades.

**Files:**
- Create: `src/eval.ts`, `src/eval.test.ts`
- Modify: `bin/train.py` (write eval report when training completes)
- Modify: `src/classifier.ts` (consult `rollingRecall4w` before pre-filtering)

- [ ] **Step 11.1: Write the failing test**

```typescript
// src/eval.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rollingRecall4w } from "./eval";

const TMP = join(tmpdir(), "ai-briefing-eval-test");

beforeEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });
});

test("rollingRecall4w returns null with no eval reports", () => {
  expect(rollingRecall4w("twit", TMP)).toBeNull();
});

test("rollingRecall4w averages recall_at_40 across reports in last 28 days", () => {
  const today = new Date();
  const day = (offset: number) => {
    const d = new Date(today.getTime() - offset * 86400000);
    return d.toISOString().slice(0, 10);
  };
  // 4 reports at varying ages; only the last 28 days count.
  writeFileSync(join(TMP, `${day(2)}-twit.md`), `recall_at_40: 0.90\n`);
  writeFileSync(join(TMP, `${day(8)}-twit.md`), `recall_at_40: 0.85\n`);
  writeFileSync(join(TMP, `${day(20)}-twit.md`), `recall_at_40: 0.80\n`);
  writeFileSync(join(TMP, `${day(40)}-twit.md`), `recall_at_40: 0.50\n`); // too old, ignored
  const r = rollingRecall4w("twit", TMP);
  expect(r).toBeCloseTo((0.9 + 0.85 + 0.8) / 3, 3);
});

test("rollingRecall4w only considers files for the requested show", () => {
  writeFileSync(join(TMP, "2026-04-25-twit.md"), `recall_at_40: 0.90\n`);
  writeFileSync(join(TMP, "2026-04-25-mbw.md"), `recall_at_40: 0.10\n`);
  const r = rollingRecall4w("twit", TMP);
  expect(r).toBeCloseTo(0.90, 3);
});
```

- [ ] **Step 11.2: Run, verify failure**

```bash
bun test src/eval.test.ts
```

Expected: FAIL — `rollingRecall4w` doesn't exist.

- [ ] **Step 11.3: Implement `src/eval.ts`**

```typescript
// src/eval.ts
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Show } from "./labels";

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(twit|mbw|im)\.md$/;
const RECALL_LINE_RE = /recall_at_40:\s*([0-9.]+)/i;

/**
 * Average recall_at_40 across eval reports for the given show that were
 * written in the last 28 days. Returns null if no reports exist in the window.
 */
export function rollingRecall4w(show: Show, evalDir: string): number | null {
  if (!existsSync(evalDir)) return null;
  const cutoff = new Date(Date.now() - 28 * 86400000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const recalls: number[] = [];
  for (const name of readdirSync(evalDir)) {
    const m = FILENAME_RE.exec(name);
    if (!m) continue;
    if (m[2] !== show) continue;
    if (m[1] < cutoffStr) continue;
    const text = readFileSync(join(evalDir, name), "utf-8");
    const r = RECALL_LINE_RE.exec(text);
    if (r) recalls.push(parseFloat(r[1]));
  }
  if (recalls.length === 0) return null;
  return recalls.reduce((a, b) => a + b, 0) / recalls.length;
}

export interface EvalReport {
  show: Show;
  episodeDate: string;
  recallAt40: number;
  precisionAtN: number | null;
  showNotesUrls: string[];
  missed: Array<{ url: string; diagnosis: string }>;
}

export function writeEvalReport(report: EvalReport, evalDir: string): string {
  mkdirSync(evalDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const path = join(evalDir, `${today}-${report.show}.md`);
  const body = [
    `# ${report.show.toUpperCase()} classifier eval — ${report.episodeDate}`,
    ``,
    `Trained on: ${today}`,
    ``,
    `recall_at_40: ${report.recallAt40.toFixed(3)}`,
    `precision_at_n: ${report.precisionAtN === null ? "n/a" : report.precisionAtN.toFixed(3)}`,
    ``,
    `Show-notes URLs (${report.showNotesUrls.length}):`,
    ...report.showNotesUrls.map(u => `- ${u}`),
    ``,
    `Missed (${report.missed.length}):`,
    ...report.missed.map(m => `- ${m.url} — ${m.diagnosis}`),
    ``,
  ].join("\n");
  writeFileSync(path, body);
  return path;
}
```

- [ ] **Step 11.4: Run, verify pass**

```bash
bun test src/eval.test.ts
```

Expected: PASS, all 3 tests.

- [ ] **Step 11.5: Wire `rollingRecall4w` into the classifier wrapper**

In `src/classifier.ts`, change `scoreClustersForShow` to first consult the rolling recall and short-circuit if the safety net trips. Add the import and a parameter:

```typescript
import { rollingRecall4w } from "./eval";
```

Modify the function signature and body:

```typescript
export function scoreClustersForShow(
  clusters: StoryRow[][],
  show: Show,
  config: ClassifierConfig,
  evalDir: string
): ClusterScore[] {
  const recall = rollingRecall4w(show, evalDir);
  if (recall !== null && recall < config.fallback_recall_threshold) {
    console.warn(
      `[classifier:${show}] 4-week recall@40 ${recall.toFixed(3)} below ${config.fallback_recall_threshold} — falling back to Haiku-only`
    );
    return clusters.map((_, idx) => ({ idx, score: 0.0 }));
  }
  // ... rest unchanged
```

In `src/index.ts`, pass the eval dir from config (add a `classifier.eval_dir` field or derive from output path):

```yaml
# config.yaml
classifier:
  enabled: true
  model_dir: "~/.local/share/ai-briefing/models"
  eval_dir: "~/Obsidian/lgl/AI/News/eval"
  shortlist_size: 40
  fallback_recall_threshold: 0.80
```

Update the `ClassifierConfig` type and the call site in `src/index.ts`:

```typescript
const scores = scoreClustersForShow(clusters, show, config.classifier, expandHome(config.classifier.eval_dir));
```

(Use the same `expandHome` helper as in classifier.ts; either re-export it or duplicate the 1-liner.)

- [ ] **Step 11.6: Wire eval-report writing into `bin/train.py`**

In `bin/train.py`, replace the `train` function's eval block (after `summary["recall_at_40"] = ...`) with a call that also writes the markdown report:

```python
        # ... existing recall_at_k computation ...
        if not args.no_eval and args.eval_dir:
            eval_dir = args.eval_dir
            eval_dir.mkdir(parents=True, exist_ok=True)
            today = datetime.utcnow().date().isoformat()
            report_path = eval_dir / f"{today}-{args.show}.md"

            picked_set = set(int(i) for i in picked)
            holdout_positives = [holdout_picks[i] for i in range(len(holdout_picks)) if yh[i] == 1]
            shortlisted_positives = [
                holdout_picks[i] for i in range(len(holdout_picks))
                if yh[i] == 1 and i in picked_set
            ]
            missed = [p for p in holdout_positives if p not in shortlisted_positives]

            lines = [
                f"# {args.show.upper()} classifier eval — episode {holdout_cutoff}",
                "",
                f"Trained on: {today}",
                "",
                f"recall_at_40: {recall_at_k:.3f}",
                f"holdout_positives: {int(yh.sum())}",
                "",
                "Missed:",
            ]
            for p in missed[:20]:
                lines.append(f"- {p['story_url']} — {p['story_title']}")
            report_path.write_text("\n".join(lines) + "\n")
            summary["eval_report"] = str(report_path)
```

Add the `--eval-dir` argument:

```python
p.add_argument("--eval-dir", type=Path, default=None)
```

And pass it from `bin/seed.ts` and the harvest entry (Task 12 will set this up via systemd).

- [ ] **Step 11.7: Re-run seed to populate eval reports**

```bash
cd ~/Projects/ai-briefing
bun bin/seed.ts  # Note: still uses default no-eval; re-run with eval next
EVAL_DIR=~/Obsidian/lgl/AI/News/eval
mkdir -p $EVAL_DIR
for show in twit mbw im; do
  uv run python bin/train.py --train --show $show \
    --labels-db ~/.local/share/ai-briefing/labels.db \
    --model-dir ~/.local/share/ai-briefing/models \
    --eval-dir $EVAL_DIR
done
ls $EVAL_DIR
```

Expected: 3 markdown files in the eval dir, named `YYYY-MM-DD-<show>.md`.

- [ ] **Step 11.8: Commit**

```bash
git add src/eval.ts src/eval.test.ts src/classifier.ts src/index.ts \
        config.yaml src/types.ts bin/train.py
git commit -m "feat(eval): rolling recall safety net + per-retrain eval reports"
```

---

## Task 12: Systemd Timers and Units

Three timers — one per show — that fire after each show airs and the editors publish. Each runs the harvest + retrain pipeline.

**Files:**
- Create: `~/.config/systemd/user/ai-briefing-harvest@.service`
- Create: `~/.config/systemd/user/ai-briefing-harvest-twit.timer`
- Create: `~/.config/systemd/user/ai-briefing-harvest-mbw.timer`
- Create: `~/.config/systemd/user/ai-briefing-harvest-im.timer`
- Create: `bin/harvest-and-retrain.sh` (the script the unit calls)

- [ ] **Step 12.1: Write the harvest+retrain wrapper script**

```bash
# bin/harvest-and-retrain.sh
#!/usr/bin/env bash
# Usage: harvest-and-retrain.sh <show>   (show ∈ twit|mbw|im)
set -euo pipefail

SHOW="${1:?usage: harvest-and-retrain.sh <show>}"
PROJECT="$HOME/Projects/ai-briefing"
LABELS_DB="$HOME/.local/share/ai-briefing/labels.db"
MODEL_DIR="$HOME/.local/share/ai-briefing/models"
EVAL_DIR="$HOME/Obsidian/lgl/AI/News/eval"

cd "$PROJECT"

echo "[$(date -Is)] harvesting $SHOW"
bun bin/harvest.ts "$SHOW"

echo "[$(date -Is)] retraining $SHOW"
uv run python bin/train.py --train --show "$SHOW" \
  --labels-db "$LABELS_DB" \
  --model-dir "$MODEL_DIR" \
  --eval-dir "$EVAL_DIR"

# Voice the result. Source: ~/.claude/rules/voice-summary.md
RECALL=$(grep -m1 'recall_at_40' "$EVAL_DIR/$(date +%F)-$SHOW.md" 2>/dev/null | awk '{print $2}' || echo "n/a")
curl -s -X POST http://localhost:8888/notify \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Classifier retrained\",\"message\":\"$SHOW classifier retrained, recall@40 $RECALL\",\"voice\":true,\"name\":\"main\"}" \
  >/dev/null || true
```

```bash
chmod +x bin/harvest-and-retrain.sh
```

- [ ] **Step 12.2: Test the wrapper script directly**

```bash
~/Projects/ai-briefing/bin/harvest-and-retrain.sh twit
```

Expected: harvests TWiT, retrains, writes the eval report, voices a summary. Exit 0.

- [ ] **Step 12.3: Create the templated service unit**

```ini
# ~/.config/systemd/user/ai-briefing-harvest@.service
[Unit]
Description=AI briefing harvest + retrain for show %i
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=%t/secrets/ai-briefing.env
EnvironmentFile=-%t/secrets/raindrop.env
Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=%h/Projects/ai-briefing/bin/harvest-and-retrain.sh %i
TimeoutStartSec=600
```

The `-` before the second `EnvironmentFile` makes it optional in case `raindrop.env` lives elsewhere. Confirm where `RAINDROP_TOKEN` actually comes from on Leo's system before finalizing — the existing `raindrop-briefing` setup will tell you.

- [ ] **Step 12.4: Create the three timers**

```ini
# ~/.config/systemd/user/ai-briefing-harvest-twit.timer
[Unit]
Description=Harvest TWiT show notes (Mon 10:00, after Sunday airing)

[Timer]
OnCalendar=Mon *-*-* 10:00:00
Persistent=true
Unit=ai-briefing-harvest@twit.service

[Install]
WantedBy=timers.target
```

```ini
# ~/.config/systemd/user/ai-briefing-harvest-mbw.timer
[Unit]
Description=Harvest MBW show notes (Wed 10:00, after Tuesday airing)

[Timer]
OnCalendar=Wed *-*-* 10:00:00
Persistent=true
Unit=ai-briefing-harvest@mbw.service

[Install]
WantedBy=timers.target
```

```ini
# ~/.config/systemd/user/ai-briefing-harvest-im.timer
[Unit]
Description=Harvest IM show notes (Thu 10:00, after Wednesday airing)

[Timer]
OnCalendar=Thu *-*-* 10:00:00
Persistent=true
Unit=ai-briefing-harvest@im.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 12.5: Reload, enable, start the timers**

```bash
systemctl --user daemon-reload
systemctl --user enable --now ai-briefing-harvest-twit.timer \
                              ai-briefing-harvest-mbw.timer \
                              ai-briefing-harvest-im.timer
systemctl --user list-timers ai-briefing-harvest-*
```

Expected: three timers listed, with NEXT firing at the appropriate Mon/Wed/Thu 10:00.

- [ ] **Step 12.6: Trigger one immediately and watch the journal**

```bash
systemctl --user start ai-briefing-harvest@twit.service
journalctl --user -u 'ai-briefing-harvest@twit.service' -n 30 --no-pager
```

Expected: harvest log, retrain log, voice notification fires. Exit 0. Eval report appears in `~/Obsidian/lgl/AI/News/eval/`.

- [ ] **Step 12.7: Commit**

```bash
cd ~/Projects/ai-briefing
git add bin/harvest-and-retrain.sh
git commit -m "feat(systemd): harvest+retrain wrapper script"
```

The systemd units themselves live in `~/.config/systemd/user/` and aren't part of this repo. If they're tracked elsewhere (e.g. `~/.claude` or a dotfiles repo), commit them there separately.

---

## Self-Review

After writing this plan, sanity-checking against the spec:

**Spec coverage:**
- Show-notes harvester → Task 2 (scraper) + Task 5 (fetcher) ✓
- Label store extension (`weight`, `source` columns) → Task 1 ✓
- Raindrop reader (Go binary) → Tasks 3 + 4 ✓
- Trainer (Python sidecar, --train and --score) → Tasks 7 + 8 ✓
- Pipeline integration (pre-filter in src/index.ts) → Task 9 ✓
- Cadence (3 systemd timers) → Task 12 ✓
- Initial seeding (`bin/seed.ts`) → Task 10 ✓
- Eval reports + safety net → Task 11 ✓
- Aggregator pubDate stash prereq → Task 0 ✓
- URL canonicalization refactor → not needed; already exported ✓

**Type consistency:**
- `Show` type used consistently as `"twit" | "mbw" | "im"`
- `PickSource` used in labels.ts and harvest.ts
- `ClusterScore` defined in classifier.ts and used in index.ts
- `expandHome` helper duplicated in classifier.ts and index.ts — acceptable; if it grows, promote to a util

**Placeholder scan:**
- `<MODULE_NAME>` placeholders in Task 3 + 4 main.go files — these are intentional, with explicit instructions to replace from go.mod inspection
- Otherwise no TBDs, no "implement later", no "similar to Task N"

**Task ordering:**
- Each task only depends on previously-completed tasks
- Tasks 0, 1, 2 are independent and could run in parallel by different agents
- Tasks 3 + 4 are sequential (Go restructure before new binary)
- Task 5 depends on Task 4 (raindrop-history binary must exist for the wrapper)
- Task 6 depends on Tasks 1, 2, 5
- Tasks 7, 8 are sequential (train mode before score mode that uses the model)
- Task 9 depends on Task 8
- Task 10 depends on Tasks 6, 7, 8, 9
- Task 11 depends on Tasks 9, 10
- Task 12 depends on all prior tasks
