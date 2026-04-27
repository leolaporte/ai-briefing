import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { LabelStore } from "../src/labels";

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

const TMP_DB = "/tmp/ai-briefing-labels-test.sqlite";

describe("LabelStore", () => {
  beforeEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });
  afterEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

  test("insertPicks stores and dedupes within the same (show, episode_date, url)", () => {
    const store = new LabelStore(TMP_DB);
    store.insertPicks([
      { show: "twit", episode_date: "2026-04-19", section_name: "AI", section_order: 1,
        rank_in_section: 1, story_url: "https://example.com/a", story_title: "A",
        source_file: "fixture.html", weight: 1.0, source: "archive" },
      { show: "twit", episode_date: "2026-04-19", section_name: "AI", section_order: 1,
        rank_in_section: 2, story_url: "https://example.com/a", story_title: "A (dup)",
        source_file: "fixture.html", weight: 1.0, source: "archive" },
    ]);
    expect(store.countByShow("twit")).toBe(1);
    store.close();
  });

  test("getRecentPicks returns newest-first and respects show filter", () => {
    const store = new LabelStore(TMP_DB);
    store.insertPicks([
      { show: "twit", episode_date: "2026-04-12", section_name: "AI", section_order: 1,
        rank_in_section: 1, story_url: "https://example.com/old", story_title: "Old",
        source_file: null, weight: 1.0, source: "archive" },
      { show: "twit", episode_date: "2026-04-19", section_name: "AI", section_order: 1,
        rank_in_section: 1, story_url: "https://example.com/new", story_title: "New",
        source_file: null, weight: 1.0, source: "archive" },
      { show: "mbw", episode_date: "2026-04-14", section_name: "Apple", section_order: 1,
        rank_in_section: 1, story_url: "https://example.com/mbw", story_title: "MBW",
        source_file: null, weight: 1.0, source: "archive" },
    ]);
    const recent = store.getRecentPicks("twit", 10);
    expect(recent.length).toBe(2);
    expect(recent[0].story_title).toBe("New");
    store.close();
  });
});

test("conflict: show_notes upsert preserves existing show_notes", () => {
  const store = new LabelStore(TEST_DB);
  store.insertLabeledPicks([{
    show: "twit", episode_date: "2026-04-26",
    story_url: "https://example.com/x", story_title: "X",
    source: "show_notes", weight: 1.0,
  }]);
  store.insertLabeledPicks([{
    show: "twit", episode_date: "2026-04-26",
    story_url: "https://example.com/x", story_title: "X",
    source: "raindrop", weight: 0.5,
  }]);
  const rows = store.allPicks("twit");
  expect(rows[0].source).toBe("show_notes");
  expect(rows[0].weight).toBe(1.0); // MAX(1.0, 0.5)
  store.close();
});

test("conflict: raindrop upgrades archive", () => {
  const store = new LabelStore(TEST_DB);
  store.insertLabeledPicks([{
    show: "mbw", episode_date: "2026-04-21",
    story_url: "https://example.com/y", story_title: "Y",
    source: "archive", weight: 1.0,
  }]);
  store.insertLabeledPicks([{
    show: "mbw", episode_date: "2026-04-21",
    story_url: "https://example.com/y", story_title: "Y",
    source: "raindrop", weight: 0.5,
  }]);
  const rows = store.allPicks("mbw");
  expect(rows[0].source).toBe("raindrop");
  store.close();
});

test("insertLabeledPicks counters: inserted vs upgraded vs no-op", () => {
  const store = new LabelStore(TEST_DB);
  // First insert: should be inserted
  let r = store.insertLabeledPicks([{
    show: "im", episode_date: "2026-04-22",
    story_url: "https://example.com/z", story_title: "Z",
    source: "archive", weight: 1.0,
  }]);
  expect(r.inserted).toBe(1);
  expect(r.upgraded).toBe(0);

  // Same row, raindrop: should be upgraded (archive → raindrop)
  r = store.insertLabeledPicks([{
    show: "im", episode_date: "2026-04-22",
    story_url: "https://example.com/z", story_title: "Z",
    source: "raindrop", weight: 0.5,
  }]);
  expect(r.inserted).toBe(0);
  expect(r.upgraded).toBe(1);

  // Same row, raindrop again: no-op (no change)
  r = store.insertLabeledPicks([{
    show: "im", episode_date: "2026-04-22",
    story_url: "https://example.com/z", story_title: "Z",
    source: "raindrop", weight: 0.5,
  }]);
  expect(r.inserted).toBe(0);
  expect(r.upgraded).toBe(0); // ← catches the over-counting bug from Issue 1

  store.close();
});
