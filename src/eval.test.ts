// src/eval.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rollingRecall4w } from "./eval";

const TMP = join(tmpdir(), "ai-briefing-eval-test");

beforeEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });
});

test("rollingRecall4w returns null with no eval reports", () => {
  expect(rollingRecall4w("twit", TMP)).toBeNull();
});

test("rollingRecall4w averages recall_at_40 across reports in last 28 days", () => {
  const today = new Date();
  const day = (offset: number) => {
    const d = new Date(today.getTime() - offset * 86400000);
    return d.toISOString().slice(0, 10);
  };
  writeFileSync(join(TMP, `${day(2)}-twit.md`), `recall_at_40: 0.90\n`);
  writeFileSync(join(TMP, `${day(8)}-twit.md`), `recall_at_40: 0.85\n`);
  writeFileSync(join(TMP, `${day(20)}-twit.md`), `recall_at_40: 0.80\n`);
  writeFileSync(join(TMP, `${day(40)}-twit.md`), `recall_at_40: 0.50\n`); // too old
  const r = rollingRecall4w("twit", TMP);
  expect(r).toBeCloseTo((0.9 + 0.85 + 0.8) / 3, 3);
});

test("rollingRecall4w only considers files for the requested show", () => {
  writeFileSync(join(TMP, "2026-04-25-twit.md"), `recall_at_40: 0.90\n`);
  writeFileSync(join(TMP, "2026-04-25-mbw.md"), `recall_at_40: 0.10\n`);
  const r = rollingRecall4w("twit", TMP);
  expect(r).toBeCloseTo(0.90, 3);
});
