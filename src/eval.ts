// src/eval.ts
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { Show } from "./labels";

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(twit|mbw|im)\.md$/;
const RECALL_LINE_RE = /recall_at_40:\s*([0-9.]+)/i;

/**
 * Average recall_at_40 across eval reports for the given show that were
 * written in the last 28 days. Returns null if no reports exist in window.
 */
export function rollingRecall4w(show: Show, evalDir: string): number | null {
  if (!existsSync(evalDir)) return null;
  const cutoff = new Date(Date.now() - 28 * 86400000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const recalls: number[] = [];
  for (const name of readdirSync(evalDir)) {
    const m = FILENAME_RE.exec(name);
    if (!m) continue;
    if (m[2] !== show) continue;
    if (m[1] < cutoffStr) continue;
    const text = readFileSync(join(evalDir, name), "utf-8");
    const r = RECALL_LINE_RE.exec(text);
    if (r) recalls.push(parseFloat(r[1]));
  }
  if (recalls.length === 0) return null;
  return recalls.reduce((a, b) => a + b, 0) / recalls.length;
}
