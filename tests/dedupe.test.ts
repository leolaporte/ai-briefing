import { describe, test, expect } from "bun:test";
import { dedupeAndRank } from "../src/dedupe";
import type { Story } from "../src/types";

function makeStory(overrides: Partial<Story>): Story {
  return {
    title: "Default Title",
    url: "https://example.com/default",
    source: "tavily",
    sourceName: "Tavily",
    summary: "Default summary",
    publishedAt: new Date("2026-04-03T12:00:00Z"),
    ...overrides,
  };
}

describe("dedupeAndRank", () => {
  test("removes exact URL duplicates", () => {
    const stories = [
      makeStory({ title: "Story A", url: "https://example.com/1", source: "tavily" }),
      makeStory({ title: "Story A from HN", url: "https://example.com/1", source: "hackernews" }),
    ];
    const result = dedupeAndRank(stories, 30);
    expect(result).toHaveLength(1);
  });

  test("removes title-similar duplicates", () => {
    const stories = [
      makeStory({ title: "OpenAI Releases GPT-5", url: "https://a.com/1", source: "tavily" }),
      makeStory({ title: "OpenAI releases GPT-5!", url: "https://b.com/2", source: "rss" }),
    ];
    const result = dedupeAndRank(stories, 30);
    expect(result).toHaveLength(1);
  });

  test("keeps stories with different titles", () => {
    const stories = [
      makeStory({ title: "OpenAI launches GPT-5", url: "https://a.com/1" }),
      makeStory({ title: "Anthropic ships Claude update", url: "https://b.com/2" }),
    ];
    const result = dedupeAndRank(stories, 30);
    expect(result).toHaveLength(2);
  });

  test("caps results at maxStories", () => {
    const stories = Array.from({ length: 50 }, (_, i) =>
      makeStory({ title: `Story ${i}`, url: `https://example.com/${i}` })
    );
    const result = dedupeAndRank(stories, 30);
    expect(result).toHaveLength(30);
  });

  test("ranks higher-scored stories first", () => {
    const stories = [
      makeStory({ title: "Low score", url: "https://a.com/1", score: 10 }),
      makeStory({ title: "High score", url: "https://b.com/2", score: 500 }),
    ];
    const result = dedupeAndRank(stories, 30);
    expect(result[0].title).toBe("High score");
  });
});
