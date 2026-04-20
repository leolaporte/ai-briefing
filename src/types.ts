// src/types.ts
export interface Story {
  title: string;
  url: string;
  source: "rss";
  sourceName: string;
  summary: string;
  publishedAt: Date;
  score?: number;
}

export interface RssFeed { url: string; name: string; }
export interface RssConfig { feeds: RssFeed[]; opml_file?: string; }

export interface ClaudeConfig {
  model: string;
  max_tokens: number;
  few_shot_k: number;
}

export interface PipelineConfig {
  window_hours: number;
  cluster_threshold: number;
  top_n_per_show: number;
  other_threshold: number;
}

export interface StorageConfig {
  archive_db: string;
  labels_db: string;
}

export interface ArchiveConfig { root: string; }

export interface OutputConfig { path: string; }

export interface Config {
  rss: RssConfig;
  claude: ClaudeConfig;
  pipeline: PipelineConfig;
  storage: StorageConfig;
  archive: ArchiveConfig;
  output: OutputConfig;
}
