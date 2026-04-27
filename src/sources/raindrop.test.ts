// src/sources/raindrop.test.ts
import { test, expect } from "bun:test";
import { fetchRaindropHistory, parseRaindropHistoryOutput } from "./raindrop";
import { readFileSync } from "fs";
import { resolve } from "path";

const FIXTURE = readFileSync(
  resolve(import.meta.dir, "..", "..", "tests", "fixtures", "raindrop-week.json"),
  "utf-8"
);

test("parseRaindropHistoryOutput parses NDJSON into array", () => {
  const records = parseRaindropHistoryOutput(FIXTURE);
  expect(records.length).toBeGreaterThan(0);
  for (const r of records) {
    expect(typeof r.url).toBe("string");
    expect(typeof r.title).toBe("string");
    expect(Array.isArray(r.tags)).toBe(true);
    expect(typeof r.created_at).toBe("string");
  }
});

test("parseRaindropHistoryOutput skips blank lines", () => {
  const out = parseRaindropHistoryOutput(`{"url":"https://example.com/a","title":"A","tags":[],"created_at":"x"}\n\n\n`);
  expect(out).toHaveLength(1);
});

test("parseRaindropHistoryOutput throws on malformed JSON", () => {
  expect(() => parseRaindropHistoryOutput("not json")).toThrow();
});
