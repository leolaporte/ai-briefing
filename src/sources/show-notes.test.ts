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
