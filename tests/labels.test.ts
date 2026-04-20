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
