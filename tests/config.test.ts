import { describe, test, expect } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("loads and parses config.yaml from project root", () => {
    const config = loadConfig();
    expect(config.tavily.queries).toBeArray();
    expect(config.tavily.queries.length).toBeGreaterThan(0);
    expect(config.tavily.max_results_per_query).toBe(10);
    expect(config.hackernews.keywords).toContain("AI");
    expect(config.hackernews.min_points).toBe(20);
    expect(config.rss.feeds.length).toBeGreaterThan(0);
    expect(config.rss.feeds[0].url).toBeString();
    expect(config.rss.feeds[0].name).toBeString();
    expect(config.ollama.model).toBe("llama3");
    expect(config.ollama.base_url).toBe("http://localhost:11434");
    expect(config.output.path).toContain("Obsidian");
    expect(config.output.categories).toContain("Models & Releases");
  });

  test("resolves ~ in output path to home directory", () => {
    const config = loadConfig();
    expect(config.output.path).not.toContain("~");
    expect(config.output.path).toStartWith("/home/");
  });
});
