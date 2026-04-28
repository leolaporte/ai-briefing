import { describe, test, expect } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("loads the new tech-briefing config shape", () => {
    const config = loadConfig();
    expect(config.claude.model).toBe("claude-haiku-4-5");
    expect(config.claude.few_shot_k).toBe(20);
    expect(config.pipeline.window_hours).toBe(24);
    expect(config.pipeline.top_n_per_show).toBe(15);
    expect(config.storage.archive_db).toContain(".local/share/ai-briefing/archive.db");
    expect(config.storage.labels_db).toContain(".local/share/ai-briefing/labels.db");
    expect(config.output.path).toContain("Obsidian");
    expect(config.output.path).not.toContain("~");
  });
});
