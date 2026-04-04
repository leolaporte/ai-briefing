import type { Story } from "./types";

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function titlesAreSimilar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb;
}

export function dedupeAndRank(stories: Story[], maxStories: number): Story[] {
  const deduped: Story[] = [];
  const seenUrls = new Set<string>();

  for (const story of stories) {
    if (seenUrls.has(story.url)) continue;

    const isDuplicate = deduped.some((existing) => titlesAreSimilar(existing.title, story.title));
    if (isDuplicate) continue;

    seenUrls.add(story.url);
    deduped.push(story);
  }

  const now = Date.now();
  return deduped
    .sort((a, b) => {
      const scoreA = (a.score ?? 0) + (1 - (now - a.publishedAt.getTime()) / (24 * 60 * 60 * 1000));
      const scoreB = (b.score ?? 0) + (1 - (now - b.publishedAt.getTime()) / (24 * 60 * 60 * 1000));
      return scoreB - scoreA;
    })
    .slice(0, maxStories);
}
