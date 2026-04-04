import { describe, test, expect, afterEach } from "bun:test";
import { renderBriefing } from "../src/writer";
import type { SummarizedBriefing } from "../src/types";
import { rmSync } from "fs";

const sampleBriefing: SummarizedBriefing = {
  topStories: [
    { title: "GPT-5 Released", take: "Major reasoning improvements", source: "Tavily", url: "https://example.com/gpt5" },
    { title: "EU AI Act Enforced", take: "Sweeping new regulations", source: "Ars Technica", url: "https://example.com/eu" },
  ],
  categories: {
    "Models & Releases": [
      { title: "Llama 4 drops", summary: "Meta releases Llama 4", source: "Hacker News", url: "https://example.com/llama" },
    ],
    "Policy & Safety": [],
    "Industry": [
      { title: "AI startup raises $1B", summary: "Record funding round", source: "The Verge", url: "https://example.com/startup" },
    ],
    "Open Source & Tools": [],
    "Research": [],
  },
};

describe("renderBriefing", () => {
  test("renders correct YAML frontmatter", () => {
    const md = renderBriefing(sampleBriefing, new Date("2026-04-04"), 15);
    expect(md).toContain("---\ndate: 2026-04-04");
    expect(md).toContain("type: ai-briefing");
    expect(md).toContain("story_count: 15");
    expect(md).toContain("sources: [tavily, hackernews, rss]");
  });

  test("renders top stories section", () => {
    const md = renderBriefing(sampleBriefing, new Date("2026-04-04"), 15);
    expect(md).toContain("## Top Stories");
    expect(md).toContain("**GPT-5 Released** — Major reasoning improvements ([Tavily](https://example.com/gpt5))");
  });

  test("renders category sections", () => {
    const md = renderBriefing(sampleBriefing, new Date("2026-04-04"), 15);
    expect(md).toContain("## Models & Releases");
    expect(md).toContain("**Llama 4 drops** — Meta releases Llama 4 ([Hacker News](https://example.com/llama))");
  });

  test("skips empty categories", () => {
    const md = renderBriefing(sampleBriefing, new Date("2026-04-04"), 15);
    expect(md).not.toContain("## Policy & Safety");
    expect(md).not.toContain("## Research");
  });

  test("includes heading with formatted date", () => {
    const md = renderBriefing(sampleBriefing, new Date("2026-04-04"), 15);
    expect(md).toContain("# AI Briefing — April 4, 2026");
  });
});
