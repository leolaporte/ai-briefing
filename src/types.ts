export interface Story {
  title: string;
  url: string;
  source: "tavily" | "hackernews" | "rss";
  sourceName: string;
  summary: string;
  publishedAt: Date;
  score?: number;
}

export interface TavilyConfig {
  queries: string[];
  max_results_per_query: number;
}

export interface HackernewsConfig {
  keywords: string[];
  min_points: number;
  max_stories: number;
}

export interface RssFeed {
  url: string;
  name: string;
}

export interface RssConfig {
  feeds: RssFeed[];
  opml_file?: string;
}

export interface ClaudeConfig {
  model: string;
  max_tokens: number;
}

export interface OutputConfig {
  path: string;
  categories: string[];
}

export interface Config {
  tavily: TavilyConfig;
  hackernews: HackernewsConfig;
  rss: RssConfig;
  claude: ClaudeConfig;
  output: OutputConfig;
}

export interface SummarizedBriefing {
  topStories: Array<{ title: string; take: string; source: string; url: string }>;
  categories: Record<string, Array<{ title: string; summary: string; source: string; url: string }>>;
}
