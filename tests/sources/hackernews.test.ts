import { describe, test, expect } from "bun:test";
import { parseHNResponse, buildHNUrl } from "../../src/sources/hackernews";

describe("buildHNUrl", () => {
  test("builds Algolia search URL with keyword and tags", () => {
    const url = buildHNUrl("AI", 20);
    expect(url).toContain("http://hn.algolia.com/api/v1/search");
    expect(url).toContain("query=AI");
    expect(url).toContain("tags=story");
    expect(url).toContain("numericFilters=points%3E20");
  });
});

describe("parseHNResponse", () => {
  test("converts HN hits to Story array", () => {
    const response = {
      hits: [
        {
          title: "Show HN: An open-source LLM framework",
          url: "https://github.com/example/llm",
          points: 245,
          created_at: "2026-04-03T10:00:00.000Z",
          objectID: "12345",
        },
        {
          title: "Ask HN: Best way to fine-tune models?",
          url: "",
          points: 89,
          created_at: "2026-04-03T08:00:00.000Z",
          objectID: "12346",
        },
      ],
    };

    const stories = parseHNResponse(response);
    expect(stories).toHaveLength(2);
    expect(stories[0].title).toBe("Show HN: An open-source LLM framework");
    expect(stories[0].source).toBe("hackernews");
    expect(stories[0].sourceName).toBe("Hacker News");
    expect(stories[0].score).toBe(245);
    expect(stories[0].url).toBe("https://github.com/example/llm");
    expect(stories[1].url).toContain("news.ycombinator.com/item?id=12346");
  });

  test("returns empty array for no hits", () => {
    const stories = parseHNResponse({ hits: [] });
    expect(stories).toHaveLength(0);
  });
});
