# Tech News Briefing — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI-only `ai-briefing` pipeline with a per-show-scored tech briefing (TWiT / MBW / IM), populated from OPML feeds over a 24-hour window, with labels ingested from local show-archive folders (`~/Documents/archive-{twit,mbw,im}/`) for future supervised training.

**Architecture:** Same systemd timer, same Obsidian output path family. Two new local SQLite databases (archive of all fetched candidates; labels from show-archive ingestion). Claude Haiku scores each topic-clustered candidate for three-show fit using few-shot examples pulled from `labels.db`. No HTTP scraping of `twit.show` — Leo saves `prepare-briefing` outputs to local archive folders, and each daily run re-ingests any new files (HTML > org > CSV priority per episode).

**Tech Stack:** Bun + TypeScript (existing), `bun:sqlite` (built-in, no new dep), `@anthropic-ai/sdk@0.82.0` (existing), systemd user timers (existing pattern).

---

## File Structure

### New files

```
src/
├── db.ts                        # Shared: open/migrate helper for bun:sqlite
├── archive.ts                   # archive.db API (insert, query-by-window)
├── labels.ts                    # labels.db API (insert picks, recent-by-show)
├── twitshow/
│   ├── parse.ts                 # HTML → Pick[] parser (regex)
│   ├── parse-org.ts             # org-mode archive parser
│   ├── parse-csv.ts             # -LINKS.csv archive parser
│   └── ingest.ts                # Read archive-{twit,mbw,im}/ dirs, dispatch to parsers (HTML > org > CSV)
├── cluster.ts                   # URL canonicalization + trigram topic clustering
├── prompt.ts                    # Few-shot prompt builder
├── scorer.ts                    # Claude Haiku cluster scoring
├── selection.ts                 # Threshold + soft-cap + "Other notable" logic
├── migrations/
│   ├── 001_archive.sql
│   └── 002_labels.sql
└── bin/
    └── ingest-archive.ts        # CLI — one-shot and as first step of daily pipeline

tests/
├── db.test.ts
├── archive.test.ts
├── labels.test.ts
├── cluster.test.ts
├── prompt.test.ts
├── scorer.test.ts
├── selection.test.ts
├── twitshow/
│   ├── parse.test.ts
│   ├── parse-org.test.ts
│   ├── parse-csv.test.ts
│   ├── ingest.test.ts
│   └── fixtures/
│       ├── twit-2026-04-19.html
│       ├── twit-2026-04-19.org
│       ├── twit-2026-04-19-LINKS.csv
│       └── im-2026-04-15.html
```

### Modified files

- `src/types.ts` — new types (`Show`, `Cluster`, `ScoredCluster`, `Pick`, `Briefing`)
- `src/config.ts` — config shape for new pipeline (`shows`, `output.path`, `claude.model`)
- `config.yaml` — replace tavily/hackernews sections, keep rss, add shows + archive_path
- `src/index.ts` — rewrite pipeline: fetch → archive → filter-24h → cluster → score → select → write
- `src/writer.ts` — per-show output format, `YYYY/MM/YYYY-MM-DD.md` path
- `tests/config.test.ts` — updated assertions
- `tests/writer.test.ts` — new per-show rendering tests

### Files removed

- `src/sources/tavily.ts` + test — Tavily queries were AI-specific
- `src/sources/hackernews.ts` + test — HN reachable via RSS from OPML
- `src/summarize.ts` + test — replaced by `scorer.ts` + `prompt.ts`
- `src/dedupe.ts` + test — replaced by `cluster.ts`

---

## Task 1: Database infrastructure (bun:sqlite + migration runner)

**Files:**
- Create: `src/db.ts`
- Create: `src/migrations/001_archive.sql`
- Create: `src/migrations/002_labels.sql`
- Create: `tests/db.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { openDb } from "../src/db";

const TMP_DB = "/tmp/ai-briefing-test-db.sqlite";

describe("openDb", () => {
  beforeEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });
  afterEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

  test("creates the file and runs the given migration", () => {
    const db = openDb(TMP_DB, ["CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)"]);
    db.prepare("INSERT INTO t (v) VALUES (?)").run("hi");
    const row = db.prepare("SELECT v FROM t WHERE id = 1").get() as { v: string };
    expect(row.v).toBe("hi");
    db.close();
  });

  test("is idempotent — re-opening doesn't re-run applied migrations", () => {
    const migs = ["CREATE TABLE t (id INTEGER PRIMARY KEY)"];
    openDb(TMP_DB, migs).close();
    const db = openDb(TMP_DB, migs);   // must not throw "table t already exists"
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Projects/ai-briefing && bun test tests/db.test.ts 2>&1 | tail -10
```

Expected: FAIL with module `../src/db` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/db.ts
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

export function openDb(path: string, migrations: string[]): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = db.prepare("SELECT COUNT(*) AS c FROM _migrations").get() as { c: number };
  for (let i = applied.c; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)")
        .run(i, new Date().toISOString());
    })();
  }
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Projects/ai-briefing && bun test tests/db.test.ts 2>&1 | tail -5
```

Expected: `2 pass 0 fail`.

- [ ] **Step 5: Create migration SQL files**

```sql
-- src/migrations/001_archive.sql
CREATE TABLE stories (
  id INTEGER PRIMARY KEY,
  url_canonical TEXT UNIQUE NOT NULL,
  url_original TEXT,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  published_at TEXT NOT NULL,
  first_para TEXT,
  ingested_at TEXT NOT NULL
);
CREATE INDEX idx_stories_published ON stories(published_at);
CREATE INDEX idx_stories_source ON stories(source_domain);
```

```sql
-- src/migrations/002_labels.sql
CREATE TABLE picks (
  id INTEGER PRIMARY KEY,
  show TEXT NOT NULL,
  episode_date TEXT NOT NULL,
  section_name TEXT,
  section_order INTEGER,
  rank_in_section INTEGER,
  story_url TEXT NOT NULL,
  story_title TEXT,
  scraped_at TEXT NOT NULL,
  source_file TEXT
);
CREATE INDEX idx_picks_show_date ON picks(show, episode_date);
CREATE UNIQUE INDEX idx_picks_unique ON picks(show, episode_date, story_url);
```

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/ai-briefing
git add src/db.ts src/migrations/ tests/db.test.ts
git commit -m "feat(db): bun:sqlite migration runner with shared openDb helper"
```

---

## Task 2: archive.db module

**Files:**
- Create: `src/archive.ts`
- Create: `tests/archive.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/archive.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { ArchiveStore } from "../src/archive";

const TMP_DB = "/tmp/ai-briefing-archive-test.sqlite";

describe("ArchiveStore", () => {
  beforeEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });
  afterEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

  test("insertStory dedupes by url_canonical", () => {
    const store = new ArchiveStore(TMP_DB);
    const now = new Date("2026-04-20T10:00:00Z");
    store.insertStory({
      url_canonical: "https://example.com/a",
      url_original: null,
      title: "A",
      source_name: "Example",
      source_domain: "example.com",
      published_at: now,
      first_para: "lead",
    });
    store.insertStory({
      url_canonical: "https://example.com/a",   // same URL → no-op
      url_original: null,
      title: "A (duplicate title)",
      source_name: "Example",
      source_domain: "example.com",
      published_at: now,
      first_para: "different lead",
    });
    expect(store.countAll()).toBe(1);
    store.close();
  });

  test("getStoriesInWindow returns only stories within the time range", () => {
    const store = new ArchiveStore(TMP_DB);
    const base = new Date("2026-04-20T10:00:00Z").getTime();
    for (let h = 0; h < 30; h++) {
      store.insertStory({
        url_canonical: `https://example.com/${h}`,
        url_original: null,
        title: `T${h}`,
        source_name: "E",
        source_domain: "example.com",
        published_at: new Date(base - h * 3600 * 1000),
        first_para: null,
      });
    }
    const cutoff = new Date(base - 24 * 3600 * 1000);
    const recent = store.getStoriesInWindow(cutoff, new Date(base));
    expect(recent.length).toBe(25);  // hours 0..24 inclusive
    store.close();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/archive.test.ts 2>&1 | tail -5
```

Expected: FAIL — `ArchiveStore` not exported.

- [ ] **Step 3: Implement `ArchiveStore`**

```typescript
// src/archive.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";

export interface StoryRow {
  url_canonical: string;
  url_original: string | null;
  title: string;
  source_name: string;
  source_domain: string;
  published_at: Date;
  first_para: string | null;
}

const SCHEMA = readFileSync(resolve(import.meta.dir, "migrations/001_archive.sql"), "utf-8");

