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

test("extractShowNotesLinks decodes HTML entities in titles", () => {
  const html = `<h3>Links</h3><a href="https://example.com/a">Tom &amp; Jerry: It&#8217;s back</a>`;
  const links = extractShowNotesLinks(html);
  expect(links).toHaveLength(1);
  expect(links[0].title).toBe("Tom & Jerry: It’s back");
});

test("parseEpisodeListing parses date without comma (Apr 26 2026 format)", () => {
  const html = `
    <a href="/shows/this-week-in-tech/episodes/1081?autostart=false">
      <span class="date">Apr 26 2026</span>
    </a>
  `;
  const result = parseEpisodeListing(html);
  expect(result).not.toBeNull();
  expect(result!.number).toBe(1081);
  expect(result!.date).toBe("2026-04-26");
});
