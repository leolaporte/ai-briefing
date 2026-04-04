import { loadConfig } from "./config";
import { fetchTavily } from "./sources/tavily";
import { fetchHackerNews } from "./sources/hackernews";
import { fetchRss } from "./sources/rss";
import { dedupeAndRank } from "./dedupe";
import { summarize } from "./summarize";
import { writeBriefing, linkInDailyNote } from "./writer";

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
    const { mkdirSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const errorContent = `---\ndate: ${dateStr}\ntype: ai-briefing\nerror: true\n---\n# AI Briefing — ${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}\n\n> **Error:** No stories were fetched from any source. Check logs: \`journalctl --user -u ai-briefing\`\n`;
    mkdirSync(config.output.path, { recursive: true });
    writeFileSync(join(config.output.path, `${dateStr}.md`), errorContent);
    process.exit(1);
  }

  // Deduplicate and rank
  const ranked = dedupeAndRank(allStories, 30);
  console.log(`[ai-briefing] ${ranked.length} stories after dedup`);

  // Summarize via Ollama
  console.log("[ai-briefing] summarizing via ollama...");
  const briefing = await summarize(ranked, config.ollama, config.output.categories);

  // Write to Obsidian
  const now = new Date();
  const filepath = writeBriefing(briefing, config.output.path, now, allStories.length);

  // Link in daily note
  // The vault root is the parent of the output path's "AI/News" portion
  // config.output.path is like /home/leo/Obsidian/lgl/AI/News
  // vault root is /home/leo/Obsidian/lgl
  const vaultPath = config.output.path.replace(/\/AI\/News\/?$/, "");
  linkInDailyNote(vaultPath, now);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[ai-briefing] done in ${elapsed}s — ${filepath}`);
}

main().catch((err) => {
  console.error("[ai-briefing] fatal error:", err);
  process.exit(1);
});