export class ArchiveStore {
  private db: Database;
  constructor(path: string) {
    this.db = openDb(path, [SCHEMA]);
  }
  insertStory(s: StoryRow): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO stories
        (url_canonical, url_original, title, source_name, source_domain, published_at, first_para, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s.url_canonical, s.url_original, s.title, s.source_name, s.source_domain,
      s.published_at.toISOString(), s.first_para, new Date().toISOString()
    );
  }
  countAll(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM stories").get() as { c: number }).c;
  }
  getStoriesInWindow(from: Date, to: Date): StoryRow[] {
    return this.db.prepare(`
      SELECT url_canonical, url_original, title, source_name, source_domain, published_at, first_para
      FROM stories WHERE published_at BETWEEN ? AND ?
      ORDER BY published_at DESC
    `).all(from.toISOString(), to.toISOString()).map((r: any) => ({
      ...r,
      published_at: new Date(r.published_at),
    })) as StoryRow[];
  }
  close(): void { this.db.close(); }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/archive.test.ts 2>&1 | tail -5
```

Expected: `2 pass 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/archive.ts tests/archive.test.ts
git commit -m "feat(archive): ArchiveStore for persistent candidate corpus"
```

---

## Task 3: labels.db module

**Files:**
- Create: `src/labels.ts`
- Create: `tests/labels.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/labels.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { LabelStore } from "../src/labels";

const TMP_DB = "/tmp/ai-briefing-labels-test.sqlite";

describe("LabelStore", () => {
  beforeEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });
  afterEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

  test("insertPicks stores and dedupes within the same (show, episode_date, url)", () => {
    const store = new LabelStore(TMP_DB);
    store.insertPicks([
      { show: "twit", episode_date: "2026-04-19", section_name: "AI", section_order: 1,
        rank_in_section: 1, story_url: "https://example.com/a", story_title: "A",
        source_file: "fixture.html" },
      { show: "twit", episode_date: "2026-04-19", section_name: "AI", section_order: 1,
        rank_in_section: 2, story_url: "https://example.com/a", story_title: "A (dup)",
        source_file: "fixture.html" },
    ]);
    expect(store.countByShow("twit")).toBe(1);
    store.close();
  });

  test("getRecentPicks returns newest-first and respects show filter", () => {
    const store = new LabelStore(TMP_DB);
    store.insertPicks([
      { show: "twit", episode_date: "2026-04-12", section_name: "AI", section_order: 1,
        rank_in_section: 1, story_url: "https://example.com/old", story_title: "Old",
        source_file: null },
      { show: "twit", episode_date: "2026-04-19", section_name: "AI", section_order: 1,
        rank_in_section: 1, story_url: "https://example.com/new", story_title: "New",
        source_file: null },
      { show: "mbw", episode_date: "2026-04-14", section_name: "Apple", section_order: 1,
        rank_in_section: 1, story_url: "https://example.com/mbw", story_title: "MBW",
        source_file: null },
    ]);
    const recent = store.getRecentPicks("twit", 10);
    expect(recent.length).toBe(2);
    expect(recent[0].story_title).toBe("New");
    store.close();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/labels.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `LabelStore`**

```typescript
// src/labels.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";

export type Show = "twit" | "mbw" | "im";

export interface PickRow {
  show: Show;
  episode_date: string;         // "YYYY-MM-DD"
  section_name: string | null;
  section_order: number | null;
  rank_in_section: number | null;
  story_url: string;
  story_title: string | null;
  source_file: string | null;
}

const SCHEMA = readFileSync(resolve(import.meta.dir, "migrations/002_labels.sql"), "utf-8");

export class LabelStore {
  private db: Database;
  constructor(path: string) {
    this.db = openDb(path, [SCHEMA]);
  }
  insertPicks(picks: PickRow[]): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO picks
        (show, episode_date, section_name, section_order, rank_in_section, story_url, story_title, scraped_at, source_file)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const p of picks) {
        stmt.run(p.show, p.episode_date, p.section_name, p.section_order,
          p.rank_in_section, p.story_url, p.story_title, now, p.source_file);
      }
    })();
  }
  countByShow(show: Show): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM picks WHERE show = ?").get(show) as { c: number }).c;
  }
  getRecentPicks(show: Show, limit: number): PickRow[] {
    return this.db.prepare(`
      SELECT show, episode_date, section_name, section_order, rank_in_section, story_url, story_title, source_file
      FROM picks WHERE show = ?
      ORDER BY episode_date DESC, section_order ASC, rank_in_section ASC
      LIMIT ?
    `).all(show, limit) as PickRow[];
  }
  close(): void { this.db.close(); }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/labels.test.ts 2>&1 | tail -5
```

Expected: `2 pass 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/labels.ts tests/labels.test.ts
git commit -m "feat(labels): LabelStore for twit.show pick history"
```

---

## Task 4: twit.show HTML parser

**Files:**
- Create: `src/twitshow/parse.ts`
- Create: `tests/twitshow/parse.test.ts`
- Create: `tests/twitshow/fixtures/twit-2026-04-19.html` (copied from `~/Documents/`)

- [ ] **Step 1: Copy real fixture**

```bash
cd ~/Projects/ai-briefing
mkdir -p tests/twitshow/fixtures
cp ~/Documents/twit-2026-04-19.html tests/twitshow/fixtures/
cp ~/Documents/im-2026-04-15.html tests/twitshow/fixtures/
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/twitshow/parse.test.ts
import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseTwitShowHtml } from "../../src/twitshow/parse";

const twitHtml = readFileSync(resolve(import.meta.dir, "fixtures/twit-2026-04-19.html"), "utf-8");
const imHtml = readFileSync(resolve(import.meta.dir, "fixtures/im-2026-04-15.html"), "utf-8");

describe("parseTwitShowHtml", () => {
  test("extracts episode date from <title>", () => {
    const parsed = parseTwitShowHtml(twitHtml, "twit");
    expect(parsed.episode_date).toBe("2026-04-19");
  });

  test("extracts sections in order", () => {
    const parsed = parseTwitShowHtml(twitHtml, "twit");
    expect(parsed.sections.length).toBeGreaterThan(0);
    expect(parsed.sections[0].name).toMatch(/AI/);
    expect(parsed.sections[0].order).toBe(1);
  });

  test("extracts picks with URLs and titles, preserving within-section order", () => {
    const parsed = parseTwitShowHtml(twitHtml, "twit");
    const firstSection = parsed.sections[0];
    expect(firstSection.picks.length).toBeGreaterThan(0);
    expect(firstSection.picks[0]).toMatchObject({
      url: expect.stringMatching(/^https?:\/\//),
      title: expect.any(String),
      rank_in_section: 1,
    });
  });

  test("handles the IM fixture (Wednesday show)", () => {
    const parsed = parseTwitShowHtml(imHtml, "im");
    expect(parsed.show).toBe("im");
    expect(parsed.episode_date).toBe("2026-04-15");
    expect(parsed.sections.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/twitshow/parse.test.ts 2>&1 | tail -10
```

Expected: FAIL — `parseTwitShowHtml` not exported.

- [ ] **Step 4: Implement the parser**

```typescript
// src/twitshow/parse.ts
import type { Show } from "../labels";

export interface ParsedPick {
  url: string;
  title: string;
  rank_in_section: number;
}

export interface ParsedSection {
  name: string;
  order: number;
  picks: ParsedPick[];
}

export interface ParsedPage {
  show: Show;
  episode_date: string;
  sections: ParsedSection[];
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

function parseEpisodeDate(title: string): string {
  // "This Week in Tech Briefing - Sunday, 19 April 2026"
  const m = title.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (!m) throw new Error(`Cannot parse date from title: ${title}`);
  const [, day, monthName, year] = m;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) throw new Error(`Unknown month: ${monthName}`);
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

export function parseTwitShowHtml(html: string, show: Show): ParsedPage {
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (!titleMatch) throw new Error("No <title> in HTML");
  const episode_date = parseEpisodeDate(titleMatch[1]);

  const sections: ParsedSection[] = [];
  // Each section: <summary><h2>N. Name</h2></summary> ... <h3>Title</h3> ... <a href="URL"
  // Split on section headers.
  const sectionRegex = /<h2>\s*(\d+)\.\s*([^<]+?)\s*<\/h2>/g;
  const splits: Array<{ order: number; name: string; start: number }> = [];
  let sm: RegExpExecArray | null;
  while ((sm = sectionRegex.exec(html)) !== null) {
    splits.push({ order: Number(sm[1]), name: sm[2].trim(), start: sm.index + sm[0].length });
  }
  for (let i = 0; i < splits.length; i++) {
    const end = i + 1 < splits.length ? splits[i + 1].start : html.length;
    const body = html.slice(splits[i].start, end);
    const picks: ParsedPick[] = [];
    const entryRegex = /<h3>\s*([^<]+?)\s*<\/h3>[\s\S]*?<a\s+href="([^"]+)"/g;
    let em: RegExpExecArray | null;
    let rank = 1;
    while ((em = entryRegex.exec(body)) !== null) {
      const title = em[1].replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
      const url = em[2].replace(/&amp;/g, "&");
      picks.push({ url, title, rank_in_section: rank++ });
    }
    sections.push({ name: splits[i].name, order: splits[i].order, picks });
  }

  return { show, episode_date, sections };
}
```

- [ ] **Step 5: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/twitshow/parse.test.ts 2>&1 | tail -10
```

Expected: `4 pass 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add src/twitshow/parse.ts tests/twitshow/
git commit -m "feat(twitshow): HTML parser for show briefing pages"
```

---

## Task 5: CSV archive parser (LINKS.csv format)

**Files:**
- Create: `src/twitshow/parse-csv.ts`
- Create: `tests/twitshow/parse-csv.test.ts`
- Create: `tests/twitshow/fixtures/twit-2026-04-19-LINKS.csv`

- [ ] **Step 1: Copy real fixture from archive**

```bash
cd ~/Projects/ai-briefing
cp ~/Documents/archive-twit/twit-2026-04-19-LINKS.csv tests/twitshow/fixtures/
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/twitshow/parse-csv.test.ts
import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseLinksCsv } from "../../src/twitshow/parse-csv";

const csv = readFileSync(resolve(import.meta.dir, "fixtures/twit-2026-04-19-LINKS.csv"), "utf-8");

describe("parseLinksCsv", () => {
  test("extracts sections (continuation rows inherit prior section) and picks with URLs", () => {
    const parsed = parseLinksCsv(csv, "twit", "2026-04-19");
    expect(parsed.show).toBe("twit");
    expect(parsed.episode_date).toBe("2026-04-19");
    expect(parsed.sections.length).toBeGreaterThan(0);
    const allPicks = parsed.sections.flatMap((s) => s.picks);
    expect(allPicks.length).toBeGreaterThan(5);
    expect(allPicks[0].url).toMatch(/^https?:\/\//);
  });

  test("handles titles containing commas via CSV quoting", () => {
    const parsed = parseLinksCsv(csv, "twit", "2026-04-19");
    const allTitles = parsed.sections.flatMap((s) => s.picks.map((p) => p.title));
    expect(allTitles.some((t) => t.includes(","))).toBe(true);
  });

  test("preserves rank_in_section order", () => {
    const parsed = parseLinksCsv(csv, "twit", "2026-04-19");
    for (const section of parsed.sections) {
      section.picks.forEach((p, i) => expect(p.rank_in_section).toBe(i + 1));
    }
  });
});
```

- [ ] **Step 3: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/twitshow/parse-csv.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement CSV parser**

```typescript
// src/twitshow/parse-csv.ts
import type { Show } from "../labels";
import type { ParsedPage, ParsedSection } from "./parse";

// CSV columns (observed): order, section_name, title, notes, url
// Section name appears on the first row of each section; continuation rows have an empty section column.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let buf = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { buf += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else buf += c;
    } else {
      if (c === ',') { fields.push(buf); buf = ""; }
      else if (c === '"' && buf === "") inQuotes = true;
      else buf += c;
    }
  }
  fields.push(buf);
  return fields;
}

