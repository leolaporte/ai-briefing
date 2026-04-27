import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { LabelStore } from "../src/labels";
import { buildScoringPrompt } from "../src/prompt";
import type { StoryRow } from "../src/archive";

const TMP_DB = "/tmp/ai-briefing-prompt-test.sqlite";

describe("buildScoringPrompt", () => {
  beforeEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });
  afterEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

  test("includes show descriptions and few-shot examples per show", () => {
    const store = new LabelStore(TMP_DB);
    store.insertPicks([
      { show: "twit", episode_date: "2026-04-19", section_name: "AI", section_order: 1,
        rank_in_section: 1, story_url: "https://ex.com/opus", story_title: "Anthropic Opus 4.7",
        source_file: null, weight: 1.0, source: "archive" },
      { show: "mbw", episode_date: "2026-04-14", section_name: "Apple", section_order: 1,
        rank_in_section: 1, story_url: "https://ex.com/vision", story_title: "Vision Pro rumor",
        source_file: null, weight: 1.0, source: "archive" },
      { show: "im", episode_date: "2026-04-15", section_name: "Models", section_order: 1,
        rank_in_section: 1, story_url: "https://ex.com/llama", story_title: "Llama 5 released",
        source_file: null, weight: 1.0, source: "archive" },
    ]);

    const cluster: StoryRow[] = [{
      url_canonical: "https://new.com/story",
      url_original: null,
      title: "Meta releases Llama 5",
      source_name: "TechCrunch", source_domain: "techcrunch.com",
      published_at: new Date(), first_para: "Meta announced..."
    }];
    const prompt = buildScoringPrompt(cluster, store, 5);
    expect(prompt).toContain("TWiT");
    expect(prompt).toContain("MacBreak Weekly");
    expect(prompt).toContain("Intelligent Machines");
    expect(prompt).toContain("Anthropic Opus 4.7");
    expect(prompt).toContain("Vision Pro rumor");
    expect(prompt).toContain("Llama 5 released");
    expect(prompt).toContain("Meta releases Llama 5");
    expect(prompt).toContain("JSON");
    store.close();
  });
});
