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
