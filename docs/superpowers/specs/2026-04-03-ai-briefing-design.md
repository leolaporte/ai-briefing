# AI Morning Briefing — Design Spec

## Overview

A nightly pipeline that scrapes AI news from three source types, deduplicates and ranks stories, summarizes via Ollama, and writes a hybrid-format Obsidian note ready for morning reading.

## Architecture

```
[Tavily Search] ──┐
[HN Algolia API] ─┤──▶ Dedupe & Rank ──▶ Ollama Summarize ──▶ Write Obsidian Note
[RSS Feeds] ──────┘
```

- **Runtime:** Bun (TypeScript)
- **Project:** `~/Projects/ai-briefing/`
- **Schedule:** systemd user timer, midnight daily
- **Output:** `~/Obsidian/lgl/AI/News/YYYY-MM-DD.md`

## Sources

### Tavily

2-3 targeted searches per run via Tavily REST API:

- `"AI news today"` — broad catch-all
- `"LLM release announcement"` — model drops
- `"AI policy regulation"` — governance

Max 10 results per query. Tavily handles dedup across its own results. Key names (Karpathy, LeCun, Altman, Hassabis, etc.) included as search terms to catch coverage of their posts — we're not scraping X directly, we're catching the ripple.

### Hacker News

HN Algolia API (`http://hn.algolia.com/api/v1/search`). Filter front page stories matching AI/ML keywords. Top 15-20 stories by points.

Keywords: `AI`, `LLM`, `GPT`, `Claude`, `machine learning`, `neural`, `transformer`, `diffusion`, `foundation model`, `open source model`.

Minimum points threshold: 20.

### RSS Feeds

Standard RSS/Atom parsing. Configurable feed list:

- Ars Technica AI
- The Verge AI
- MIT Technology Review AI
- Google AI Blog
- OpenAI Blog
- Anthropic Blog
- Hugging Face Blog
- Simon Willison's Weblog

Only items published in the last 24 hours.

## Pipeline

### 1. Scrape (parallel)

All three source types run concurrently. Each returns a normalized array of `Story` objects:

```typescript
interface Story {
  title: string;
  url: string;
  source: "tavily" | "hackernews" | "rss";
  sourceName: string; // e.g. "Ars Technica", "Hacker News"
  summary: string; // raw snippet or description
  publishedAt: Date;
  score?: number; // HN points, Tavily relevance score
}
```

### 2. Deduplicate & Rank

- Deduplicate by URL (exact match)
- Deduplicate by title similarity (lowercase, strip punctuation, check if one title contains the other — catches same story from multiple sources without pulling in a fuzzy matching library)
- Rank by: source diversity bonus + recency + engagement score
- Cap at ~30 stories for summarization

### 3. Summarize (Ollama)

Send the merged story list to Ollama (llama3 or configured model) with a structured prompt:

- Identify the top 5 stories across all sources
- Categorize remaining stories into: Models & Releases, Policy & Safety, Industry, Open Source & Tools, Research
- Generate a one-line take for each story
- Keep it factual and concise

If Ollama is unreachable, fall back to raw bullet points (title + source + link) without summarization.

### 4. Write Obsidian Note

Write to `~/Obsidian/lgl/AI/News/YYYY-MM-DD.md`:

```markdown
---
date: 2026-04-04
type: ai-briefing
sources: [tavily, hackernews, rss]
story_count: 23
---
# AI Briefing — April 4, 2026

## Top Stories
- **Headline** — one-line take ([source](url))
- **Headline** — one-line take ([source](url))
- **Headline** — one-line take ([source](url))
- **Headline** — one-line take ([source](url))
- **Headline** — one-line take ([source](url))

## Models & Releases
- **Story title** — summary ([source](url))

## Policy & Safety
- ...

## Industry
- ...

## Open Source & Tools
- ...

## Research
- ...
```

If the file already exists (re-run), overwrite it.

## Configuration

`config.yaml` in project root — editable without touching code:

```yaml
tavily:
  queries:
    - "AI news today"
    - "LLM release announcement"
    - "AI policy regulation"
  max_results_per_query: 10

hackernews:
  keywords: ["AI", "LLM", "GPT", "Claude", "machine learning", "neural", "transformer", "diffusion"]
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

## Infrastructure

### Systemd

**Service:** `~/.config/systemd/user/ai-briefing.service`
- `Type=oneshot`
- `ExecStart=/home/leo/.bun/bin/bun run /home/leo/Projects/ai-briefing/src/index.ts`
- `EnvironmentFile=%t/secrets/ai-briefing.env`
- `Environment=PATH=/home/leo/.local/bin:/home/leo/.bun/bin:/usr/bin`
- `Requires=decrypt-secrets.service`
- `After=decrypt-secrets.service`

**Timer:** `~/.config/systemd/user/ai-briefing.timer`
- `OnCalendar=*-*-* 00:00:00` (midnight daily)
- `Persistent=true` (catch up if machine was asleep)

### Secrets

- `TAVILY_API_KEY` in `~/.dotfiles/sops/services/ai-briefing.env` (sops-encrypted)
- Declared in `secrets-manifest.toml` under `[ai-briefing]`
- Decrypted to `$XDG_RUNTIME_DIR/secrets/ai-briefing.env` by `decrypt-secrets.service`

### Dependencies

- `bun` — runtime
- `ollama` — local LLM (already running for Open Brain)
- No external npm packages beyond standard HTTP fetch and a YAML parser

## Error Handling

- If a source fails (network error, API down), log the error and continue with remaining sources
- If all sources fail, write an empty briefing note with an error banner at the top
- If Ollama is down, write raw bullet points without summarization
- Errors logged to systemd journal (`journalctl --user -u ai-briefing`)

## Future Additions (not in scope)

- Apify X.com scraping for direct tweet signal
- ArXiv paper abstracts
- Email delivery option
- Trending topic detection across days
