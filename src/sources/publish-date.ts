import type { Story } from "../types";

// Extracts the original publication date from an HTML page.
//
// Aggregator feeds (HN, MetaFilter, Pinboard, Lobsters) report their own
// posting time as the RSS pubDate, not the linked article's actual
// publish date. To gate on real publish date we have to look at the
// underlying article. Open Graph's article:published_time is widely
// supported (the WordPress + Yoast world plus most news CMSes); JSON-LD
// datePublished covers most of the rest.

function tryParseDate(s: string): Date | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function extractFromOg(html: string): Date | null {
  // <meta property="article:published_time" content="..." />
  // or <meta content="..." property="article:published_time" />
  const propFirst = html.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i);
  if (propFirst) {
    const d = tryParseDate(propFirst[1]);
    if (d) return d;
  }
  const contentFirst = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i);
  if (contentFirst) {
    const d = tryParseDate(contentFirst[1]);
    if (d) return d;
  }
  return null;
}

function findDatePublishedInJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const d = findDatePublishedInJson(item);
      if (d) return d;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.datePublished === "string") return obj.datePublished;
    for (const key of Object.keys(obj)) {
      const d = findDatePublishedInJson(obj[key]);
      if (d) return d;
    }
  }
  return null;
}

function extractFromJsonLd(html: string): Date | null {
  const blockRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = blockRe.exec(html)) !== null) {
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw);
      const dateStr = findDatePublishedInJson(parsed);
      if (dateStr) {
        const d = tryParseDate(dateStr);
        if (d) return d;
      }
    } catch {
      // malformed block, try next
      continue;
    }
  }
  return null;
}

export function extractPublishDate(html: string): Date | null {
  if (!html) return null;
  return extractFromOg(html) ?? extractFromJsonLd(html);
}

const FETCH_TIMEOUT_MS = 5000;
const USER_AGENT = "ai-briefing/1.0 (+https://leo.fm; publish-date probe)";
const MAX_BODY_BYTES = 512 * 1024; // 512KB is plenty for <head>

// fetchPublishDate retrieves a URL and returns the parsed publish date,
// or null on any failure (timeout, non-200, no metadata, oversized body).
// All failure modes are silent — caller decides what to do with null.
export async function fetchPublishDate(url: string): Promise<Date | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.5" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    // Read up to MAX_BODY_BYTES; we only need the <head>.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(
      Buffer.concat(chunks.map((c) => Buffer.from(c)))
    );
    return extractPublishDate(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// isAggregatorSource returns true if the feed name matches any
// configured aggregator pattern (case-insensitive substring match).
// Aggregators (HN, Pinboard, MetaFilter, Lobsters) report their own
// posting time as <pubDate>, not the linked article's real publish date.
export function isAggregatorSource(feedName: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const name = feedName.toLowerCase();
  return patterns.some((p) => name.includes(p.toLowerCase()));
}

// enrichAggregatorDates: for each story whose sourceName matches an
// aggregator pattern, fetch the linked URL and replace publishedAt with
// the real publish date from Open Graph / JSON-LD. Stories whose real
// date can't be determined are dropped from the result. Non-aggregator
// stories pass through unchanged with no fetch.
const ENRICH_CONCURRENCY = 8;

export async function enrichAggregatorDates(
  stories: Story[],
  aggregatorPatterns: string[],
): Promise<Story[]> {
  // Tag each story with its index so we can preserve order in output.
  const aggregatorIdx: number[] = [];
  for (let i = 0; i < stories.length; i++) {
    if (isAggregatorSource(stories[i].sourceName, aggregatorPatterns)) {
      aggregatorIdx.push(i);
    }
  }
  if (aggregatorIdx.length === 0) return stories;

  // Fetch real publish dates with bounded concurrency.
  const realDates = new Map<number, Date | null>();
  let cursor = 0;
  async function worker() {
    while (true) {
      const taken = cursor++;
      if (taken >= aggregatorIdx.length) return;
      const idx = aggregatorIdx[taken];
      const real = await fetchPublishDate(stories[idx].url);
      realDates.set(idx, real);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(ENRICH_CONCURRENCY, aggregatorIdx.length) }, worker),
  );

  const out: Story[] = [];
  for (let i = 0; i < stories.length; i++) {
    if (!realDates.has(i)) {
      out.push(stories[i]);
      continue;
    }
    const real = realDates.get(i);
    if (real === null || real === undefined) continue; // drop — can't verify
    out.push({ ...stories[i], publishedAt: real });
  }
  return out;
}
