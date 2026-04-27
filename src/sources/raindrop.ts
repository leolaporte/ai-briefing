// src/sources/raindrop.ts
import { spawnSync } from "child_process";
import { canonicalizeUrl } from "../cluster";

export interface RaindropRecord {
  url: string;          // canonicalized
  title: string;
  tags: string[];
  created_at: string;
}

const BINARY = process.env.RAINDROP_HISTORY_BIN ?? `${process.env.HOME}/.local/bin/raindrop-history`;

export function parseRaindropHistoryOutput(stdout: string): RaindropRecord[] {
  const out: RaindropRecord[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as RaindropRecord;
    out.push({ ...r, url: canonicalizeUrl(r.url) });
  }
  return out;
}

/**
 * Shell out to the raindrop-history Go binary for a given tag and date range.
 * Throws on non-zero exit. Caller is responsible for ensuring RAINDROP_TOKEN
 * is set in the environment.
 */
export function fetchRaindropHistory(
  tag: string,
  start: string, // YYYY-MM-DD
  end: string    // YYYY-MM-DD
): RaindropRecord[] {
  const result = spawnSync(BINARY, ["--start", start, "--end", end, "--tag", tag], {
    encoding: "utf-8",
    timeout: 30000,
  });
  if (result.status !== 0) {
    throw new Error(`raindrop-history exit ${result.status}: ${result.stderr}`);
  }
  return parseRaindropHistoryOutput(result.stdout);
}
