import type { LabelStore, PickRow, Show } from "./labels";
import type { StoryRow } from "./archive";

const SHOW_DESCRIPTIONS: Record<Show, string> = {
  twit: "TWiT (This Week in Tech) — general tech news for a broad audience. Big-picture stories about the tech industry, major product launches, legal/policy issues, and anything a thoughtful tech-adjacent viewer would find interesting.",
  mbw: "MacBreak Weekly (MBW) — Apple-focused. iPhone, iPad, Mac, Vision Pro, Apple services, Apple's business, court cases involving Apple, and rumors about unreleased Apple products.",
  im: "Intelligent Machines (IM) — AI-focused. Model releases, AI research, AI industry news, AI regulation, AI ethics, and the societal impact of AI.",
};

const CURATION_RULES = `
CURATION RULES (from Leo's experience):
- Show only stories published within the past 24 hours.
- Multiple stories on the same topic are allowed; the first listed in a cluster should be the original/primary source.
- Prefer sources Leo has historically used for similar topics.
- Low-relevance stories can still surface as "Other notable" at low scores.
`.trim();

function renderFewShot(picks: PickRow[]): string {
  return picks.map((p) =>
    `- [${p.section_name ?? "—"}] "${p.story_title}" — ${p.story_url}`
  ).join("\n");
}

export function buildScoringPrompt(
  cluster: StoryRow[],
  labels: LabelStore,
  fewShotK: number
): string {
  const shows: Show[] = ["twit", "mbw", "im"];
  const fewShotBlocks = shows.map((show) => {
    const examples = labels.getRecentPicks(show, fewShotK);
    return `### Recent ${show.toUpperCase()} picks\n${renderFewShot(examples)}`;
  }).join("\n\n");

  const candidates = cluster.map((s, i) =>
    `  ${i + 1}. "${s.title}" — ${s.source_name} (${s.source_domain}) — ${s.url_canonical}\n     Lead: ${(s.first_para ?? "").slice(0, 240)}`
  ).join("\n");

  return `You are scoring news stories for three weekly tech podcasts.

## Shows
- **TWiT:** ${SHOW_DESCRIPTIONS.twit}
- **MacBreak Weekly (MBW):** ${SHOW_DESCRIPTIONS.mbw}
- **Intelligent Machines (IM):** ${SHOW_DESCRIPTIONS.im}

${CURATION_RULES}

## Few-shot examples of Leo's picks

${fewShotBlocks}

## Candidate cluster (${cluster.length} story/ies, likely about the same topic)
${candidates}

## Task
For each show, score how well this cluster fits (0.0–1.0). Also pick which story in the cluster should be the canonical (primary) link, and optionally guess a section name. Output STRICT JSON, no commentary:

{
  "twit": { "score": 0.0, "canonical_idx": 1, "section_guess": null },
  "mbw":  { "score": 0.0, "canonical_idx": 1, "section_guess": null },
  "im":   { "score": 0.0, "canonical_idx": 1, "section_guess": null }
}`;
}
