import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
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

/**
 * Append a link to the AI briefing in the Obsidian daily note for the given date.
 * Daily notes live at: ~/Obsidian/lgl/Daily Notes/YYYY/MM/YYYY-MM-DD.md
 * The link line looks like: [[AI/News/YYYY-MM-DD|AI Briefing]]
 */
export function linkInDailyNote(vaultPath: string, date: Date): void {
  const dateStr = formatDate(date);
  const [year, month] = dateStr.split("-");
  const dailyNotePath = join(vaultPath, "Daily Notes", year, month, `${dateStr}.md`);
  const linkLine = `\n[[AI/News/${dateStr}|AI Briefing]]\n`;

  if (!existsSync(dailyNotePath)) {
    console.log(`[writer] daily note not found at ${dailyNotePath}, skipping link`);
    return;
  }

  const content = readFileSync(dailyNotePath, "utf-8");
  // Don't add duplicate links
  if (content.includes(`[[AI/News/${dateStr}|AI Briefing]]`)) {
    console.log("[writer] daily note already has briefing link, skipping");
    return;
  }

  // Append after the frontmatter closing ---
  // Find the second --- (end of frontmatter)
  const frontmatterEnd = content.indexOf("---", content.indexOf("---") + 3);
  if (frontmatterEnd === -1) {
    // No frontmatter, append to end
    writeFileSync(dailyNotePath, content + linkLine, "utf-8");
  } else {
    // Insert after the line that contains the second ---
    const insertPos = content.indexOf("\n", frontmatterEnd) + 1;
    const updated = content.slice(0, insertPos) + linkLine + content.slice(insertPos);
    writeFileSync(dailyNotePath, updated, "utf-8");
  }

  console.log(`[writer] added briefing link to daily note ${dailyNotePath}`);
}
