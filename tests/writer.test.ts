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
