import type { Story, RssConfig } from "../types";

function extractTag(xml: string, tag: string): string {
  const attrMatch = xml.match(new RegExp(`<${tag}[^>]*href="([^"]*)"`, "i"));
  if (attrMatch && tag === "link") return attrMatch[1];

  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"))
    ?? xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

export function parseRssXml(xml: string, feedName: string, maxAgeHours: number): Story[] {
  try {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    const stories: Story[] = [];

    const isAtom = xml.includes("<feed") && xml.includes("xmlns=\"http://www.w3.org/2005/Atom\"");
    const itemRegex = isAtom ? /<entry[\s>]([\s\S]*?)<\/entry>/gi : /<item[\s>]([\s\S]*?)<\/item>/gi;

    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = extractTag(block, "title");
      const link = extractTag(block, "link");
      const summary = extractTag(block, isAtom ? "summary" : "description");
      const dateStr = extractTag(block, isAtom ? "updated" : "pubDate");

      const publishedAt = dateStr ? new Date(dateStr) : new Date();

      if (publishedAt < cutoff) continue;

      stories.push({
        title,
        url: link,
        source: "rss",
        sourceName: feedName,
        summary: summary.replace(/<[^>]*>/g, "").slice(0, 300),
        publishedAt,
      });
    }

    return stories;
  } catch (err) {
    console.error(`[rss] failed to parse feed "${feedName}":`, err);
    return [];
  }
}

export async function fetchRss(config: RssConfig): Promise<Story[]> {
  const allStories: Story[] = [];

  const results = await Promise.allSettled(
    config.feeds.map(async (feed) => {
      try {
        const res = await fetch(feed.url);
        if (!res.ok) {
          console.error(`[rss] ${feed.name} failed: ${res.status}`);
          return [];
        }
        const xml = await res.text();
        return parseRssXml(xml, feed.name, 24);
      } catch (err) {
        console.error(`[rss] ${feed.name} error:`, err);
        return [];
      }
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      allStories.push(...result.value);
    }
  }

  return allStories;
}
