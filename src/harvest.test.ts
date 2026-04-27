import { test, expect, beforeEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { LabelStore } from "./labels";
import { ArchiveStore } from "./archive";
import { assignLabels } from "./harvest";

const TEST_LABELS = "/tmp/ai-briefing-harvest-labels.db";
const TEST_ARCHIVE = "/tmp/ai-briefing-harvest-archive.db";

beforeEach(() => {
  for (const p of [TEST_LABELS, TEST_ARCHIVE]) {
    if (existsSync(p)) unlinkSync(p);
  }
});

test("assignLabels classifies show-notes URL as strong positive", () => {
  const result = assignLabels({
    showNotesUrls: new Set(["https://example.com/a"]),
    raindropUrls: new Set(["https://example.com/a", "https://example.com/b"]),
    archiveUrls: new Set(["https://example.com/a", "https://example.com/b", "https://example.com/c"]),
  });
  const a = result.find(r => r.url === "https://example.com/a")!;
  expect(a.source).toBe("show_notes");
  expect(a.weight).toBe(1.0);
});

test("assignLabels classifies Raindrop-only URL as weak positive", () => {
  const result = assignLabels({
    showNotesUrls: new Set(["https://example.com/a"]),
    raindropUrls: new Set(["https://example.com/a", "https://example.com/b"]),
    archiveUrls: new Set(["https://example.com/a", "https://example.com/b", "https://example.com/c"]),
  });
  const b = result.find(r => r.url === "https://example.com/b")!;
  expect(b.source).toBe("raindrop");
  expect(b.weight).toBe(0.5);
});

test("assignLabels classifies archive-only URL as negative", () => {
  const result = assignLabels({
    showNotesUrls: new Set(["https://example.com/a"]),
    raindropUrls: new Set(["https://example.com/a"]),
    archiveUrls: new Set(["https://example.com/a", "https://example.com/c"]),
  });
  const c = result.find(r => r.url === "https://example.com/c")!;
  expect(c.source).toBe("negative");
  expect(c.weight).toBe(1.0);
});

test("assignLabels includes show-notes URLs not in archive (out-of-pool positives)", () => {
  const result = assignLabels({
    showNotesUrls: new Set(["https://example.com/x"]),
    raindropUrls: new Set(),
    archiveUrls: new Set(),
  });
  expect(result).toHaveLength(1);
  expect(result[0].source).toBe("show_notes");
});
