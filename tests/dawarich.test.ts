import { describe, test, expect } from "bun:test";
import { fetchLatestLocation, parseLatestPoint } from "../src/dawarich";

const nowSec = () => Math.floor(Date.now() / 1000);

describe("parseLatestPoint", () => {
  test("parses psql -tAc row with lat|lon|timestamp", () => {
    const row = "38.2352865693071|-122.65579254145848|1776871159";
    const p = parseLatestPoint(row);
    expect(p).not.toBeNull();
    expect(p!.lat).toBeCloseTo(38.235286, 5);
    expect(p!.lon).toBeCloseTo(-122.655792, 5);
    expect(p!.timestamp).toBe(1776871159);
  });

  test("returns null on empty input", () => {
    expect(parseLatestPoint("")).toBeNull();
    expect(parseLatestPoint("\n")).toBeNull();
    expect(parseLatestPoint("   ")).toBeNull();
  });

  test("returns null when a field fails to parse", () => {
    expect(parseLatestPoint("abc|def|ghi")).toBeNull();
    expect(parseLatestPoint("38.0|-122.0")).toBeNull(); // missing ts
  });
});

describe("fetchLatestLocation", () => {
  test("returns the point when within freshness window", async () => {
    const ts = nowSec() - 120;
    const runner = () => `38.2352865693071|-122.65579254145848|${ts}`;
    const result = await fetchLatestLocation({ maxAgeSec: 24 * 3600 }, runner);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(38.23528, 4);
    expect(result!.lon).toBeCloseTo(-122.65579, 4);
    expect(result!.ageSec).toBeLessThan(180);
  });

  test("returns null when point is older than maxAgeSec", async () => {
    const ts = nowSec() - 25 * 3600;
    const runner = () => `38.23|-122.63|${ts}`;
    const result = await fetchLatestLocation({ maxAgeSec: 24 * 3600 }, runner);
    expect(result).toBeNull();
  });

  test("returns null when runner returns null (docker exec failed)", async () => {
    const runner = () => null;
    const result = await fetchLatestLocation({ maxAgeSec: 24 * 3600 }, runner);
    expect(result).toBeNull();
  });

  test("returns null when runner returns empty string", async () => {
    const runner = () => "";
    const result = await fetchLatestLocation({ maxAgeSec: 24 * 3600 }, runner);
    expect(result).toBeNull();
  });

  test("returns null when runner throws", async () => {
    const runner = () => {
      throw new Error("docker not on PATH");
    };
    const result = await fetchLatestLocation({ maxAgeSec: 24 * 3600 }, runner);
    expect(result).toBeNull();
  });

  test("issues the expected SELECT against the points table", async () => {
    let capturedSql = "";
    const runner = (sql: string) => {
      capturedSql = sql;
      return `38|-122|${nowSec()}`;
    };
    await fetchLatestLocation({ maxAgeSec: 3600 }, runner);
    expect(capturedSql).toContain("ST_Y(lonlat::geometry)");
    expect(capturedSql).toContain("ST_X(lonlat::geometry)");
    expect(capturedSql).toContain("FROM points");
    expect(capturedSql).toContain("ORDER BY timestamp DESC");
    expect(capturedSql).toContain("LIMIT 1");
  });
});
