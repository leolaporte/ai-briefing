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

export function parseScoringResponse(text: string): ClusterScoring {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  const obj = JSON.parse(text.slice(start, end + 1));
  for (const s of ["twit", "mbw", "im"] as Show[]) {
    if (!obj[s] || typeof obj[s].score !== "number" || typeof obj[s].canonical_idx !== "number") {
      throw new Error(`Scoring response missing required field for show ${s}`);
    }
  }
  return obj as ClusterScoring;
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
