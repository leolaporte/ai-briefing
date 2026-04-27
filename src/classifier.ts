// src/classifier.ts
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { StoryRow } from "./archive";
import type { Show } from "./labels";
import type { ClassifierConfig } from "./types";

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
 * Returns ClusterScore[] in input order.
 * If the model artifact is missing, returns all zeros (caller treats as
 * "classifier unavailable").
 */
export function scoreClustersForShow(
  clusters: StoryRow[][],
  show: Show,
  config: ClassifierConfig
): ClusterScore[] {
  const modelPath = join(expandHome(config.model_dir), `${show}.pkl`);
  if (!existsSync(modelPath)) {
    return clusters.map((_, idx) => ({ idx, score: 0.0 }));
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
    return clusters.map((_, idx) => ({ idx, score: 0.0 }));
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

function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace("~", process.env.HOME ?? "") : p;
}
