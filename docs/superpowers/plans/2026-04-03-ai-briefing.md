# AI Morning Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a nightly pipeline that scrapes AI news from Tavily, Hacker News, and RSS feeds, summarizes via Ollama, and writes a morning briefing to Obsidian.

**Architecture:** Three scrapers run in parallel, results merge through dedup/ranking, Ollama categorizes and summarizes, output writes as a hybrid Obsidian note. Runs as a systemd user timer at midnight.

**Tech Stack:** Bun (TypeScript), js-yaml, Ollama REST API, Tavily REST API, HN Algolia API, RSS/Atom XML parsing

---

## File Structure

```
~/Projects/ai-briefing/
├── config.yaml              # Editable config (feeds, queries, thresholds)
├── package.json             # Bun project, js-yaml dependency
├── tsconfig.json            # Strict TS
├── src/
│   ├── index.ts             # Entry point — orchestrates pipeline
│   ├── config.ts            # Load and validate config.yaml
│   ├── types.ts             # Story interface, Config types
│   ├── sources/
│   │   ├── tavily.ts        # Tavily REST API scraper
│   │   ├── hackernews.ts    # HN Algolia API scraper
│   │   └── rss.ts           # RSS/Atom feed parser
│   ├── dedupe.ts            # Dedup by URL + title similarity, rank
│   ├── summarize.ts         # Ollama summarization + fallback
│   └── writer.ts            # Obsidian markdown writer
├── tests/
│   ├── config.test.ts
│   ├── sources/
│   │   ├── tavily.test.ts
│   │   ├── hackernews.test.ts
│   │   └── rss.test.ts
│   ├── dedupe.test.ts
│   ├── summarize.test.ts
│   └── writer.test.ts
└── docs/superpowers/
    ├── specs/2026-04-03-ai-briefing-design.md
    └── plans/2026-04-03-ai-briefing.md
```

---

### Task 1: Project Scaffolding & Types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/types.ts`
- Create: `config.yaml`

- [ ] **Step 1: Initialize Bun project**

```bash
cd ~/Projects/ai-briefing
bun init -y
```

- [ ] **Step 2: Install js-yaml**

```bash
cd ~/Projects/ai-briefing
bun add js-yaml
bun add -d @types/js-yaml
```

- [ ] **Step 3: Configure tsconfig.json**

Replace the generated `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Create src/types.ts**

```typescript
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
}

export interface OllamaConfig {
  model: string;
  base_url: string;
}

export interface OutputConfig {
  path: string;
  categories: string[];
}

export interface Config {
  tavily: TavilyConfig;
  hackernews: HackernewsConfig;
  rss: RssConfig;
  ollama: OllamaConfig;
  output: OutputConfig;
}

export interface SummarizedBriefing {
  topStories: Array<{ title: string; take: string; source: string; url: string }>;
  categories: Record<string, Array<{ title: string; summary: string; source: string; url: string }>>;
}
```

- [ ] **Step 5: Create config.yaml**

```yaml
tavily:
  queries:
    - "AI news today"
    - "LLM release announcement"
    - "AI policy regulation"
  max_results_per_query: 10

hackernews:
  keywords: ["AI", "LLM", "GPT", "Claude", "machine learning", "neural", "transformer", "diffusion", "foundation model", "open source model"]
  min_points: 20
  max_stories: 20

rss:
  feeds:
    - url: https://arstechnica.com/ai/feed/
      name: Ars Technica
    - url: https://www.theverge.com/ai-artificial-intelligence/rss/index.xml
      name: The Verge
    - url: https://www.technologyreview.com/feed/
      name: MIT Tech Review
    - url: https://blog.google/technology/ai/rss/
      name: Google AI Blog
    - url: https://openai.com/blog/rss.xml
      name: OpenAI Blog
    - url: https://www.anthropic.com/blog/rss.xml
      name: Anthropic Blog
    - url: https://huggingface.co/blog/feed.xml
      name: Hugging Face
    - url: https://simonwillison.net/atom/everything/
      name: Simon Willison

ollama:
  model: "llama3"
  base_url: "http://localhost:11434"

output:
  path: "~/Obsidian/lgl/AI/News"
  categories:
    - "Models & Releases"
    - "Policy & Safety"
    - "Industry"
    - "Open Source & Tools"
    - "Research"
