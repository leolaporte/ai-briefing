import type { Story, TavilyConfig } from "../types";

interface TavilyRequest {
  query: string;
  max_results: number;
  search_depth: "basic" | "advanced";
  include_answer: boolean;
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

export function buildTavilyRequest(query: string, maxResults: number): TavilyRequest {
  return {
    query,
    max_results: maxResults,
    search_depth: "basic",
    include_answer: false,
  };
}

export function parseTavilyResponse(response: TavilyResponse): Story[] {
  return response.results.map((r) => ({
    title: r.title,
    url: r.url,
    source: "tavily" as const,
    sourceName: "Tavily",
    summary: r.content,
    publishedAt: r.published_date ? new Date(r.published_date) : new Date(),
    score: r.score,
  }));
}

export async function fetchTavily(config: TavilyConfig): Promise<Story[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.error("[tavily] TAVILY_API_KEY not set, skipping");
    return [];
  }

  const allStories: Story[] = [];

  for (const query of config.queries) {
    try {
      const body = buildTavilyRequest(query, config.max_results_per_query);
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error(`[tavily] query "${query}" failed: ${res.status} ${res.statusText}`);
        continue;
      }

      const data = (await res.json()) as TavilyResponse;
      allStories.push(...parseTavilyResponse(data));
    } catch (err) {
      console.error(`[tavily] query "${query}" error:`, err);
    }
  }

  return allStories;
}
