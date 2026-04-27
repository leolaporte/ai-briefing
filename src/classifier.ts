// src/classifier.ts
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { StoryRow } from "./archive";
import type { Show } from "./labels";
import type { ClassifierConfig } from "./types";
import { rollingRecall4w } from "./eval";

const TRAIN_PY = join(import.meta.dir, "..", "bin", "train.py");

export interface ClusterScore {
  idx: number;
  score: number;
}

export interface ClusterCandidate {
  url: string;
  title: string;
}

/**
 * Score every cluster for one show via the Python sidecar.
 * Returns ClusterScore[] in input order, or null when fallback is triggered.
 *
 * Fallback (returns null) when:
 *   - The model artifact is missing (e.g. show couldn't train due to insufficient data)
 *   - 4-week rolling recall@40 is below config.fallback_recall_threshold
 *
 * Callers receiving null should include ALL clusters for this show rather than
 * pre-filtering, so that Haiku-only scoring covers the full candidate set.
 */
export function scoreClustersForShow(
  clusters: StoryRow[][],
  show: Show,
  config: ClassifierConfig,
  evalDir: string
): ClusterScore[] | null {
  const modelPath = join(expandHome(config.model_dir), `${show}.pkl`);
  if (!existsSync(modelPath)) {
    console.warn(`[classifier:${show}] no model artifact at ${modelPath} — falling back to Haiku-only`);
    return null;
  }
  const recall = rollingRecall4w(show, evalDir);
  if (recall !== null && recall < config.fallback_recall_threshold) {
    console.warn(
      `[classifier:${show}] 4-week recall@40 ${recall.toFixed(3)} below ${config.fallback_recall_threshold} — falling back to Haiku-only`
    );
    return null;
  }
  const candidates: ClusterCandidate[] = clusters.map(c => ({
    url: c[0].url_canonical,
    title: c[0].title,
  }));
  const result = spawnSync(
    "uv",
    ["run", "python", TRAIN_PY, "--score", "--show", show, "--model-dir", expandHome(config.model_dir)],
    { input: JSON.stringify(candidates), encoding: "utf-8", timeout: 60000 }
  );
  if (result.status !== 0) {
    console.warn(`[classifier:${show}] failed (${result.status}): ${result.stderr}`);
    return null;
  }
  const raw = JSON.parse(result.stdout) as Array<{ url: string; score: number }>;
  return raw.map((r, idx) => ({ idx, score: r.score }));
}

export function shortlistByScore(scores: ClusterScore[], k: number): number[] {
  return [...scores]
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(s => s.idx);
}

export function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace("~", process.env.HOME ?? "") : p;
}