export function parseLinksCsv(csv: string, show: Show, episode_date: string): ParsedPage {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let sectionOrder = 0;

  for (const rawLine of csv.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const fields = parseCsvLine(rawLine);
    const sectionName = (fields[1] ?? "").trim();
    const title = (fields[2] ?? "").trim();
    const url = (fields[4] ?? "").trim();
    if (!url || !/^https?:\/\//.test(url)) continue;

    if (sectionName) {
      sectionOrder++;
      current = { name: sectionName, order: sectionOrder, picks: [] };
      sections.push(current);
    }
    if (!current) {
      sectionOrder++;
      current = { name: "(uncategorized)", order: sectionOrder, picks: [] };
      sections.push(current);
    }
    current.picks.push({
      url, title,
      rank_in_section: current.picks.length + 1,
    });
  }
  return { show, episode_date, sections };
}
```

- [ ] **Step 5: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/twitshow/parse-csv.test.ts 2>&1 | tail -5
```

Expected: `3 pass 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add src/twitshow/parse-csv.ts tests/twitshow/parse-csv.test.ts tests/twitshow/fixtures/twit-2026-04-19-LINKS.csv
git commit -m "feat(twitshow): CSV archive parser for -LINKS.csv files"
```

---

## Task 6: Org archive parser

**Files:**
- Create: `src/twitshow/parse-org.ts`
- Create: `tests/twitshow/parse-org.test.ts`
- Create: `tests/twitshow/fixtures/twit-2026-04-19.org`

- [ ] **Step 1: Copy fixture**

```bash
cd ~/Projects/ai-briefing
cp ~/Documents/archive-twit/twit-2026-04-19.org tests/twitshow/fixtures/
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/twitshow/parse-org.test.ts
import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseOrgFile } from "../../src/twitshow/parse-org";

const org = readFileSync(resolve(import.meta.dir, "fixtures/twit-2026-04-19.org"), "utf-8");

describe("parseOrgFile", () => {
  test("extracts org headings as sections", () => {
    const parsed = parseOrgFile(org, "twit", "2026-04-19");
    expect(parsed.show).toBe("twit");
    expect(parsed.episode_date).toBe("2026-04-19");
    expect(parsed.sections.length).toBeGreaterThan(0);
  });

  test("extracts [[url][title]] links with rank per section", () => {
    const parsed = parseOrgFile(org, "twit", "2026-04-19");
    const allPicks = parsed.sections.flatMap((s) => s.picks);
    expect(allPicks.length).toBeGreaterThan(5);
    expect(allPicks[0].url).toMatch(/^https?:\/\//);
    for (const section of parsed.sections) {
      section.picks.forEach((p, i) => expect(p.rank_in_section).toBe(i + 1));
    }
  });
});
```

- [ ] **Step 3: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/twitshow/parse-org.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement org parser**

```typescript
// src/twitshow/parse-org.ts
import type { Show } from "../labels";
import type { ParsedPage, ParsedSection } from "./parse";

const SECTION_RE = /^\*+\s+(.+?)\s*$/;
const LINK_RE = /\[\[([^\]]+)\]\[([^\]]+)\]\]/g;

export function parseOrgFile(org: string, show: Show, episode_date: string): ParsedPage {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let sectionOrder = 0;

  for (const line of org.split(/\r?\n/)) {
    const secMatch = line.match(SECTION_RE);
    if (secMatch) {
      sectionOrder++;
      current = { name: secMatch[1].trim(), order: sectionOrder, picks: [] };
      sections.push(current);
      continue;
    }
    LINK_RE.lastIndex = 0;
    let lm: RegExpExecArray | null;
    while ((lm = LINK_RE.exec(line)) !== null) {
      const url = lm[1].trim();
      if (!/^https?:\/\//.test(url)) continue;
      if (!current) {
        sectionOrder++;
        current = { name: "(uncategorized)", order: sectionOrder, picks: [] };
        sections.push(current);
      }
      current.picks.push({
        url,
        title: lm[2].trim(),
        rank_in_section: current.picks.length + 1,
      });
    }
  }
  return { show, episode_date, sections };
}
```

- [ ] **Step 5: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/twitshow/parse-org.test.ts 2>&1 | tail -5
```

Expected: `2 pass 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add src/twitshow/parse-org.ts tests/twitshow/parse-org.test.ts tests/twitshow/fixtures/twit-2026-04-19.org
git commit -m "feat(twitshow): org-mode archive parser"
```

---

## Task 7: Archive ingest orchestrator (HTML + org + CSV → labels.db)

**Files:**
- Create: `src/twitshow/ingest.ts`
- Create: `src/bin/ingest-archive.ts`
- Create: `tests/twitshow/ingest.test.ts`

The orchestrator reads from three fixed directories — `~/Documents/archive-twit/`, `archive-mbw/`, `archive-im/` — with the show inferred from the folder name. For each `<show>-YYYY-MM-DD` stem, it picks the highest-fidelity format available: **HTML > org > CSV**. Lower-fidelity files for the same stem are skipped.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/twitshow/ingest.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { LabelStore } from "../../src/labels";
import { ingestArchives } from "../../src/twitshow/ingest";

describe("ingestArchives", () => {
  let root: string;
  let dbPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "archives-"));
    dbPath = join(root, "labels.db");
    for (const show of ["twit", "mbw", "im"]) {
      mkdirSync(join(root, `archive-${show}`), { recursive: true });
    }
    // Use the real archive fixtures copied by Tasks 4, 5, 6
    copyFileSync(
      "tests/twitshow/fixtures/twit-2026-04-19.html",
      join(root, "archive-twit/twit-2026-04-19.html")
    );
    copyFileSync(
      "tests/twitshow/fixtures/twit-2026-04-19-LINKS.csv",
      join(root, "archive-twit/twit-2026-04-19-LINKS.csv")
    );
    copyFileSync(
      "tests/twitshow/fixtures/twit-2026-04-19.org",
      join(root, "archive-twit/twit-2026-04-19.org")
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("prefers HTML when present, ignoring lower-fidelity siblings for same stem", async () => {
    const store = new LabelStore(dbPath);
    const result = await ingestArchives(root, store);
    expect(result.files_parsed).toBe(1);         // HTML wins
    expect(result.files_skipped).toBe(2);        // .org and .csv skipped
    expect(store.countByShow("twit")).toBeGreaterThan(0);
    store.close();
  });

  test("is idempotent (second run inserts no new rows)", async () => {
    const store = new LabelStore(dbPath);
    const first = await ingestArchives(root, store);
    const second = await ingestArchives(root, store);
    expect(first.picks_inserted).toBeGreaterThan(0);
    expect(second.picks_inserted).toBe(0);
    store.close();
  });

  test("falls back to org then CSV when HTML is absent", async () => {
    // remove the HTML we copied in beforeEach to simulate CSV/org-only archives
    rmSync(join(root, "archive-twit/twit-2026-04-19.html"));
    const store = new LabelStore(dbPath);
    const result = await ingestArchives(root, store);
    expect(result.files_parsed).toBe(1);         // org wins over CSV
    store.close();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/twitshow/ingest.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement orchestrator + CLI**

```typescript
// src/twitshow/ingest.ts
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseTwitShowHtml } from "./parse";
import { parseOrgFile } from "./parse-org";
import { parseLinksCsv } from "./parse-csv";
import type { LabelStore, PickRow, Show } from "../labels";
import type { ParsedPage } from "./parse";

