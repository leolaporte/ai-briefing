import { describe, test, expect } from "bun:test";
import { parseTavilyResponse, buildTavilyRequest } from "../../src/sources/tavily";

describe("buildTavilyRequest", () => {
  test("builds correct request body for a query", () => {
    const req = buildTavilyRequest("AI news today", 10);
    expect(req.query).toBe("AI news today");
    expect(req.max_results).toBe(10);
    expect(req.search_depth).toBe("basic");
    expect(req.include_answer).toBe(false);
  });
});

describe("parseTavilyResponse", () => {
  test("converts Tavily results to Story array", () => {
    const response = {
      results: [
        {
          title: "OpenAI releases GPT-5",
          url: "https://example.com/gpt5",
          content: "OpenAI announced GPT-5 today with major improvements.",
          score: 0.95,
          published_date: "2026-04-03",
        },
        {
          title: "Claude gets new features",
          url: "https://example.com/claude",
          content: "Anthropic shipped a major update to Claude.",
          score: 0.88,
          published_date: "",
        },
      ],
    };

    const stories = parseTavilyResponse(response);
    expect(stories).toHaveLength(2);
    expect(stories[0].title).toBe("OpenAI releases GPT-5");
    expect(stories[0].source).toBe("tavily");
    expect(stories[0].sourceName).toBe("Tavily");
    expect(stories[0].url).toBe("https://example.com/gpt5");
    expect(stories[0].summary).toBe("OpenAI announced GPT-5 today with major improvements.");
    expect(stories[0].score).toBe(0.95);
    expect(stories[1].publishedAt).toBeInstanceOf(Date);
  });

  test("returns empty array for empty results", () => {
    const stories = parseTavilyResponse({ results: [] });
    expect(stories).toHaveLength(0);
  });
});
