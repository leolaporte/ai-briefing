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
