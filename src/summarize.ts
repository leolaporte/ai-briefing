import Anthropic from "@anthropic-ai/sdk";
import type { Story, ClaudeConfig, SummarizedBriefing } from "./types";

export function buildPrompt(stories: Story[], categories: string[]): string {
  const storyList = stories
    .map((s, i) => `${i + 1}. "${s.title}" (${s.sourceName}) — ${s.summary || "No description"} — ${s.url}`)
    .join("\n");

  return `You are an AI news editor. Given these ${stories.length} stories, produce a JSON briefing.

STORIES:
${storyList}

INSTRUCTIONS:
1. Pick the top 5 most important stories. For each, write a one-line "take" (factual, concise).
2. Categorize ALL remaining stories into these categories: ${categories.join(", ")}. For each, write a one-line summary.
3. If a story doesn't fit any category, put it in "Industry".

OUTPUT FORMAT (strict JSON, no markdown):
{
  "topStories": [
    {"title": "...", "take": "...", "source": "source name", "url": "..."}
  ],
  "categories": {
    "${categories[0]}": [{"title": "...", "summary": "...", "source": "...", "url": "..."}],
    ${categories.slice(1).map((c) => `"${c}": []`).join(",\n    ")}
  }
}

Return ONLY valid JSON, no explanation.`;
}

export function buildFallbackBriefing(stories: Story[], categories: string[]): SummarizedBriefing {
  const topStories = stories.slice(0, 5).map((s) => ({
    title: s.title,
    take: s.summary || "No description available",
    source: s.sourceName,
    url: s.url,
  }));

  const remaining = stories.slice(5);
  const cats: Record<string, Array<{ title: string; summary: string; source: string; url: string }>> = {};
  for (const c of categories) cats[c] = [];

  const fallbackCategory = categories[0];
  for (const s of remaining) {
    cats[fallbackCategory].push({
      title: s.title,
      summary: s.summary || "No description available",
      source: s.sourceName,
      url: s.url,
    });
  }

  return { topStories, categories: cats };
}

export function parseClaudeResponse(text: string, categories: string[]): SummarizedBriefing {
  const briefing = JSON.parse(text) as SummarizedBriefing;
  for (const c of categories) {
    if (!briefing.categories[c]) briefing.categories[c] = [];
  }
  return briefing;
}

export async function summarize(
  stories: Story[],
  claudeConfig: ClaudeConfig,
  categories: string[]
): Promise<SummarizedBriefing> {
  if (stories.length === 0) {
    return { topStories: [], categories: Object.fromEntries(categories.map((c) => [c, []])) };
  }

  try {
    const client = new Anthropic();
    const prompt = buildPrompt(stories, categories);
    const response = await client.messages.create({
      model: claudeConfig.model,
      max_tokens: claudeConfig.max_tokens,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      console.error("[claude] no text block in response");
      return buildFallbackBriefing(stories, categories);
    }

    const raw = textBlock.text.trim();
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      console.error("[claude] no JSON object in response");
      return buildFallbackBriefing(stories, categories);
    }

    return parseClaudeResponse(raw.slice(jsonStart, jsonEnd + 1), categories);
  } catch (err) {
    console.error("[claude] summarization error, using fallback:", err);
    return buildFallbackBriefing(stories, categories);
  }
}