const SHOWS: Show[] = ["twit", "mbw", "im"];

// Filename patterns: <show>-YYYY-MM-DD.html | .org | -LINKS.csv
const DATE_FROM_NAME = /^(twit|mbw|im)-(\d{4}-\d{2}-\d{2})(?:\.html|\.org|-LINKS\.csv)$/;

export interface IngestResult {
  files_parsed: number;
  files_skipped: number;
  picks_inserted: number;
}

interface FileRef { show: Show; date: string; format: "html" | "org" | "csv"; path: string; name: string; }

function formatOf(name: string): "html" | "org" | "csv" | null {
  if (name.endsWith(".html")) return "html";
  if (name.endsWith(".org")) return "org";
  if (name.endsWith("-LINKS.csv")) return "csv";
  return null;
}

function parseFile(ref: FileRef): ParsedPage {
  const content = readFileSync(ref.path, "utf-8");
  if (ref.format === "html") return parseTwitShowHtml(content, ref.show);
  if (ref.format === "org") return parseOrgFile(content, ref.show, ref.date);
  return parseLinksCsv(content, ref.show, ref.date);
}

function toPickRows(parsed: ParsedPage, source_file: string): PickRow[] {
  const rows: PickRow[] = [];
  for (const section of parsed.sections) {
    for (const pick of section.picks) {
      rows.push({
        show: parsed.show,
        episode_date: parsed.episode_date,
        section_name: section.name,
        section_order: section.order,
        rank_in_section: pick.rank_in_section,
        story_url: pick.url,
        story_title: pick.title,
        source_file,
      });
    }
  }
  return rows;
}

export async function ingestArchives(rootDir: string, store: LabelStore): Promise<IngestResult> {
  const byStem = new Map<string, FileRef[]>();
  for (const show of SHOWS) {
    const dir = join(rootDir, `archive-${show}`);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const m = name.match(DATE_FROM_NAME);
      if (!m || m[1] !== show) continue;
      const format = formatOf(name);
      if (!format) continue;
      const stem = `${show}-${m[2]}`;
      const arr = byStem.get(stem) ?? [];
      arr.push({ show, date: m[2], format, path: join(dir, name), name });
      byStem.set(stem, arr);
    }
  }

  const priority: Record<"html" | "org" | "csv", number> = { html: 0, org: 1, csv: 2 };
  let files_parsed = 0, files_skipped = 0, picks_inserted = 0;

  for (const refs of byStem.values()) {
    refs.sort((a, b) => priority[a.format] - priority[b.format]);
    const winner = refs[0];
    files_skipped += refs.length - 1;
    try {
      const parsed = parseFile(winner);
      const rows = toPickRows(parsed, winner.name);
      const before = store.countByShow(winner.show);
      store.insertPicks(rows);
      const after = store.countByShow(winner.show);
      picks_inserted += after - before;
      files_parsed++;
    } catch (err) {
      console.error(`[ingest] failed to parse ${winner.path}: ${err}`);
    }
  }

  return { files_parsed, files_skipped, picks_inserted };
}
```

```typescript
// src/bin/ingest-archive.ts
#!/usr/bin/env bun
import { LabelStore } from "../labels";
import { ingestArchives } from "../twitshow/ingest";

const LABELS_DB = `${process.env.HOME}/.local/share/ai-briefing/labels.db`;
const ROOT = process.argv[2] ?? `${process.env.HOME}/Documents`;

const store = new LabelStore(LABELS_DB);
const res = await ingestArchives(ROOT, store);
console.log(
  `[ingest] parsed=${res.files_parsed} skipped=${res.files_skipped} inserted=${res.picks_inserted}`
);
store.close();
```

- [ ] **Step 4: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/twitshow/ingest.test.ts 2>&1 | tail -5
```

Expected: `3 pass 0 fail`.

- [ ] **Step 5: Run against the real archive**

```bash
cd ~/Projects/ai-briefing && bun run src/bin/ingest-archive.ts ~/Documents 2>&1
```

Expected: `[ingest] parsed=~33 skipped=~25 inserted=<many>` (one winning file per (show, date), lower-priority siblings skipped).

Verify counts:

```bash
echo "SELECT show, COUNT(*) FROM picks GROUP BY show;" | sqlite3 ~/.local/share/ai-briefing/labels.db
```

Expected: non-zero counts for `twit`, `mbw`, `im`.

- [ ] **Step 6: Commit**

```bash
git add src/twitshow/ingest.ts src/bin/ingest-archive.ts tests/twitshow/ingest.test.ts
git commit -m "feat(twitshow): archive ingest — HTML>org>CSV per-episode priority"
```

---
## Task 8: Topic clustering (URL canon + trigram similarity + source ranking)

**Files:**
- Create: `src/cluster.ts`
- Create: `tests/cluster.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cluster.test.ts
import { describe, test, expect } from "bun:test";
import { canonicalizeUrl, trigramJaccard, clusterStories } from "../src/cluster";
import type { StoryRow } from "../src/archive";

describe("canonicalizeUrl", () => {
  test("strips utm_* query params", () => {
    expect(canonicalizeUrl("https://example.com/a?utm_source=rss&id=1"))
      .toBe("https://example.com/a?id=1");
  });
  test("lowercases host, drops fragment, strips trailing slash", () => {
    expect(canonicalizeUrl("HTTPS://EXAMPLE.COM/path/#section"))
      .toBe("https://example.com/path");
  });
});

describe("trigramJaccard", () => {
  test("identical strings return 1.0", () => {
    expect(trigramJaccard("hello world", "hello world")).toBeCloseTo(1.0);
  });
  test("totally different strings are near 0", () => {
    expect(trigramJaccard("apple", "zebra")).toBeLessThan(0.1);
  });
  test("similar titles score > 0.5", () => {
    expect(trigramJaccard(
      "Anthropic releases Claude Opus 4.7",
      "Anthropic releases Opus 4.7 model"
    )).toBeGreaterThan(0.5);
  });
});

describe("clusterStories", () => {
  const mk = (url: string, title: string): StoryRow => ({
    url_canonical: url, url_original: null, title,
    source_name: "S", source_domain: "s.com",
    published_at: new Date(), first_para: null,
  });

  test("groups stories with similar titles into the same cluster", () => {
    const stories = [
      mk("https://a.com/1", "Anthropic releases Claude Opus 4.7"),
      mk("https://b.com/2", "Anthropic releases Opus 4.7 model"),
      mk("https://c.com/3", "SpaceX launches Starship"),
    ];
    const clusters = clusterStories(stories, 0.5);
    expect(clusters).toHaveLength(2);
    const multiCluster = clusters.find((c) => c.length > 1)!;
    expect(multiCluster).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/cluster.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/cluster.ts
import type { StoryRow } from "./archive";

const TRACKING_PARAM_RE = /^(utm_|fbclid|gclid|mc_|_hsenc|_hsmi|ref|ref_src)/i;

export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.host = u.host.toLowerCase();
    const keep: [string, string][] = [];
    for (const [k, v] of u.searchParams) {
      if (!TRACKING_PARAM_RE.test(k)) keep.push([k, v]);
    }
    u.search = "";
    for (const [k, v] of keep) u.searchParams.append(k, v);
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}

function trigrams(s: string): Set<string> {
  const norm = s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const padded = `  ${norm}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

