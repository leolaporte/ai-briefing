import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { LabelStore } from "../../src/labels";
import { ingestArchives } from "../../src/twitshow/ingest";

describe("ingestArchives", () => {
  let root: string;
  let dbPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "archives-"));
    dbPath = join(root, "labels.db");
    for (const show of ["twit", "mbw", "im"]) {
      mkdirSync(join(root, `archive-${show}`), { recursive: true });
    }
    copyFileSync(
      "tests/twitshow/fixtures/twit-2026-04-19.html",
      join(root, "archive-twit/twit-2026-04-19.html")
    );
    copyFileSync(
      "tests/twitshow/fixtures/twit-2026-04-19-LINKS.csv",
      join(root, "archive-twit/twit-2026-04-19-LINKS.csv")
    );
    copyFileSync(
      "tests/twitshow/fixtures/twit-2026-04-19.org",
      join(root, "archive-twit/twit-2026-04-19.org")
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("prefers HTML when present, ignoring lower-fidelity siblings for same stem", async () => {
    const store = new LabelStore(dbPath);
    const result = await ingestArchives(root, store);
    expect(result.files_parsed).toBe(1);         // HTML wins
    expect(result.files_skipped).toBe(2);        // .org and .csv skipped
    expect(store.countByShow("twit")).toBeGreaterThan(0);
    store.close();
  });

  test("is idempotent (second run inserts no new rows)", async () => {
    const store = new LabelStore(dbPath);
    const first = await ingestArchives(root, store);
    const second = await ingestArchives(root, store);
    expect(first.picks_inserted).toBeGreaterThan(0);
    expect(second.picks_inserted).toBe(0);
    store.close();
  });

  test("falls back to org then CSV when HTML is absent", async () => {
    rmSync(join(root, "archive-twit/twit-2026-04-19.html"));
    const store = new LabelStore(dbPath);
    const result = await ingestArchives(root, store);
    expect(result.files_parsed).toBe(1);         // org wins over CSV
    store.close();
  });
});