```

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/ai-briefing
git init
git add package.json tsconfig.json bun.lock src/types.ts config.yaml
git commit -m "feat: project scaffolding with types and config"
```

---

### Task 2: Config Loader

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/config.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("loads and parses config.yaml from project root", () => {
    const config = loadConfig();
    expect(config.tavily.queries).toBeArray();
    expect(config.tavily.queries.length).toBeGreaterThan(0);
    expect(config.tavily.max_results_per_query).toBe(10);
    expect(config.hackernews.keywords).toContain("AI");
    expect(config.hackernews.min_points).toBe(20);
    expect(config.rss.feeds.length).toBeGreaterThan(0);
    expect(config.rss.feeds[0].url).toBeString();
    expect(config.rss.feeds[0].name).toBeString();
    expect(config.ollama.model).toBe("llama3");
    expect(config.ollama.base_url).toBe("http://localhost:11434");
    expect(config.output.path).toContain("Obsidian");
    expect(config.output.categories).toContain("Models & Releases");
  });

  test("resolves ~ in output path to home directory", () => {
    const config = loadConfig();
    expect(config.output.path).not.toContain("~");
    expect(config.output.path).toStartWith("/home/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Projects/ai-briefing
bun test tests/config.test.ts
```

Expected: FAIL — `loadConfig` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/config.ts`:

```typescript
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import yaml from "js-yaml";
import type { Config } from "./types";

export function loadConfig(configPath?: string): Config {
  const path = configPath ?? resolve(dirname(import.meta.dir), "config.yaml");
  const raw = readFileSync(path, "utf-8");
  const config = yaml.load(raw) as Config;

  // Resolve ~ to home directory
  if (config.output.path.startsWith("~")) {
    config.output.path = config.output.path.replace("~", process.env.HOME ?? "/home/leo");
  }

  return config;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Projects/ai-briefing
bun test tests/config.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/ai-briefing
git add src/config.ts tests/config.test.ts
git commit -m "feat: config loader with yaml parsing and path resolution"
```

---

### Task 3: Tavily Source

**Files:**
- Create: `src/sources/tavily.ts`
- Create: `tests/sources/tavily.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/sources/tavily.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { parseTavilyResponse, buildTavilyRequest } from "../src/sources/tavily";

describe("buildTavilyRequest", () => {
  test("builds correct request body for a query", () => {
    const req = buildTavilyRequest("AI news today", 10);
    expect(req.query).toBe("AI news today");
    expect(req.max_results).toBe(10);
    expect(req.search_depth).toBe("basic");
    expect(req.include_answer).toBe(false);
  });
});

describe("parseTavilyResponse", () => {
  test("converts Tavily results to Story array", () => {
    const response = {
      results: [
        {
          title: "OpenAI releases GPT-5",
          url: "https://example.com/gpt5",
          content: "OpenAI announced GPT-5 today with major improvements.",
          score: 0.95,
          published_date: "2026-04-03",
        },
        {
          title: "Claude gets new features",
          url: "https://example.com/claude",
          content: "Anthropic shipped a major update to Claude.",
          score: 0.88,
          published_date: "",
        },
      ],
    };

    const stories = parseTavilyResponse(response);
    expect(stories).toHaveLength(2);
    expect(stories[0].title).toBe("OpenAI releases GPT-5");
    expect(stories[0].source).toBe("tavily");
    expect(stories[0].sourceName).toBe("Tavily");
    expect(stories[0].url).toBe("https://example.com/gpt5");
    expect(stories[0].summary).toBe("OpenAI announced GPT-5 today with major improvements.");
    expect(stories[0].score).toBe(0.95);
    expect(stories[1].publishedAt).toBeInstanceOf(Date);
  });

  test("returns empty array for empty results", () => {
    const stories = parseTavilyResponse({ results: [] });
    expect(stories).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Projects/ai-briefing
bun test tests/sources/tavily.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/sources/tavily.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Projects/ai-briefing
bun test tests/sources/tavily.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/ai-briefing
git add src/sources/tavily.ts tests/sources/tavily.test.ts
git commit -m "feat: Tavily source with request builder, parser, and fetcher"
```

---

### Task 4: Hacker News Source

**Files:**
- Create: `src/sources/hackernews.ts`
- Create: `tests/sources/hackernews.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/sources/hackernews.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { parseHNResponse, buildHNUrl } from "../src/sources/hackernews";

describe("buildHNUrl", () => {
  test("builds Algolia search URL with keyword and tags", () => {
    const url = buildHNUrl("AI", 20);
    expect(url).toContain("http://hn.algolia.com/api/v1/search");
    expect(url).toContain("query=AI");
    expect(url).toContain("tags=story");
    expect(url).toContain("numericFilters=points%3E20");
  });
});

describe("parseHNResponse", () => {
  test("converts HN hits to Story array", () => {
    const response = {
      hits: [
        {
          title: "Show HN: An open-source LLM framework",
          url: "https://github.com/example/llm",
          points: 245,
          created_at: "2026-04-03T10:00:00.000Z",
          objectID: "12345",
        },
        {
          title: "Ask HN: Best way to fine-tune models?",
          url: "",
          points: 89,
          created_at: "2026-04-03T08:00:00.000Z",
          objectID: "12346",
        },
      ],
    };

    const stories = parseHNResponse(response);
    expect(stories).toHaveLength(2);
    expect(stories[0].title).toBe("Show HN: An open-source LLM framework");
    expect(stories[0].source).toBe("hackernews");
    expect(stories[0].sourceName).toBe("Hacker News");
    expect(stories[0].score).toBe(245);
    expect(stories[0].url).toBe("https://github.com/example/llm");
    // HN self-posts get an HN URL
    expect(stories[1].url).toContain("news.ycombinator.com/item?id=12346");
  });

  test("returns empty array for no hits", () => {
    const stories = parseHNResponse({ hits: [] });
    expect(stories).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Projects/ai-briefing
bun test tests/sources/hackernews.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/sources/hackernews.ts`:

```typescript
import type { Story, HackernewsConfig } from "../types";

interface HNHit {
  title: string;
  url: string;
  points: number;
  created_at: string;
  objectID: string;
}

interface HNResponse {
  hits: HNHit[];
}

export function buildHNUrl(keyword: string, minPoints: number): string {
  const params = new URLSearchParams({
    query: keyword,
    tags: "story",
    numericFilters: `points>${minPoints}`,
    hitsPerPage: "50",
  });
  return `http://hn.algolia.com/api/v1/search?${params.toString()}`;
}

export function parseHNResponse(response: HNResponse): Story[] {
  return response.hits.map((hit) => ({
    title: hit.title,
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    source: "hackernews" as const,
    sourceName: "Hacker News",
    summary: "",
    publishedAt: new Date(hit.created_at),
    score: hit.points,
  }));
}

export async function fetchHackerNews(config: HackernewsConfig): Promise<Story[]> {
  const seen = new Set<string>();
  const allStories: Story[] = [];

  for (const keyword of config.keywords) {
    try {
      const url = buildHNUrl(keyword, config.min_points);
      const res = await fetch(url);

      if (!res.ok) {
        console.error(`[hn] keyword "${keyword}" failed: ${res.status}`);
        continue;
      }

      const data = (await res.json()) as HNResponse;
      for (const story of parseHNResponse(data)) {
        if (!seen.has(story.url)) {
          seen.add(story.url);
          allStories.push(story);
        }
      }
    } catch (err) {
      console.error(`[hn] keyword "${keyword}" error:`, err);
    }
  }

  // Sort by score descending, take top N
  return allStories
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, config.max_stories);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Projects/ai-briefing
bun test tests/sources/hackernews.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/ai-briefing
git add src/sources/hackernews.ts tests/sources/hackernews.test.ts
git commit -m "feat: Hacker News source with Algolia API"
```

---

### Task 5: RSS Source

**Files:**
- Create: `src/sources/rss.ts`
- Create: `tests/sources/rss.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/sources/rss.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { parseRssXml } from "../src/sources/rss";

const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>AI breakthrough announced</title>
      <link>https://example.com/ai-breakthrough</link>
      <description>A major AI breakthrough was announced today.</description>
      <pubDate>Thu, 03 Apr 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Old news story</title>
      <link>https://example.com/old-news</link>
      <description>This happened a week ago.</description>
      <pubDate>Thu, 27 Mar 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const sampleAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>New model released</title>
    <link href="https://example.com/new-model"/>
    <summary>A new open source model dropped today.</summary>
    <updated>2026-04-03T10:00:00Z</updated>
  </entry>
</feed>`;

describe("parseRssXml", () => {
  test("parses RSS 2.0 items into Story array", () => {
    const stories = parseRssXml(sampleRss, "Test Feed", 48);
    // Only the recent item (within 48 hours)
    expect(stories.length).toBeGreaterThanOrEqual(1);
    expect(stories[0].title).toBe("AI breakthrough announced");
    expect(stories[0].source).toBe("rss");
    expect(stories[0].sourceName).toBe("Test Feed");
    expect(stories[0].url).toBe("https://example.com/ai-breakthrough");
    expect(stories[0].summary).toBe("A major AI breakthrough was announced today.");
  });

  test("filters out items older than maxAgeHours", () => {
    const stories = parseRssXml(sampleRss, "Test Feed", 48);
    const oldStory = stories.find((s) => s.title === "Old news story");
    expect(oldStory).toBeUndefined();
  });

  test("parses Atom feeds", () => {
    const stories = parseRssXml(sampleAtom, "Atom Feed", 48);
    expect(stories).toHaveLength(1);
    expect(stories[0].title).toBe("New model released");
    expect(stories[0].url).toBe("https://example.com/new-model");
  });

  test("returns empty array for invalid XML", () => {
    const stories = parseRssXml("not xml", "Bad Feed", 48);
    expect(stories).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Projects/ai-briefing
bun test tests/sources/rss.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/sources/rss.ts`:

```typescript
import type { Story, RssConfig } from "../types";

// Simple XML tag extraction — no dependency needed for RSS/Atom
function extractTag(xml: string, tag: string): string {
  // Handle self-closing tags with href attribute (Atom links)
  const attrMatch = xml.match(new RegExp(`<${tag}[^>]*href="([^"]*)"`, "i"));
  if (attrMatch && tag === "link") return attrMatch[1];

  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"))
    ?? xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

