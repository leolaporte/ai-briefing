import { describe, test, expect } from "bun:test";
import { buildPrompt, buildFallbackBriefing } from "../src/summarize";
import type { Story } from "../src/types";

const sampleStories: Story[] = [
  {
    title: "OpenAI releases GPT-5",
    url: "https://example.com/gpt5",
    source: "tavily",
    sourceName: "Tavily",
    summary: "OpenAI announced GPT-5 with major improvements in reasoning.",
    publishedAt: new Date("2026-04-03T12:00:00Z"),
    score: 100,
  },
  {
    title: "EU passes comprehensive AI regulation",
    url: "https://example.com/eu-ai",
    source: "rss",
    sourceName: "Ars Technica",
    summary: "The European Union passed sweeping AI regulation today.",
    publishedAt: new Date("2026-04-03T10:00:00Z"),
  },
];

const categories = ["Models & Releases", "Policy & Safety", "Industry", "Open Source & Tools", "Research"];

describe("buildPrompt", () => {
  test("includes all stories in the prompt", () => {
    const prompt = buildPrompt(sampleStories, categories);
    expect(prompt).toContain("OpenAI releases GPT-5");
    expect(prompt).toContain("EU passes comprehensive AI regulation");
    expect(prompt).toContain("Models & Releases");
    expect(prompt).toContain("Policy & Safety");
  });

  test("requests JSON output", () => {
    const prompt = buildPrompt(sampleStories, categories);
    expect(prompt).toContain("JSON");
  });
});

describe("buildFallbackBriefing", () => {
  test("creates briefing from raw stories without summarization", () => {
    const briefing = buildFallbackBriefing(sampleStories, categories);
    expect(briefing.topStories.length).toBeLessThanOrEqual(5);
    expect(briefing.topStories[0].title).toBe("OpenAI releases GPT-5");
    expect(briefing.topStories[0].url).toBe("https://example.com/gpt5");
    expect(briefing.categories).toBeDefined();
  });

  test("puts remaining stories in first category as uncategorized fallback", () => {
    const briefing = buildFallbackBriefing(sampleStories, categories);
    const allCategorized = Object.values(briefing.categories).flat();
    expect(briefing.topStories.length + allCategorized.length).toBe(sampleStories.length);
  });
});