export function trigramJaccard(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function clusterStories(stories: StoryRow[], threshold: number): StoryRow[][] {
  const clusters: StoryRow[][] = [];
  for (const s of stories) {
    let placed = false;
    for (const c of clusters) {
      if (trigramJaccard(s.title, c[0].title) >= threshold) {
        c.push(s);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([s]);
  }
  return clusters;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/cluster.test.ts 2>&1 | tail -5
```

Expected: `7 pass 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/cluster.ts tests/cluster.test.ts
git commit -m "feat(cluster): URL canonicalization + trigram Jaccard topic clustering"
```

---

## Task 9: Few-shot prompt builder

**Files:**
- Create: `src/prompt.ts`
- Create: `tests/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/prompt.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { LabelStore } from "../src/labels";
import { buildScoringPrompt } from "../src/prompt";
import type { StoryRow } from "../src/archive";

const TMP_DB = "/tmp/ai-briefing-prompt-test.sqlite";

describe("buildScoringPrompt", () => {
  beforeEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });
  afterEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

  test("includes show descriptions and few-shot examples per show", () => {
    const store = new LabelStore(TMP_DB);
    store.insertPicks([
      { show: "twit", episode_date: "2026-04-19", section_name: "AI", section_order: 1,
        rank_in_section: 1, story_url: "https://ex.com/opus", story_title: "Anthropic Opus 4.7", source_file: null },
      { show: "mbw", episode_date: "2026-04-14", section_name: "Apple", section_order: 1,
        rank_in_section: 1, story_url: "https://ex.com/vision", story_title: "Vision Pro rumor", source_file: null },
      { show: "im", episode_date: "2026-04-15", section_name: "Models", section_order: 1,
        rank_in_section: 1, story_url: "https://ex.com/llama", story_title: "Llama 5 released", source_file: null },
    ]);

    const cluster: StoryRow[] = [{
      url_canonical: "https://new.com/story",
      url_original: null,
      title: "Meta releases Llama 5",
      source_name: "TechCrunch", source_domain: "techcrunch.com",
      published_at: new Date(), first_para: "Meta announced..."
    }];
    const prompt = buildScoringPrompt(cluster, store, 5);
    expect(prompt).toContain("TWiT");
    expect(prompt).toContain("MacBreak Weekly");
    expect(prompt).toContain("Intelligent Machines");
    expect(prompt).toContain("Anthropic Opus 4.7");           // twit example
    expect(prompt).toContain("Vision Pro rumor");             // mbw example
    expect(prompt).toContain("Llama 5 released");             // im example
    expect(prompt).toContain("Meta releases Llama 5");        // candidate
    expect(prompt).toContain("JSON");
    store.close();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/prompt.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/prompt.ts
import type { LabelStore, PickRow, Show } from "./labels";
import type { StoryRow } from "./archive";

const SHOW_DESCRIPTIONS: Record<Show, string> = {
  twit: "TWiT (This Week in Tech) — general tech news for a broad audience. Big-picture stories about the tech industry, major product launches, legal/policy issues, and anything a thoughtful tech-adjacent viewer would find interesting.",
  mbw: "MacBreak Weekly (MBW) — Apple-focused. iPhone, iPad, Mac, Vision Pro, Apple services, Apple's business, court cases involving Apple, and rumors about unreleased Apple products.",
  im: "Intelligent Machines (IM) — AI-focused. Model releases, AI research, AI industry news, AI regulation, AI ethics, and the societal impact of AI.",
};

const CURATION_RULES = `
CURATION RULES (from Leo's experience):
- Show only stories published within the past 24 hours.
- Multiple stories on the same topic are allowed; the first listed in a cluster should be the original/primary source.
- Prefer sources Leo has historically used for similar topics.
- Low-relevance stories can still surface as "Other notable" at low scores.
`.trim();

function renderFewShot(picks: PickRow[]): string {
  return picks.map((p) =>
    `- [${p.section_name ?? "—"}] "${p.story_title}" — ${p.story_url}`
  ).join("\n");
}

export function buildScoringPrompt(
  cluster: StoryRow[],
  labels: LabelStore,
  fewShotK: number
): string {
  const shows: Show[] = ["twit", "mbw", "im"];
  const fewShotBlocks = shows.map((show) => {
    const examples = labels.getRecentPicks(show, fewShotK);
    return `### Recent ${show.toUpperCase()} picks\n${renderFewShot(examples)}`;
  }).join("\n\n");

  const candidates = cluster.map((s, i) =>
    `  ${i + 1}. "${s.title}" — ${s.source_name} (${s.source_domain}) — ${s.url_canonical}\n     Lead: ${(s.first_para ?? "").slice(0, 240)}`
  ).join("\n");

  return `You are scoring news stories for three weekly tech podcasts.

## Shows
- **TWiT:** ${SHOW_DESCRIPTIONS.twit}
- **MacBreak Weekly (MBW):** ${SHOW_DESCRIPTIONS.mbw}
- **Intelligent Machines (IM):** ${SHOW_DESCRIPTIONS.im}

${CURATION_RULES}

## Few-shot examples of Leo's picks

${fewShotBlocks}

## Candidate cluster (${cluster.length} story/ies, likely about the same topic)
${candidates}

## Task
For each show, score how well this cluster fits (0.0–1.0). Also pick which story in the cluster should be the canonical (primary) link, and optionally guess a section name. Output STRICT JSON, no commentary:

{
  "twit": { "score": 0.0, "canonical_idx": 1, "section_guess": null },
  "mbw":  { "score": 0.0, "canonical_idx": 1, "section_guess": null },
  "im":   { "score": 0.0, "canonical_idx": 1, "section_guess": null }
}`;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/prompt.test.ts 2>&1 | tail -5
```

Expected: `1 pass 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/prompt.ts tests/prompt.test.ts
git commit -m "feat(prompt): few-shot scoring prompt builder with per-show examples"
```

---

## Task 10: Cluster scorer (Claude Haiku call)

**Files:**
- Create: `src/scorer.ts`
- Create: `tests/scorer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scorer.test.ts
import { describe, test, expect } from "bun:test";
import { parseScoringResponse } from "../src/scorer";

describe("parseScoringResponse", () => {
  test("parses valid JSON envelope", () => {
    const raw = `{"twit":{"score":0.8,"canonical_idx":1,"section_guess":"AI"},"mbw":{"score":0.1,"canonical_idx":1,"section_guess":null},"im":{"score":0.95,"canonical_idx":1,"section_guess":"Models"}}`;
    const parsed = parseScoringResponse(raw);
    expect(parsed.twit.score).toBeCloseTo(0.8);
    expect(parsed.im.section_guess).toBe("Models");
  });

  test("extracts JSON from text with preamble", () => {
    const raw = `Here is the scoring:\n\n{"twit":{"score":0.3,"canonical_idx":2,"section_guess":null},"mbw":{"score":0.0,"canonical_idx":1,"section_guess":null},"im":{"score":0.5,"canonical_idx":1,"section_guess":null}}`;
    const parsed = parseScoringResponse(raw);
    expect(parsed.twit.canonical_idx).toBe(2);
    expect(parsed.im.score).toBeCloseTo(0.5);
  });

  test("throws on unparseable response", () => {
    expect(() => parseScoringResponse("nonsense")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/scorer.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/scorer.ts
import Anthropic from "@anthropic-ai/sdk";
import type { StoryRow } from "./archive";
import type { LabelStore, Show } from "./labels";
import { buildScoringPrompt } from "./prompt";

export interface ShowScore {
  score: number;
  canonical_idx: number;
  section_guess: string | null;
}
export type ClusterScoring = Record<Show, ShowScore>;

export function parseScoringResponse(text: string): ClusterScoring {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  const obj = JSON.parse(text.slice(start, end + 1));
  for (const s of ["twit", "mbw", "im"] as Show[]) {
    if (!obj[s] || typeof obj[s].score !== "number" || typeof obj[s].canonical_idx !== "number") {
      throw new Error(`Scoring response missing required field for show ${s}`);
    }
  }
  return obj as ClusterScoring;
}

export async function scoreCluster(
  cluster: StoryRow[],
  labels: LabelStore,
  config: { model: string; max_tokens: number; few_shot_k: number }
): Promise<ClusterScoring | null> {
  const prompt = buildScoringPrompt(cluster, labels, config.few_shot_k);
  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.max_tokens,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseScoringResponse(textBlock.text);
  } catch (err) {
    console.error("[scorer] failed:", err);
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/scorer.test.ts 2>&1 | tail -5
```

Expected: `3 pass 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/scorer.ts tests/scorer.test.ts
git commit -m "feat(scorer): Claude Haiku cluster scoring with JSON parse"
```

---

## Task 11: Selection logic (top-N + Other notable)

**Files:**
- Create: `src/selection.ts`
- Create: `tests/selection.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/selection.test.ts
import { describe, test, expect } from "bun:test";
import { selectForShow, splitScored } from "../src/selection";
import type { StoryRow } from "../src/archive";
import type { ClusterScoring } from "../src/scorer";

const mkStory = (url: string, title: string): StoryRow => ({
  url_canonical: url, url_original: null, title,
  source_name: "S", source_domain: "s.com",
  published_at: new Date(), first_para: null,
});
const mkScoring = (twit: number, mbw: number, im: number): ClusterScoring => ({
  twit: { score: twit, canonical_idx: 1, section_guess: null },
  mbw:  { score: mbw,  canonical_idx: 1, section_guess: null },
  im:   { score: im,   canonical_idx: 1, section_guess: null },
});

describe("selectForShow", () => {
  test("returns top N clusters for the given show by score desc", () => {
    const scored = [
      { cluster: [mkStory("a", "A")], scoring: mkScoring(0.9, 0.1, 0.2) },
      { cluster: [mkStory("b", "B")], scoring: mkScoring(0.3, 0.1, 0.2) },
      { cluster: [mkStory("c", "C")], scoring: mkScoring(0.7, 0.1, 0.2) },
    ];
    const result = selectForShow(scored, "twit", 2);
    expect(result.length).toBe(2);
    expect(result[0].cluster[0].url_canonical).toBe("a");
    expect(result[1].cluster[0].url_canonical).toBe("c");
  });
});

describe("splitScored", () => {
  test("puts per-show top-N into buckets, leftovers with anywhere-score > threshold go to other", () => {
    const scored = [
      { cluster: [mkStory("a", "A")], scoring: mkScoring(0.9, 0.1, 0.2) }, // twit
      { cluster: [mkStory("b", "B")], scoring: mkScoring(0.1, 0.9, 0.1) }, // mbw
      { cluster: [mkStory("c", "C")], scoring: mkScoring(0.1, 0.1, 0.9) }, // im
      { cluster: [mkStory("d", "D")], scoring: mkScoring(0.4, 0.1, 0.1) }, // other (> 0.3)
      { cluster: [mkStory("e", "E")], scoring: mkScoring(0.1, 0.1, 0.1) }, // dropped
    ];
    const split = splitScored(scored, { topN: 5, otherThreshold: 0.3 });
    expect(split.twit.length).toBe(2);           // a + d  (d in top-5 too)
    expect(split.mbw.length).toBe(1);
    expect(split.im.length).toBe(1);
    expect(split.other.map(s => s.cluster[0].url_canonical))
      .not.toContain("e");                        // dropped (all-low)
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/selection.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/selection.ts
import type { StoryRow } from "./archive";
import type { ClusterScoring, ShowScore } from "./scorer";
import type { Show } from "./labels";

export interface ScoredCluster {
  cluster: StoryRow[];
  scoring: ClusterScoring;
}

export interface SelectionSplit {
  twit: ScoredCluster[];
  mbw: ScoredCluster[];
  im: ScoredCluster[];
  other: ScoredCluster[];
}

export function selectForShow(scored: ScoredCluster[], show: Show, topN: number): ScoredCluster[] {
  return [...scored]
    .sort((a, b) => b.scoring[show].score - a.scoring[show].score)
    .slice(0, topN);
}

export function splitScored(
  scored: ScoredCluster[],
  config: { topN: number; otherThreshold: number }
): SelectionSplit {
  const twit = selectForShow(scored, "twit", config.topN);
  const mbw = selectForShow(scored, "mbw", config.topN);
  const im = selectForShow(scored, "im", config.topN);
  const selectedUrls = new Set([
    ...twit.map((s) => s.cluster[0].url_canonical),
    ...mbw.map((s) => s.cluster[0].url_canonical),
    ...im.map((s) => s.cluster[0].url_canonical),
  ]);
  const other = scored.filter((s) => {
    if (selectedUrls.has(s.cluster[0].url_canonical)) return false;
    const maxScore = Math.max(s.scoring.twit.score, s.scoring.mbw.score, s.scoring.im.score);
    return maxScore > config.otherThreshold;
  });
  return { twit, mbw, im, other };
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/selection.test.ts 2>&1 | tail -5
```

Expected: `2 pass 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/selection.ts tests/selection.test.ts
git commit -m "feat(selection): per-show top-N + other-notable bucket"
```

---

## Task 12: Writer rewrite (per-show output, YYYY/MM/ path)

**Files:**
- Modify: `src/writer.ts`
- Modify: `tests/writer.test.ts`

- [ ] **Step 1: Update the writer test**

```typescript
// tests/writer.test.ts (replace existing tests)
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { renderBriefing, writeBriefing, briefingPathFor } from "../src/writer";
import type { SelectionSplit } from "../src/selection";
import type { StoryRow } from "../src/archive";

const mkStory = (url: string, title: string, src = "Ex"): StoryRow => ({
  url_canonical: url, url_original: null, title,
  source_name: src, source_domain: `${src.toLowerCase()}.com`,
  published_at: new Date("2026-04-20T10:00:00Z"), first_para: null,
});

const mkSplit = (): SelectionSplit => ({
  twit: [{ cluster: [mkStory("https://a.com/1", "TWiT pick")], scoring: { twit: { score: 0.9, canonical_idx: 1, section_guess: "AI" }, mbw: { score: 0.1, canonical_idx: 1, section_guess: null }, im: { score: 0.2, canonical_idx: 1, section_guess: null } } }],
  mbw: [{ cluster: [mkStory("https://b.com/1", "MBW pick")], scoring: { twit: { score: 0.1, canonical_idx: 1, section_guess: null }, mbw: { score: 0.9, canonical_idx: 1, section_guess: "Apple" }, im: { score: 0.1, canonical_idx: 1, section_guess: null } } }],
  im: [{ cluster: [mkStory("https://c.com/1", "IM pick")], scoring: { twit: { score: 0.1, canonical_idx: 1, section_guess: null }, mbw: { score: 0.1, canonical_idx: 1, section_guess: null }, im: { score: 0.95, canonical_idx: 1, section_guess: "Models" } } }],
  other: [{ cluster: [mkStory("https://d.com/1", "Other item")], scoring: { twit: { score: 0.4, canonical_idx: 1, section_guess: null }, mbw: { score: 0.1, canonical_idx: 1, section_guess: null }, im: { score: 0.1, canonical_idx: 1, section_guess: null } } }],
});

describe("briefingPathFor", () => {
  test("builds YYYY/MM/YYYY-MM-DD.md under base", () => {
    const p = briefingPathFor("/vault/AI/News", new Date("2026-04-20T10:00:00Z"));
    expect(p).toBe("/vault/AI/News/2026/04/2026-04-20.md");
  });
});

describe("renderBriefing", () => {
  test("includes all three per-show sections plus Other notable", () => {
    const md = renderBriefing(mkSplit(), new Date("2026-04-20T10:00:00Z"), 42);
    expect(md).toContain("## TWiT (general tech)");
    expect(md).toContain("## MBW (Apple)");
    expect(md).toContain("## IM (AI)");
    expect(md).toContain("## Other notable");
    expect(md).toContain("TWiT pick");
    expect(md).toContain("Other item");
    expect(md).toContain("pool_size: 42");
  });

  test("omits sections that have no content", () => {
    const empty: SelectionSplit = { twit: [], mbw: [], im: [], other: [] };
    const md = renderBriefing(empty, new Date("2026-04-20T10:00:00Z"), 0);
    expect(md).not.toContain("## TWiT");
    expect(md).not.toContain("## Other notable");
  });
});

describe("writeBriefing", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "brief-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("writes the file at YYYY/MM/YYYY-MM-DD.md", () => {
    const path = writeBriefing(mkSplit(), dir, new Date("2026-04-20T10:00:00Z"), 42);
    expect(path).toBe(join(dir, "2026/04/2026-04-20.md"));
    expect(readFileSync(path, "utf-8")).toContain("TWiT pick");
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd ~/Projects/ai-briefing && bun test tests/writer.test.ts 2>&1 | tail -10
```

Expected: FAIL — new exports not present.

- [ ] **Step 3: Rewrite `src/writer.ts`**

```typescript
// src/writer.ts
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import type { SelectionSplit, ScoredCluster } from "./selection";
import type { Show } from "./labels";

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
function dateStr(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthDir(d: Date): string { return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}`; }
function headingDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function briefingPathFor(basePath: string, d: Date): string {
  return join(basePath, monthDir(d), `${dateStr(d)}.md`);
}

const SHOW_LABEL: Record<Show, string> = {
  twit: "TWiT (general tech)",
  mbw: "MBW (Apple)",
  im: "IM (AI)",
};

function renderShowSection(show: Show, picks: ScoredCluster[]): string {
  if (picks.length === 0) return "";
  const lines: string[] = [`## ${SHOW_LABEL[show]} — ${picks.length} candidate${picks.length === 1 ? "" : "s"}`];
  for (const pick of picks) {
    const canonicalIdx = Math.max(0, Math.min(pick.cluster.length - 1, pick.scoring[show].canonical_idx - 1));
    const canonical = pick.cluster[canonicalIdx];
    const summary = canonical.first_para?.slice(0, 200) ?? "";
    lines.push(`- **${canonical.title}** — ${summary} ([${canonical.source_name}](${canonical.url_canonical}))`);
    for (let i = 0; i < pick.cluster.length; i++) {
      if (i === canonicalIdx) continue;
      const alt = pick.cluster[i];
      lines.push(`  - ([${alt.source_name}](${alt.url_canonical}))`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderOtherSection(clusters: ScoredCluster[]): string {
  if (clusters.length === 0) return "";
  const lines = [`## Other notable — ${clusters.length} below-threshold items`, ""];
  lines.push("*Items that didn't hit the per-show cutoff but scored above floor on at least one axis.*", "");
  for (const c of clusters) {
    const canonical = c.cluster[0];
    lines.push(`- **${canonical.title}** ([${canonical.source_name}](${canonical.url_canonical}))`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderBriefing(split: SelectionSplit, date: Date, poolSize: number): string {
  const sections = [
    `---\ndate: ${dateStr(date)}\ntype: tech-briefing\npool_size: ${poolSize}\n---`,
    "",
    `# Tech Briefing — ${headingDate(date)}`,
    "",
    renderShowSection("twit", split.twit),
    renderShowSection("mbw", split.mbw),
    renderShowSection("im", split.im),
    renderOtherSection(split.other),
  ];
  return sections.filter(Boolean).join("\n");
}

export function writeBriefing(
  split: SelectionSplit,
  basePath: string,
  date: Date,
  poolSize: number
): string {
  const path = briefingPathFor(basePath, date);
  mkdirSync(join(basePath, monthDir(date)), { recursive: true });
  writeFileSync(path, renderBriefing(split, date, poolSize), "utf-8");
  console.log(`[writer] wrote briefing to ${path}`);
  return path;
}

// --- daily-note integration (ported from existing writer.ts, minus banner/weather which still run elsewhere) ---

export async function linkInDailyNote(vaultPath: string, date: Date): Promise<void> {
  const ds = dateStr(date);
  const dir = join(vaultPath, "Daily Notes", monthDir(date));
  const notePath = join(dir, `${ds}.md`);
  const linkLine = `[[AI/News/${monthDir(date)}/${ds}|📰 Tech Briefing]]`;
  if (!existsSync(notePath)) return;  // daily note creation stays in original writer; this function only links

  const content = readFileSync(notePath, "utf-8");
  if (content.includes(`[[AI/News/${monthDir(date)}/${ds}|`)) {
    console.log("[writer] daily note already has tech briefing link, skipping");
    return;
  }
  const marker = "#### Exercise";
  const pos = content.indexOf(marker);
  const updated = pos !== -1
    ? content.slice(0, pos) + linkLine + "\n\n" + content.slice(pos)
    : content + "\n" + linkLine + "\n";
  writeFileSync(notePath, updated, "utf-8");
  console.log(`[writer] added tech briefing link to ${notePath}`);
}
```

> NOTE: the original `writer.ts` created the daily note from scratch with banner + weather on days when it didn't exist. The new `linkInDailyNote` deliberately does NOT create the note — it only links. Ensure the daily-note bootstrap runs elsewhere (or move it to a separate module in a follow-up task if needed).

- [ ] **Step 4: Run to verify pass**

```bash
cd ~/Projects/ai-briefing && bun test tests/writer.test.ts 2>&1 | tail -5
```

Expected: `4 pass 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/writer.ts tests/writer.test.ts
git commit -m "feat(writer): per-show sections + YYYY/MM/ path + tech-briefing daily-note link"
```

---

## Task 13: Types + config update

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `config.yaml`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Update config.yaml**

```yaml
# config.yaml (full replacement)
rss:
  opml_file: "~/Sync/beatcheck.opml"
  feeds: []

claude:
  model: "claude-haiku-4-5"
  max_tokens: 4096
  few_shot_k: 20

pipeline:
  window_hours: 24
  cluster_threshold: 0.5
  top_n_per_show: 15
  other_threshold: 0.3

storage:
  archive_db: "~/.local/share/ai-briefing/archive.db"
  labels_db: "~/.local/share/ai-briefing/labels.db"

archive:
  # Root directory containing archive-twit/ archive-mbw/ archive-im/ folders of
  # final show rundowns (.html, .org, and -LINKS.csv files).
  root: "~/Documents"

output:
  path: "~/Obsidian/lgl/AI/News"
```

- [ ] **Step 2: Update `src/types.ts`**

```typescript
// src/types.ts
export interface Story {
  title: string;
  url: string;
  source: "rss";
  sourceName: string;
  summary: string;
  publishedAt: Date;
  score?: number;
}

export interface RssFeed { url: string; name: string; }
export interface RssConfig { feeds: RssFeed[]; opml_file?: string; }

export interface ClaudeConfig {
  model: string;
  max_tokens: number;
  few_shot_k: number;
}

export interface PipelineConfig {
  window_hours: number;
  cluster_threshold: number;
  top_n_per_show: number;
  other_threshold: number;
}

export interface StorageConfig {
  archive_db: string;
  labels_db: string;
}

export interface ArchiveConfig { root: string; }

export interface OutputConfig { path: string; }

export interface Config {
  rss: RssConfig;
  claude: ClaudeConfig;
  pipeline: PipelineConfig;
  storage: StorageConfig;
  archive: ArchiveConfig;
  output: OutputConfig;
}
```

- [ ] **Step 3: Update `src/config.ts` to expand `~` in new paths**

```typescript
// src/config.ts
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import yaml from "js-yaml";
import type { Config } from "./types";

function expandTilde(s: string): string {
  if (s.startsWith("~")) return s.replace("~", process.env.HOME ?? "/home/leo");
  return s;
}

export function loadConfig(configPath?: string): Config {
  const path = configPath ?? resolve(dirname(import.meta.dir), "config.yaml");
  const raw = readFileSync(path, "utf-8");
  const config = yaml.load(raw) as Config;
  config.output.path = expandTilde(config.output.path);
  config.storage.archive_db = expandTilde(config.storage.archive_db);
  config.storage.labels_db = expandTilde(config.storage.labels_db);
  config.archive.root = expandTilde(config.archive.root);
  if (config.rss.opml_file) config.rss.opml_file = expandTilde(config.rss.opml_file);
  return config;
}
```

- [ ] **Step 4: Update `tests/config.test.ts`**

```typescript
import { describe, test, expect } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("loads the new tech-briefing config shape", () => {
    const config = loadConfig();
    expect(config.claude.model).toBe("claude-haiku-4-5");
    expect(config.claude.few_shot_k).toBe(20);
    expect(config.pipeline.window_hours).toBe(24);
    expect(config.pipeline.top_n_per_show).toBe(15);
    expect(config.storage.archive_db).toContain(".local/share/ai-briefing/archive.db");
    expect(config.storage.labels_db).toContain(".local/share/ai-briefing/labels.db");
    expect(config.archive.root).toContain("Documents");
    expect(config.archive.root).not.toContain("~");
    expect(config.output.path).toContain("Obsidian");
    expect(config.output.path).not.toContain("~");
  });
});
```

- [ ] **Step 5: Run all tests**

```bash
cd ~/Projects/ai-briefing && bun test 2>&1 | tail -10
```

Expected: all previously-green tests remain green; new config test passes. (Legacy `summarize.test.ts` may still exist but should remain compatible for now — it's deleted in Task 15.)

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config.ts config.yaml tests/config.test.ts
git commit -m "feat(config): new shape for tech briefing (claude/pipeline/storage)"
```

---

## Task 14: Main pipeline rewrite (`src/index.ts`)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite the pipeline**

```typescript
// src/index.ts
import { loadConfig } from "./config";
import { fetchRss } from "./sources/rss";
import { ArchiveStore } from "./archive";
import { LabelStore } from "./labels";
import { ingestArchives } from "./twitshow/ingest";
import { canonicalizeUrl, clusterStories } from "./cluster";
import { scoreCluster } from "./scorer";
import { splitScored, type ScoredCluster } from "./selection";
import { writeBriefing, linkInDailyNote } from "./writer";

async function main() {
  const startTime = Date.now();
  console.log("[tech-briefing] starting...");
  const config = loadConfig();

  // 0. Refresh labels from local archive folders (~/Documents/archive-{twit,mbw,im})
  const labels = new LabelStore(config.storage.labels_db);
  const ingest = await ingestArchives(config.archive.root, labels);
  console.log(
    `[tech-briefing] archive ingest: parsed=${ingest.files_parsed} skipped=${ingest.files_skipped} new_picks=${ingest.picks_inserted}`
  );

  // 1. Fetch from OPML RSS feeds
  const rssStories = await fetchRss(config.rss).catch((err) => {
    console.error("[tech-briefing] rss failed:", err);
    return [];
  });
  console.log(`[tech-briefing] fetched: rss=${rssStories.length}`);

  // 2. Archive every fetched story (negative corpus for future supervised training)
  const archive = new ArchiveStore(config.storage.archive_db);
  for (const s of rssStories) {
    try {
      const url_canonical = canonicalizeUrl(s.url);
      const url_host = new URL(url_canonical).host;
      archive.insertStory({
        url_canonical, url_original: null,
        title: s.title, source_name: s.sourceName,
        source_domain: url_host, published_at: s.publishedAt,
        first_para: s.summary ?? null,
      });
    } catch { /* skip malformed URLs */ }
  }

  // 3. Filter to past 24h
  const now = new Date();
  const cutoff = new Date(now.getTime() - config.pipeline.window_hours * 3600 * 1000);
  const recent = archive.getStoriesInWindow(cutoff, now);
  console.log(`[tech-briefing] ${recent.length} stories in past ${config.pipeline.window_hours}h`);

  if (recent.length === 0) {
    console.error("[tech-briefing] no recent stories, exiting without write");
    archive.close();
    process.exit(0);
  }

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

  // 6. Split into per-show buckets + other-notable
  const split = splitScored(scored, {
    topN: config.pipeline.top_n_per_show,
    otherThreshold: config.pipeline.other_threshold,
  });
  console.log(
    `[tech-briefing] selection: twit=${split.twit.length} mbw=${split.mbw.length} im=${split.im.length} other=${split.other.length}`
  );

  // 7. Write briefing to Obsidian
  const outPath = writeBriefing(split, config.output.path, now, recent.length);

  // 8. Link in daily note (assumes daily note exists; do not create here)
  const vaultPath = config.output.path.replace(/\/AI\/News\/?$/, "");
  await linkInDailyNote(vaultPath, now);

  archive.close();
  labels.close();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[tech-briefing] done in ${elapsed}s — ${outPath}`);
}

main().catch((err) => {
  console.error("[tech-briefing] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test — run the whole pipeline**

```bash
cd ~/Projects/ai-briefing && bun run src/index.ts 2>&1 | tail -20
```

Expected: pipeline runs end-to-end. The step-0 archive ingest reports the backlog on first run (e.g. `parsed=33 skipped=25 inserted=<many>`). Output file at `~/Obsidian/lgl/AI/News/YYYY/MM/YYYY-MM-DD.md`. Console shows per-show counts. Scoring uses few-shot examples drawn from the ingested archive.

- [ ] **Step 3: Re-run pipeline (idempotent — archive ingest no-ops, scoring re-runs)**

```bash
cd ~/Projects/ai-briefing && bun run src/index.ts 2>&1 | tail -20
```

Expected: `archive ingest: parsed=0 skipped=<N> new_picks=0` — nothing new to add. Briefing re-generated.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: tech briefing pipeline — fetch, archive, cluster, score, split, write"
```

---

## Task 15: Remove obsolete code

**Files:**
- Delete: `src/sources/tavily.ts`, `tests/sources/tavily.test.ts`
- Delete: `src/sources/hackernews.ts`, `tests/sources/hackernews.test.ts`
- Delete: `src/summarize.ts`, `tests/summarize.test.ts`
- Delete: `src/dedupe.ts`, `tests/dedupe.test.ts`

- [ ] **Step 1: Remove obsolete files**

```bash
cd ~/Projects/ai-briefing
rm src/sources/tavily.ts tests/sources/tavily.test.ts
rm src/sources/hackernews.ts tests/sources/hackernews.test.ts
rm src/summarize.ts tests/summarize.test.ts
rm src/dedupe.ts tests/dedupe.test.ts
```

- [ ] **Step 2: Run all tests to confirm nothing else depends on them**

```bash
bun test 2>&1 | tail -10
```

Expected: all remaining tests pass. If any test fails with "module not found", it means something still imports a removed file — fix or remove that import.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Tavily/HN sources, old summarize/dedupe modules"
```

---

## Task 16: Deploy + observe

- [ ] **Step 1: Ensure the systemd timer fires tomorrow morning with the new pipeline**

The existing `ai-briefing.timer` at 3am PDT already runs `src/index.ts` — the new pipeline replaces the old in-place.

Verify the service unit still points at the right entry:

```bash
systemctl --user cat ai-briefing.service | head -10
```

If it references `src/index.ts` with `WorkingDirectory=/home/leo/Projects/ai-briefing`, no changes needed.

- [ ] **Step 2: Dry-run from the systemd environment (manually)**

```bash
systemctl --user start ai-briefing.service
journalctl --user -u ai-briefing.service --since "5 min ago" --no-pager | tail -30
```

Expected: log lines from the new pipeline (`[tech-briefing] ...`), successful completion, briefing file at the new path.

- [ ] **Step 3: Verify daily note link update**

```bash
grep -E 'AI/News|Tech Briefing' "/home/leo/Obsidian/lgl/Daily Notes/$(date +%Y/%m/%Y-%m-%d).md" 2>&1
```

Expected: `[[AI/News/YYYY/MM/YYYY-MM-DD|📰 Tech Briefing]]` line is present above `#### Exercise`.

- [ ] **Step 4: Confirm twit.show timers are queued**

```bash
systemctl --user list-timers | grep -E 'ai-briefing|twitshow'
```

Expected: `ai-briefing.timer` entry with next fire tomorrow 3am (no scrape timers — labels come from local archive, not HTTP scraping).

- [ ] **Step 5: Write a short post-deploy note**

Append to your Obsidian Showprep or AI folder — for your own records — what was deployed, current count of picks in `labels.db` per show, and what the briefing looks like on day one. Labels auto-refresh on each 3am run by re-scanning `~/Documents/archive-{twit,mbw,im}/` for new files.

- [ ] **Step 6: Final commit — tag**

```bash
cd ~/Projects/ai-briefing
git tag -a phase-a-complete -m "Phase A tech news briefing deployed: per-show scoring, archive + labels DBs, local archive ingest (HTML/org/CSV)"
git log --oneline -5
```

---

## Phase A acceptance criteria (from spec §12)

- [x] New briefing runs daily via existing `ai-briefing` systemd timer (Task 16.1-2)
- [x] Output at `~/Obsidian/lgl/AI/News/YYYY/MM/YYYY-MM-DD.md` (Task 12)
- [x] Daily note linked to new path (Task 12 + 16.3)
- [x] `archive.db` and `labels.db` populated (Tasks 2, 3, 5, 14)
- [x] Archive ingest populates `labels.db` from `~/Documents/archive-*` (Task 7)
- [x] All code TDD-tested (every task has RED → GREEN → commit)
- [x] 7-day subjective-use evaluation window begins from deploy (Task 16.5)
