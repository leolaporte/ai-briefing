import { describe, test, expect } from "bun:test";
import { extractPublishDate, fetchPublishDate, isAggregatorSource, enrichAggregatorDates } from "../../src/sources/publish-date";
import type { Story } from "../../src/types";

describe("extractPublishDate", () => {
  test("returns date from og:article:published_time meta tag", () => {
    const html = `
      <html><head>
        <meta property="article:published_time" content="2026-04-14T16:01:00-07:00" />
      </head><body>...</body></html>
    `;
    const got = extractPublishDate(html);
    expect(got).not.toBeNull();
    expect(got!.toISOString()).toBe("2026-04-14T23:01:00.000Z");
  });

  test("returns date from og:article:published_time with double quotes around content first", () => {
    const html = `<meta content="2026-03-01T10:00:00Z" property="article:published_time">`;
    const got = extractPublishDate(html);
    expect(got).not.toBeNull();
    expect(got!.toISOString()).toBe("2026-03-01T10:00:00.000Z");
  });

  test("falls back to JSON-LD datePublished when og missing", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"NewsArticle","datePublished":"2026-04-14T16:01:00Z"}
        </script>
      </head></html>
    `;
    const got = extractPublishDate(html);
    expect(got).not.toBeNull();
    expect(got!.toISOString()).toBe("2026-04-14T16:01:00.000Z");
  });

  test("prefers og:article:published_time over JSON-LD when both present", () => {
    const html = `
      <meta property="article:published_time" content="2026-04-14T16:01:00Z" />
      <script type="application/ld+json">{"datePublished":"2024-01-01T00:00:00Z"}</script>
    `;
    const got = extractPublishDate(html);
    expect(got).not.toBeNull();
    expect(got!.toISOString()).toBe("2026-04-14T16:01:00.000Z");
  });

  test("handles JSON-LD as array with multiple objects, picks first datePublished", () => {
    const html = `
      <script type="application/ld+json">
        [
          {"@type":"BreadcrumbList","itemListElement":[]},
          {"@type":"NewsArticle","datePublished":"2026-02-15T08:00:00Z"}
        ]
      </script>
    `;
    const got = extractPublishDate(html);
    expect(got).not.toBeNull();
    expect(got!.toISOString()).toBe("2026-02-15T08:00:00.000Z");
  });

  test("returns null when neither og nor JSON-LD has a date", () => {
    const html = `<html><head><title>No date here</title></head></html>`;
    expect(extractPublishDate(html)).toBeNull();
  });

  test("returns null on completely empty HTML", () => {
    expect(extractPublishDate("")).toBeNull();
  });

  test("returns null when og content is unparseable", () => {
    const html = `<meta property="article:published_time" content="not a date" />`;
    expect(extractPublishDate(html)).toBeNull();
  });

  test("returns null on malformed JSON-LD block", () => {
    const html = `<script type="application/ld+json">{not valid json}</script>`;
    expect(extractPublishDate(html)).toBeNull();
  });

  test("skips malformed JSON-LD blocks and uses subsequent valid one", () => {
    const html = `
      <script type="application/ld+json">{not valid json}</script>
      <script type="application/ld+json">{"datePublished":"2026-01-15T12:00:00Z"}</script>
    `;
    const got = extractPublishDate(html);
    expect(got).not.toBeNull();
    expect(got!.toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  test("fetchPublishDate returns extracted date on 200", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(_req) {
        return new Response(
          `<meta property="article:published_time" content="2026-04-14T16:01:00Z" />`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      },
    });
    try {
      const got = await fetchPublishDate(`http://localhost:${server.port}/article`);
      expect(got).not.toBeNull();
      expect(got!.toISOString()).toBe("2026-04-14T16:01:00.000Z");
    } finally {
      server.stop(true);
    }
  });

  test("fetchPublishDate returns null on 404", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const got = await fetchPublishDate(`http://localhost:${server.port}/missing`);
      expect(got).toBeNull();
    } finally {
      server.stop(true);
    }
  });

  test("fetchPublishDate returns null when page lacks date metadata", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("<html><body>no metadata</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      },
    });
    try {
      const got = await fetchPublishDate(`http://localhost:${server.port}/blank`);
      expect(got).toBeNull();
    } finally {
      server.stop(true);
    }
  });

  test("fetchPublishDate returns null on connection failure", async () => {
    // Port 1 is reserved + nothing listens; should fail fast
    const got = await fetchPublishDate("http://127.0.0.1:1/never");
    expect(got).toBeNull();
  });

  test("isAggregatorSource matches configured patterns case-insensitively", () => {
    const patterns = ["Hacker News", "MetaFilter", "Pinboard", "Lobsters"];
    expect(isAggregatorSource("Hacker News", patterns)).toBe(true);
    expect(isAggregatorSource("hacker news", patterns)).toBe(true);
    expect(isAggregatorSource("Lobsters: Top Stories of the Past Week", patterns)).toBe(true);
    expect(isAggregatorSource("Pinboard (popular bookmarks)", patterns)).toBe(true);
    expect(isAggregatorSource("Ars Technica", patterns)).toBe(false);
    expect(isAggregatorSource("EFF Deeplinks", patterns)).toBe(false);
  });

  test("isAggregatorSource returns false when patterns is empty", () => {
    expect(isAggregatorSource("Hacker News", [])).toBe(false);
  });

  test("enrichAggregatorDates: replaces publishedAt for aggregator stories with real date from URL", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/eff-article") {
          return new Response(
            `<meta property="article:published_time" content="2026-04-14T16:01:00Z" />`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("nope", { status: 404 });
      },
    });
    try {
      const baseUrl = `http://localhost:${server.port}`;
      const aggregatorPubDate = new Date("2026-04-18T12:00:00Z"); // when HN/Pinboard featured it
      const stories: Story[] = [
        {
          title: "Old EFF article surfaced on HN",
          url: `${baseUrl}/eff-article`,
          source: "rss",
          sourceName: "Hacker News",
          summary: "",
          publishedAt: aggregatorPubDate,
        },
      ];
      const result = await enrichAggregatorDates(stories, ["Hacker News"]);
      expect(result.length).toBe(1);
      expect(result[0].publishedAt.toISOString()).toBe("2026-04-14T16:01:00.000Z");
    } finally {
      server.stop(true);
    }
  });

  test("enrichAggregatorDates: drops aggregator stories whose real date can't be fetched", async () => {
    const stories: Story[] = [
      {
        title: "HN story to a dead link",
        url: "http://127.0.0.1:1/never",
        source: "rss",
        sourceName: "Hacker News",
        summary: "",
        publishedAt: new Date("2026-04-25T00:00:00Z"),
      },
    ];
    const result = await enrichAggregatorDates(stories, ["Hacker News"]);
    expect(result.length).toBe(0);
  });

  test("enrichAggregatorDates: leaves non-aggregator stories untouched (does not fetch)", async () => {
    let fetchedCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        fetchedCount++;
        return new Response("", { status: 200 });
      },
    });
    try {
      const baseUrl = `http://localhost:${server.port}`;
      const original = new Date("2026-04-20T10:00:00Z");
      const stories: Story[] = [
        {
          title: "Real EFF post via direct EFF feed",
          url: `${baseUrl}/eff-article`,
          source: "rss",
          sourceName: "EFF Deeplinks",
          summary: "",
          publishedAt: original,
        },
      ];
      const result = await enrichAggregatorDates(stories, ["Hacker News", "MetaFilter"]);
      expect(result.length).toBe(1);
      expect(result[0].publishedAt.toISOString()).toBe(original.toISOString());
      expect(fetchedCount).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("enrichAggregatorDates: handles a mix of aggregator and direct stories correctly", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/aggregated") {
          return new Response(
            `<meta property="article:published_time" content="2026-04-10T00:00:00Z" />`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const baseUrl = `http://localhost:${server.port}`;
      const directDate = new Date("2026-04-22T10:00:00Z");
      const aggregatorBogusDate = new Date("2026-04-25T05:00:00Z");
      const stories: Story[] = [
        {
          title: "Direct feed",
          url: `${baseUrl}/whatever`,
          source: "rss",
          sourceName: "Ars Technica",
          summary: "",
          publishedAt: directDate,
        },
        {
          title: "From HN, real date is older",
          url: `${baseUrl}/aggregated`,
          source: "rss",
          sourceName: "Hacker News",
          summary: "",
          publishedAt: aggregatorBogusDate,
        },
      ];
      const result = await enrichAggregatorDates(stories, ["Hacker News"]);
      expect(result.length).toBe(2);
      const direct = result.find((s) => s.sourceName === "Ars Technica")!;
      const hn = result.find((s) => s.sourceName === "Hacker News")!;
      expect(direct.publishedAt.toISOString()).toBe(directDate.toISOString());
      expect(hn.publishedAt.toISOString()).toBe("2026-04-10T00:00:00.000Z");
    } finally {
      server.stop(true);
    }
  });

  test("handles Pinboard-style real-world example: EFF article", () => {
    // Modeled on what eff.org actually returns
    const html = `
      <html><head>
        <meta property="og:title" content="Google Broke Its Promise to Me. Now ICE Has My Data." />
        <meta property="article:published_time" content="2026-04-14T23:01:00+00:00" />
        <meta property="article:modified_time" content="2026-04-15T10:00:00+00:00" />
      </head></html>
    `;
    const got = extractPublishDate(html);
    expect(got).not.toBeNull();
    expect(got!.toISOString()).toBe("2026-04-14T23:01:00.000Z");
  });
});
