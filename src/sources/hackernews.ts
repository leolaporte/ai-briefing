import type { Story, HackernewsConfig } from "../types";

interface HNHit {
  title: string;
  url: string;
  points: number;
  created_at: string;
  objectID: string;
}

interface HNResponse {
  hits: HNHit[];
}

export function buildHNUrl(keyword: string, minPoints: number): string {
  const params = new URLSearchParams({
    query: keyword,
    tags: "story",
    numericFilters: `points>${minPoints}`,
    hitsPerPage: "50",
  });
  return `http://hn.algolia.com/api/v1/search?${params.toString()}`;
}

export function parseHNResponse(response: HNResponse): Story[] {
  return response.hits.map((hit) => ({
    title: hit.title,
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    source: "hackernews" as const,
    sourceName: "Hacker News",
    summary: "",
    publishedAt: new Date(hit.created_at),
    score: hit.points,
  }));
}

export async function fetchHackerNews(config: HackernewsConfig): Promise<Story[]> {
  const seen = new Set<string>();
  const allStories: Story[] = [];

  for (const keyword of config.keywords) {
    try {
      const url = buildHNUrl(keyword, config.min_points);
      const res = await fetch(url);

      if (!res.ok) {
        console.error(`[hn] keyword "${keyword}" failed: ${res.status}`);
        continue;
      }

      const data = (await res.json()) as HNResponse;
      for (const story of parseHNResponse(data)) {
        if (!seen.has(story.url)) {
          seen.add(story.url);
          allStories.push(story);
        }
      }
    } catch (err) {
      console.error(`[hn] keyword "${keyword}" error:`, err);
    }
  }

  return allStories
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, config.max_stories);
}
