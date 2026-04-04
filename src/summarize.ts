import type { Story, OllamaConfig, SummarizedBriefing } from "./types";

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

export async function summarize(
  stories: Story[],
  ollamaConfig: OllamaConfig,
  categories: string[]
): Promise<SummarizedBriefing> {
  if (stories.length === 0) {
    return { topStories: [], categories: Object.fromEntries(categories.map((c) => [c, []])) };
  }

  try {
    const prompt = buildPrompt(stories, categories);
    const res = await fetch(`${ollamaConfig.base_url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaConfig.model,
        prompt,
        stream: false,
        format: "json",
      }),
    });

    if (!res.ok) {
      console.error(`[ollama] summarization failed: ${res.status}`);
      return buildFallbackBriefing(stories, categories);
    }

    const data = (await res.json()) as { response: string };
    const briefing = JSON.parse(data.response) as SummarizedBriefing;

    for (const c of categories) {
      if (!briefing.categories[c]) briefing.categories[c] = [];
    }

    return briefing;
  } catch (err) {
    console.error("[ollama] summarization error, using fallback:", err);
    return buildFallbackBriefing(stories, categories);
  }
}
