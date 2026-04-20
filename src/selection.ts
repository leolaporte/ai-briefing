import type { StoryRow } from "./archive";
import type { ClusterScoring } from "./scorer";
import type { Show } from "./labels";

export interface ScoredCluster {
  cluster: StoryRow[];
  scoring: ClusterScoring;
}

export interface SelectionSplit {
  twit: ScoredCluster[];
  mbw: ScoredCluster[];
  im: ScoredCluster[];
  other: ScoredCluster[];
}

export function selectForShow(scored: ScoredCluster[], show: Show, topN: number): ScoredCluster[] {
  return [...scored]
    .sort((a, b) => b.scoring[show].score - a.scoring[show].score)
    .slice(0, topN);
}

export function splitScored(
  scored: ScoredCluster[],
  config: { topN: number; otherThreshold: number }
): SelectionSplit {
  const aboveThreshold = (show: Show) => (s: ScoredCluster) =>
    s.scoring[show].score > config.otherThreshold;
  const twit = selectForShow(scored.filter(aboveThreshold("twit")), "twit", config.topN);
  const mbw = selectForShow(scored.filter(aboveThreshold("mbw")), "mbw", config.topN);
  const im = selectForShow(scored.filter(aboveThreshold("im")), "im", config.topN);
  const selectedUrls = new Set([
    ...twit.map((s) => s.cluster[0].url_canonical),
    ...mbw.map((s) => s.cluster[0].url_canonical),
    ...im.map((s) => s.cluster[0].url_canonical),
  ]);
  const other = scored.filter((s) => {
    if (selectedUrls.has(s.cluster[0].url_canonical)) return false;
    const maxScore = Math.max(s.scoring.twit.score, s.scoring.mbw.score, s.scoring.im.score);
    return maxScore > config.otherThreshold;
  });
  return { twit, mbw, im, other };
}
