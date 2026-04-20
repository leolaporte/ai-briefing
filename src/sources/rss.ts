import { readFileSync, existsSync } from "fs";
import type { Story, RssConfig, RssFeed } from "../types";

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

      if (!dateStr) continue;
      const publishedAt = new Date(dateStr);
      if (isNaN(publishedAt.getTime())) continue;
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

export function parseOpml(xml: string): RssFeed[] {
  const feeds: RssFeed[] = [];
  const outlineRegex = /<outline[^>]*>/gi;
  let match;

  while ((match = outlineRegex.exec(xml)) !== null) {
    const tag = match[0];
    const xmlUrlMatch = tag.match(/xmlUrl="([^"]*)"/i);
    if (!xmlUrlMatch) continue;

    const url = xmlUrlMatch[1];
    const textMatch = tag.match(/text="([^"]*)"/i);
    const name = textMatch?.[1] || url;

    feeds.push({ url, name });
  }

  return feeds;
}

function loadFeeds(config: RssConfig): RssFeed[] {
  const feeds = [...config.feeds];

  if (config.opml_file) {
    const opmlPath = config.opml_file.startsWith("~")
      ? config.opml_file.replace("~", process.env.HOME ?? "/home/leo")
      : config.opml_file;

    if (existsSync(opmlPath)) {
      const opmlXml = readFileSync(opmlPath, "utf-8");
      const opmlFeeds = parseOpml(opmlXml);
      console.log(`[rss] loaded ${opmlFeeds.length} feeds from OPML: ${opmlPath}`);
      feeds.push(...opmlFeeds);
    } else {
      console.error(`[rss] OPML file not found: ${opmlPath}`);
    }
  }

  // Dedupe by URL
  const seen = new Set<string>();
  return feeds.filter((f) => {
    if (seen.has(f.url)) return false;
    seen.add(f.url);
    return true;
  });
}

export async function fetchRss(config: RssConfig): Promise<Story[]> {
  const allFeeds = loadFeeds(config);
  const allStories: Story[] = [];

  const results = await Promise.allSettled(
    allFeeds.map(async (feed) => {
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