export function parseRssXml(xml: string, feedName: string, maxAgeHours: number): Story[] {
  try {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    const stories: Story[] = [];

    // Split into items (RSS) or entries (Atom)
    const isAtom = xml.includes("<feed") && xml.includes("xmlns=\"http://www.w3.org/2005/Atom\"");
    const itemRegex = isAtom ? /<entry[\s>]([\s\S]*?)<\/entry>/gi : /<item[\s>]([\s\S]*?)<\/item>/gi;

    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = extractTag(block, "title");
      const link = extractTag(block, "link");
      const summary = extractTag(block, isAtom ? "summary" : "description");
      const dateStr = extractTag(block, isAtom ? "updated" : "pubDate");

      const publishedAt = dateStr ? new Date(dateStr) : new Date();

      if (publishedAt < cutoff) continue;

      stories.push({
        title,
        url: link,
        source: "rss",
        sourceName: feedName,
        summary: summary.replace(/<[^>]*>/g, "").slice(0, 300),
        publishedAt,
      });
    }

    return stories;
  } catch (err) {
    console.error(`[rss] failed to parse feed "${feedName}":`, err);
    return [];
  }
}

export async function fetchRss(config: RssConfig): Promise<Story[]> {
  const allStories: Story[] = [];

  const results = await Promise.allSettled(
    config.feeds.map(async (feed) => {
      try {
        const res = await fetch(feed.url);
        if (!res.ok) {
          console.error(`[rss] ${feed.name} failed: ${res.status}`);
          return [];
        }
        const xml = await res.text();
        return parseRssXml(xml, feed.name, 24);
      } catch (err) {
        console.error(`[rss] ${feed.name} error:`, err);
        return [];
      }
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      allStories.push(...result.value);
    }
  }

  return allStories;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Projects/ai-briefing
bun test tests/sources/rss.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/ai-briefing
git add src/sources/rss.ts tests/sources/rss.test.ts
git commit -m "feat: RSS/Atom source with XML parsing and age filtering"
```

---

### Task 6: Deduplication & Ranking

**Files:**
- Create: `src/dedupe.ts`
- Create: `tests/dedupe.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dedupe.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { dedupeAndRank } from "../src/dedupe";
import type { Story } from "../src/types";

function makeStory(overrides: Partial<Story>): Story {
  return {
    title: "Default Title",
    url: "https://example.com/default",
    source: "tavily",
    sourceName: "Tavily",
    summary: "Default summary",
    publishedAt: new Date("2026-04-03T12:00:00Z"),
    ...overrides,
  };
}

describe("dedupeAndRank", () => {
  test("removes exact URL duplicates", () => {
    const stories = [
      makeStory({ title: "Story A", url: "https://example.com/1", source: "tavily" }),
      makeStory({ title: "Story A from HN", url: "https://example.com/1", source: "hackernews" }),
    ];
    const result = dedupeAndRank(stories, 30);
    expect(result).toHaveLength(1);
  });

  test("removes title-similar duplicates", () => {
    const stories = [
      makeStory({ title: "OpenAI Releases GPT-5", url: "https://a.com/1", source: "tavily" }),
      makeStory({ title: "OpenAI releases GPT-5!", url: "https://b.com/2", source: "rss" }),
    ];
    const result = dedupeAndRank(stories, 30);
    expect(result).toHaveLength(1);
  });

  test("keeps stories with different titles", () => {
    const stories = [
      makeStory({ title: "OpenAI launches GPT-5", url: "https://a.com/1" }),
      makeStory({ title: "Anthropic ships Claude update", url: "https://b.com/2" }),
    ];
    const result = dedupeAndRank(stories, 30);
    expect(result).toHaveLength(2);
  });

  test("caps results at maxStories", () => {
    const stories = Array.from({ length: 50 }, (_, i) =>
      makeStory({ title: `Story ${i}`, url: `https://example.com/${i}` })
    );
    const result = dedupeAndRank(stories, 30);
    expect(result).toHaveLength(30);
  });

  test("ranks higher-scored stories first", () => {
    const stories = [
      makeStory({ title: "Low score", url: "https://a.com/1", score: 10 }),
      makeStory({ title: "High score", url: "https://b.com/2", score: 500 }),
    ];
    const result = dedupeAndRank(stories, 30);
    expect(result[0].title).toBe("High score");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Projects/ai-briefing
bun test tests/dedupe.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/dedupe.ts`:

```typescript
import type { Story } from "./types";

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function titlesAreSimilar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

export function dedupeAndRank(stories: Story[], maxStories: number): Story[] {
  const deduped: Story[] = [];
  const seenUrls = new Set<string>();

  for (const story of stories) {
    // URL dedup
    if (seenUrls.has(story.url)) continue;

    // Title similarity dedup
    const isDuplicate = deduped.some((existing) => titlesAreSimilar(existing.title, story.title));
    if (isDuplicate) continue;

    seenUrls.add(story.url);
    deduped.push(story);
  }

  // Rank: score (if present) + recency
  const now = Date.now();
  return deduped
    .sort((a, b) => {
      const scoreA = (a.score ?? 0) + (1 - (now - a.publishedAt.getTime()) / (24 * 60 * 60 * 1000));
      const scoreB = (b.score ?? 0) + (1 - (now - b.publishedAt.getTime()) / (24 * 60 * 60 * 1000));
      return scoreB - scoreA;
    })
    .slice(0, maxStories);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Projects/ai-briefing
bun test tests/dedupe.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/ai-briefing
git add src/dedupe.ts tests/dedupe.test.ts
git commit -m "feat: story deduplication by URL and title similarity with ranking"
```

---

### Task 7: Ollama Summarization

**Files:**
- Create: `src/summarize.ts`
- Create: `tests/summarize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/summarize.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { buildPrompt, buildFallbackBriefing } from "../src/summarize";
import type { Story } from "../src/types";

const sampleStories: Story[] = [
  {
    title: "OpenAI releases GPT-5",
    url: "https://example.com/gpt5",
    source: "tavily",
    sourceName: "Tavily",
    summary: "OpenAI announced GPT-5 with major improvements in reasoning.",
    publishedAt: new Date("2026-04-03T12:00:00Z"),
    score: 100,
  },
  {
    title: "EU passes comprehensive AI regulation",
    url: "https://example.com/eu-ai",
    source: "rss",
    sourceName: "Ars Technica",
    summary: "The European Union passed sweeping AI regulation today.",
    publishedAt: new Date("2026-04-03T10:00:00Z"),
  },
];

const categories = ["Models & Releases", "Policy & Safety", "Industry", "Open Source & Tools", "Research"];

describe("buildPrompt", () => {
  test("includes all stories in the prompt", () => {
    const prompt = buildPrompt(sampleStories, categories);
    expect(prompt).toContain("OpenAI releases GPT-5");
    expect(prompt).toContain("EU passes comprehensive AI regulation");
    expect(prompt).toContain("Models & Releases");
    expect(prompt).toContain("Policy & Safety");
  });

  test("requests JSON output", () => {
    const prompt = buildPrompt(sampleStories, categories);
    expect(prompt).toContain("JSON");
  });
});

describe("buildFallbackBriefing", () => {
  test("creates briefing from raw stories without summarization", () => {
    const briefing = buildFallbackBriefing(sampleStories, categories);
    expect(briefing.topStories.length).toBeLessThanOrEqual(5);
    expect(briefing.topStories[0].title).toBe("OpenAI releases GPT-5");
    expect(briefing.topStories[0].url).toBe("https://example.com/gpt5");
    expect(briefing.categories).toBeDefined();
  });

  test("puts remaining stories in first category as uncategorized fallback", () => {
    const briefing = buildFallbackBriefing(sampleStories, categories);
    const allCategorized = Object.values(briefing.categories).flat();
    // Stories beyond top 5 go into categories (or first category as catch-all)
    expect(briefing.topStories.length + allCategorized.length).toBe(sampleStories.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Projects/ai-briefing
bun test tests/summarize.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/summarize.ts`:

```typescript
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

  // Without LLM categorization, dump remaining into first category
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

    // Ensure all categories exist
    for (const c of categories) {
      if (!briefing.categories[c]) briefing.categories[c] = [];
    }

    return briefing;
  } catch (err) {
    console.error("[ollama] summarization error, using fallback:", err);
    return buildFallbackBriefing(stories, categories);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Projects/ai-briefing
bun test tests/summarize.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/ai-briefing
git add src/summarize.ts tests/summarize.test.ts
git commit -m "feat: Ollama summarization with structured prompt and fallback"
```

---

### Task 8: Obsidian Writer

**Files:**
- Create: `src/writer.ts`
- Create: `tests/writer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/writer.test.ts`:

```typescript
import { describe, test, expect, afterEach } from "bun:test";
import { renderBriefing } from "../src/writer";
import type { SummarizedBriefing } from "../src/types";
import { rmSync } from "fs";

const sampleBriefing: SummarizedBriefing = {
  topStories: [
    { title: "GPT-5 Released", take: "Major reasoning improvements", source: "Tavily", url: "https://example.com/gpt5" },
    { title: "EU AI Act Enforced", take: "Sweeping new regulations", source: "Ars Technica", url: "https://example.com/eu" },
  ],
  categories: {
    "Models & Releases": [
      { title: "Llama 4 drops", summary: "Meta releases Llama 4", source: "Hacker News", url: "https://example.com/llama" },
    ],
    "Policy & Safety": [],
    "Industry": [
      { title: "AI startup raises $1B", summary: "Record funding round", source: "The Verge", url: "https://example.com/startup" },
    ],
    "Open Source & Tools": [],
    "Research": [],
  },
};

describe("renderBriefing", () => {
  test("renders correct YAML frontmatter", () => {
    const md = renderBriefing(sampleBriefing, new Date("2026-04-04"), 15);
    expect(md).toContain("---\ndate: 2026-04-04");
    expect(md).toContain("type: ai-briefing");
    expect(md).toContain("story_count: 15");
    expect(md).toContain("sources: [tavily, hackernews, rss]");
  });

  test("renders top stories section", () => {
    const md = renderBriefing(sampleBriefing, new Date("2026-04-04"), 15);
    expect(md).toContain("## Top Stories");
    expect(md).toContain("**GPT-5 Released** — Major reasoning improvements ([Tavily](https://example.com/gpt5))");
  });

  test("renders category sections", () => {
    const md = renderBriefing(sampleBriefing, new Date("2026-04-04"), 15);
    expect(md).toContain("## Models & Releases");
    expect(md).toContain("**Llama 4 drops** — Meta releases Llama 4 ([Hacker News](https://example.com/llama))");
  });

  test("skips empty categories", () => {
    const md = renderBriefing(sampleBriefing, new Date("2026-04-04"), 15);
    expect(md).not.toContain("## Policy & Safety");
    expect(md).not.toContain("## Research");
  });

  test("includes heading with formatted date", () => {
    const md = renderBriefing(sampleBriefing, new Date("2026-04-04"), 15);
    expect(md).toContain("# AI Briefing — April 4, 2026");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Projects/ai-briefing
bun test tests/writer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/writer.ts`:

```typescript
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { SummarizedBriefing } from "./types";

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatHeadingDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function renderBriefing(briefing: SummarizedBriefing, date: Date, storyCount: number): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push("---");
  lines.push(`date: ${formatDate(date)}`);
  lines.push("type: ai-briefing");
  lines.push("sources: [tavily, hackernews, rss]");
  lines.push(`story_count: ${storyCount}`);
  lines.push("---");
  lines.push("");
  lines.push(`# AI Briefing — ${formatHeadingDate(date)}`);
  lines.push("");

  // Top Stories
  if (briefing.topStories.length > 0) {
    lines.push("## Top Stories");
    for (const story of briefing.topStories) {
      lines.push(`- **${story.title}** — ${story.take} ([${story.source}](${story.url}))`);
    }
    lines.push("");
  }

  // Categories
  for (const [category, stories] of Object.entries(briefing.categories)) {
    if (stories.length === 0) continue;
    lines.push(`## ${category}`);
    for (const story of stories) {
      lines.push(`- **${story.title}** — ${story.summary} ([${story.source}](${story.url}))`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function writeBriefing(briefing: SummarizedBriefing, outputPath: string, date: Date, storyCount: number): string {
  mkdirSync(outputPath, { recursive: true });
  const filename = `${formatDate(date)}.md`;
  const filepath = join(outputPath, filename);
  const content = renderBriefing(briefing, date, storyCount);
  writeFileSync(filepath, content, "utf-8");
  console.log(`[writer] wrote briefing to ${filepath}`);
  return filepath;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Projects/ai-briefing
bun test tests/writer.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/ai-briefing
git add src/writer.ts tests/writer.test.ts
git commit -m "feat: Obsidian markdown writer with frontmatter and category rendering"
```

---

### Task 9: Main Pipeline (Entry Point)

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write src/index.ts**

```typescript
import { loadConfig } from "./config";
import { fetchTavily } from "./sources/tavily";
import { fetchHackerNews } from "./sources/hackernews";
import { fetchRss } from "./sources/rss";
import { dedupeAndRank } from "./dedupe";
import { summarize } from "./summarize";
import { writeBriefing } from "./writer";

async function main() {
  const startTime = Date.now();
  console.log("[ai-briefing] starting...");

  const config = loadConfig();

  // Scrape all sources in parallel
  console.log("[ai-briefing] fetching sources...");
  const [tavilyStories, hnStories, rssStories] = await Promise.all([
    fetchTavily(config.tavily).catch((err) => {
      console.error("[ai-briefing] tavily failed:", err);
      return [];
    }),
    fetchHackerNews(config.hackernews).catch((err) => {
      console.error("[ai-briefing] hackernews failed:", err);
      return [];
    }),
    fetchRss(config.rss).catch((err) => {
      console.error("[ai-briefing] rss failed:", err);
      return [];
    }),
  ]);

  console.log(`[ai-briefing] fetched: tavily=${tavilyStories.length}, hn=${hnStories.length}, rss=${rssStories.length}`);

  const allStories = [...tavilyStories, ...hnStories, ...rssStories];

  if (allStories.length === 0) {
    console.error("[ai-briefing] no stories from any source, writing error note");
    const errorContent = `---\ndate: ${new Date().toISOString().split("T")[0]}\ntype: ai-briefing\nerror: true\n---\n# AI Briefing — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}\n\n> **Error:** No stories were fetched from any source. Check logs: \`journalctl --user -u ai-briefing\`\n`;
    const { mkdirSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    mkdirSync(config.output.path, { recursive: true });
    writeFileSync(join(config.output.path, `${new Date().toISOString().split("T")[0]}.md`), errorContent);
    process.exit(1);
  }

  // Deduplicate and rank
  const ranked = dedupeAndRank(allStories, 30);
  console.log(`[ai-briefing] ${ranked.length} stories after dedup`);

  // Summarize via Ollama
  console.log("[ai-briefing] summarizing via ollama...");
  const briefing = await summarize(ranked, config.ollama, config.output.categories);

  // Write to Obsidian
  const filepath = writeBriefing(briefing, config.output.path, new Date(), allStories.length);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[ai-briefing] done in ${elapsed}s — ${filepath}`);
}

main().catch((err) => {
  console.error("[ai-briefing] fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test with a dry run**

```bash
cd ~/Projects/ai-briefing
TAVILY_API_KEY=$(cat $XDG_RUNTIME_DIR/secrets/ai-briefing.env | grep TAVILY_API_KEY | cut -d= -f2) bun run src/index.ts
```

Expected: Script runs, fetches from all sources, writes a note to `~/Obsidian/lgl/AI/News/2026-04-03.md`. Check the output file.

- [ ] **Step 3: Verify the output file looks correct**

```bash
cat ~/Obsidian/lgl/AI/News/2026-04-03.md
```

Expected: Markdown file with YAML frontmatter, Top Stories section, and category sections.

- [ ] **Step 4: Run full test suite**

```bash
cd ~/Projects/ai-briefing
bun test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/ai-briefing
git add src/index.ts
git commit -m "feat: main pipeline orchestrating scrape, dedupe, summarize, write"
```

---

### Task 10: Systemd Service & Timer

**Files:**
- Create: `~/.config/systemd/user/ai-briefing.service`
- Create: `~/.config/systemd/user/ai-briefing.timer`

- [ ] **Step 1: Create the service unit**

Write `~/.config/systemd/user/ai-briefing.service`:

```ini
[Unit]
Description=AI Morning Briefing — nightly news scraper and summarizer
Requires=decrypt-secrets.service
After=decrypt-secrets.service

[Service]
Type=oneshot
ExecStart=/home/leo/.bun/bin/bun run /home/leo/Projects/ai-briefing/src/index.ts
EnvironmentFile=%t/secrets/ai-briefing.env
Environment=PATH=/home/leo/.local/bin:/home/leo/.bun/bin:/usr/bin
WorkingDirectory=/home/leo/Projects/ai-briefing

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Create the timer unit**

Write `~/.config/systemd/user/ai-briefing.timer`:

```ini
[Unit]
Description=Run AI Morning Briefing at midnight daily

[Timer]
OnCalendar=*-*-* 00:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Enable and test**

```bash
systemctl --user daemon-reload
systemctl --user enable ai-briefing.timer
systemctl --user start ai-briefing.timer
systemctl --user list-timers | grep ai-briefing
```

Expected: Timer shows next run at midnight.

- [ ] **Step 4: Manual test via service**

```bash
systemctl --user start ai-briefing.service
journalctl --user -u ai-briefing --no-pager -n 30
```

Expected: Logs show successful fetch, dedup, summarize, and write. Check `~/Obsidian/lgl/AI/News/` for today's file.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/ai-briefing
git add ~/.config/systemd/user/ai-briefing.service ~/.config/systemd/user/ai-briefing.timer
git commit -m "feat: systemd service and timer for nightly briefing at midnight"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Tavily source (Task 3)
- [x] Hacker News source (Task 4)
- [x] RSS source (Task 5)
- [x] Dedup & rank (Task 6)
- [x] Ollama summarization with fallback (Task 7)
- [x] Obsidian writer with hybrid format (Task 8)
- [x] Main pipeline (Task 9)
- [x] systemd timer at midnight (Task 10)
- [x] config.yaml (Task 1)
- [x] Secrets via EnvironmentFile (Task 10)
- [x] Error handling — source failures, Ollama down, all sources fail (Tasks 3-5, 7, 9)

**Placeholder scan:** No TBDs, TODOs, or vague steps. All code blocks complete.

**Type consistency:** `Story`, `Config`, `SummarizedBriefing` used consistently across all tasks. Method names match between definition and usage.
