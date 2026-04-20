import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseOrgFile } from "../../src/twitshow/parse-org";

const org = readFileSync(resolve(import.meta.dir, "fixtures/twit-2026-04-19.org"), "utf-8");

describe("parseOrgFile", () => {
  test("returns correct show and episode_date", () => {
    const parsed = parseOrgFile(org, "twit", "2026-04-19");
    expect(parsed.show).toBe("twit");
    expect(parsed.episode_date).toBe("2026-04-19");
  });

  test("extracts * headings as sections with at least one article each", () => {
    const parsed = parseOrgFile(org, "twit", "2026-04-19");
    // The fixture has 13 top-level sections (* headings)
    expect(parsed.sections.length).toBeGreaterThan(0);
    // Sections are ordered starting at 1
    expect(parsed.sections[0].order).toBe(1);
  });

  test("extracts article titles and URLs from ** headings and *** URL blocks", () => {
    const parsed = parseOrgFile(org, "twit", "2026-04-19");
    const allPicks = parsed.sections.flatMap((s) => s.picks);
    // Fixture has 18 articles with URLs
    expect(allPicks.length).toBeGreaterThan(5);
    // All picks have valid http(s) URLs
    for (const pick of allPicks) {
      expect(pick.url).toMatch(/^https?:\/\//);
    }
  });

  test("rank_in_section is 1-based per section", () => {
    const parsed = parseOrgFile(org, "twit", "2026-04-19");
    for (const section of parsed.sections) {
      section.picks.forEach((p, i) => expect(p.rank_in_section).toBe(i + 1));
    }
  });

  test("article titles come from ** headings", () => {
    const parsed = parseOrgFile(org, "twit", "2026-04-19");
    const allPicks = parsed.sections.flatMap((s) => s.picks);
    // First article is the Google/EFF story
    const firstPick = allPicks[0];
    expect(firstPick.title).toContain("Google Broke");
    expect(firstPick.url).toContain("eff.org");
  });

  test("section names come from * headings", () => {
    const parsed = parseOrgFile(org, "twit", "2026-04-19");
    const names = parsed.sections.map((s) => s.name);
    expect(names).toContain("Google");
    expect(names).toContain("Meta");
  });
});
