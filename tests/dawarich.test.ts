import { describe, test, expect } from "bun:test";
import { fetchLatestLocation } from "../src/dawarich";

const FAKE_URL = "http://dawarich.example";
const FAKE_KEY = "test-key";

function makeFetch(response: { status: number; body?: unknown } | Error): typeof fetch {
  return (async (_input: unknown, init?: RequestInit) => {
    if (response instanceof Error) throw response;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers["Authorization"] !== `Bearer ${FAKE_KEY}`) {
      return new Response("unauthorized", { status: 401 });
    }
    return new Response(JSON.stringify(response.body ?? []), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("fetchLatestLocation", () => {
  test("returns the most recent point when within freshness window", async () => {
    const body = [
      {
        id: 1439,
        latitude: "38.2352865693071",
        longitude: "-122.65579254145848",
        timestamp: nowSec() - 120, // 2 min ago
        accuracy: 12,
      },
    ];
    const result = await fetchLatestLocation(
      { url: FAKE_URL, apiKey: FAKE_KEY, maxAgeSec: 24 * 3600 },
      makeFetch({ status: 200, body })
    );
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(38.23528, 4);
    expect(result!.lon).toBeCloseTo(-122.65579, 4);
    expect(result!.ageSec).toBeLessThan(180);
  });

  test("returns null when the most recent point is older than maxAgeSec", async () => {
    const body = [
      {
        id: 1317,
        latitude: "38.235",
        longitude: "-122.655",
        timestamp: nowSec() - 23 * 24 * 3600, // 23 days ago
        accuracy: 4,
      },
    ];
    const result = await fetchLatestLocation(
      { url: FAKE_URL, apiKey: FAKE_KEY, maxAgeSec: 24 * 3600 },
      makeFetch({ status: 200, body })
    );
    expect(result).toBeNull();
  });

  test("returns null when the points array is empty", async () => {
    const result = await fetchLatestLocation(
      { url: FAKE_URL, apiKey: FAKE_KEY, maxAgeSec: 24 * 3600 },
      makeFetch({ status: 200, body: [] })
    );
    expect(result).toBeNull();
  });

  test("returns null when HTTP request fails", async () => {
    const result = await fetchLatestLocation(
      { url: FAKE_URL, apiKey: FAKE_KEY, maxAgeSec: 24 * 3600 },
      makeFetch(new Error("connection refused"))
    );
    expect(result).toBeNull();
  });

  test("returns null when API key is empty (skips Dawarich entirely)", async () => {
    const result = await fetchLatestLocation(
      { url: FAKE_URL, apiKey: "", maxAgeSec: 24 * 3600 },
      makeFetch({ status: 200, body: [{ timestamp: nowSec() }] })
    );
    expect(result).toBeNull();
  });

  test("sends Authorization header and ?order=desc&per_page=1", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    const spy = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : String(input);
      const h = (init?.headers ?? {}) as Record<string, string>;
      capturedAuth = h["Authorization"] ?? "";
      return new Response(
        JSON.stringify([{ latitude: "38", longitude: "-122", timestamp: nowSec() }]),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    await fetchLatestLocation(
      { url: FAKE_URL, apiKey: FAKE_KEY, maxAgeSec: 3600 },
      spy
    );
    expect(capturedUrl).toContain("/api/v1/points");
    expect(capturedUrl).toContain("order=desc");
    expect(capturedUrl).toContain("per_page=1");
    expect(capturedAuth).toBe(`Bearer ${FAKE_KEY}`);
  });
});
