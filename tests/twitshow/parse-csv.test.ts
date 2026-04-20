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
