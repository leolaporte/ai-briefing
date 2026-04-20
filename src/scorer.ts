import Anthropic from "@anthropic-ai/sdk";
import type { StoryRow } from "./archive";
import type { LabelStore, Show } from "./labels";
import { buildScoringPrompt } from "./prompt";

export interface ShowScore {
  score: number;
  canonical_idx: number;
  section_guess: string | null;
}
export type ClusterScoring = Record<Show, ShowScore>;

const EMPTY_SHOW_SCORE: ShowScore = { score: 0, canonical_idx: 1, section_guess: null };

export function parseScoringResponse(text: string): ClusterScoring {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  const obj = JSON.parse(text.slice(start, end + 1));

  const out: Partial<ClusterScoring> = {};
  let validCount = 0;
  for (const s of ["twit", "mbw", "im"] as Show[]) {
    const v = obj[s];
    if (v && typeof v.score === "number" && typeof v.canonical_idx === "number") {
      out[s] = {
        score: v.score,
        canonical_idx: v.canonical_idx,
        section_guess: typeof v.section_guess === "string" ? v.section_guess : null,
      };
      validCount++;
    } else {
      out[s] = { ...EMPTY_SHOW_SCORE };
    }
  }
  if (validCount === 0) throw new Error("Scoring response had no valid show fields");
  return out as ClusterScoring;
}

export async function scoreCluster(
  cluster: StoryRow[],
  labels: LabelStore,
  config: { model: string; max_tokens: number; few_shot_k: number }
): Promise<ClusterScoring | null> {
  const prompt = buildScoringPrompt(cluster, labels, config.few_shot_k);
  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.max_tokens,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseScoringResponse(textBlock.text);
  } catch (err) {
    console.error("[scorer] failed:", err);
    return null;
  }
}
