import { describe, test, expect } from "bun:test";
import { parseRssXml, parseOpml } from "../../src/sources/rss";

// Use dynamic dates so tests don't expire as time passes
const recentDate = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6 hours ago
const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
const recentRfc = recentDate.toUTCString();
const oldRfc = oldDate.toUTCString();
const recentIso = recentDate.toISOString();

const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>AI breakthrough announced</title>
      <link>https://example.com/ai-breakthrough</link>
      <description>A major AI breakthrough was announced today.</description>
      <pubDate>${recentRfc}</pubDate>
    </item>
    <item>
      <title>Old news story</title>
      <link>https://example.com/old-news</link>
      <description>This happened a week ago.</description>
      <pubDate>${oldRfc}</pubDate>
    </item>
  </channel>
</rss>`;

const sampleAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>New model released</title>
    <link href="https://example.com/new-model"/>
    <summary>A new open source model dropped today.</summary>
    <updated>${recentIso}</updated>
  </entry>
</feed>`;

describe("parseRssXml", () => {
  test("parses RSS 2.0 items into Story array", () => {
    const stories = parseRssXml(sampleRss, "Test Feed", 48);
    expect(stories.length).toBeGreaterThanOrEqual(1);
    expect(stories[0].title).toBe("AI breakthrough announced");
    expect(stories[0].source).toBe("rss");
    expect(stories[0].sourceName).toBe("Test Feed");
    expect(stories[0].url).toBe("https://example.com/ai-breakthrough");
    expect(stories[0].summary).toBe("A major AI breakthrough was announced today.");
  });

  test("filters out items older than maxAgeHours", () => {
    const stories = parseRssXml(sampleRss, "Test Feed", 48);
    const oldStory = stories.find((s) => s.title === "Old news story");
    expect(oldStory).toBeUndefined();
  });

  test("parses Atom feeds", () => {
    const stories = parseRssXml(sampleAtom, "Atom Feed", 48);
    expect(stories).toHaveLength(1);
    expect(stories[0].title).toBe("New model released");
    expect(stories[0].url).toBe("https://example.com/new-model");
  });

  test("returns empty array for invalid XML", () => {
    const stories = parseRssXml("not xml", "Bad Feed", 48);
    expect(stories).toHaveLength(0);
  });
});

describe("parseOpml", () => {
  test("extracts feeds from OPML XML", () => {
    const opml = `<opml version="2.0"><head><title>Test</title></head><body>
      <outline text="404 Media" type="rss" xmlUrl="https://www.404media.co/rss/"/>
      <outline text="Ars Technica" type="rss" xmlUrl="https://arstechnica.com/feed/" htmlUrl="https://arstechnica.com/"/>
      <outline text="No URL" type="rss"/>
    </body></opml>`;

    const feeds = parseOpml(opml);
    expect(feeds).toHaveLength(2);
    expect(feeds[0].name).toBe("404 Media");
    expect(feeds[0].url).toBe("https://www.404media.co/rss/");
    expect(feeds[1].name).toBe("Ars Technica");
    expect(feeds[1].url).toBe("https://arstechnica.com/feed/");
  });

  test("returns empty array for empty OPML", () => {
    const feeds = parseOpml("<opml><body></body></opml>");
    expect(feeds).toHaveLength(0);
  });
});
