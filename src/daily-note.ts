import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export interface DailyNoteOpts {
  date: Date;
  coordinates: [string, string];
  weatherLine: string | null;
  bannerRef: string | null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthDir(d: Date): string {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}`;
}

function weekday(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

function techBriefingLink(d: Date): string {
  return `[[AI/News/${monthDir(d)}/${dateStr(d)}|📰 Tech Briefing]]`;
}

export function renderNewDailyNote(opts: DailyNoteOpts): string {
  const { date, coordinates, weatherLine, bannerRef } = opts;
  const [lat, lon] = coordinates;

  const fmLines = [
    "---",
    `coordinates:\n  - "${lat}"\n  - "${lon}"`,
    `tags:\n  - "#Dailies"`,
    `created: ${dateStr(date)}`,
    "modified:",
    "type:",
    "status:",
    "aliases:",
    `summary: ""`,
    "related: []",
  ];
  if (bannerRef) fmLines.push(`banner: "${bannerRef}"`);
  fmLines.push("---");
  const frontmatter = fmLines.join("\n");

  const weather = weatherLine ? `${weatherLine}\n\n` : "";

  const body = `### 📝 ${weekday(date)}'s Notes
${weather}${techBriefingLink(date)}

#### Exercise

#### Meals


#### Voice Notes


#### Listening


---
#### Rose, thorn, bud
* 🌹
* 🪢
* 🔮
#### 🙏 Gratitude
*
*
*
---

[Today in Wikipedia](https://en.wikipedia.org/wiki/Main_Page)

#### ☑️ Tasks for Today
\`\`\`tasks
not done
(due before tomorrow) OR (no due date)
sort by due
\`\`\`
`;

  return `${frontmatter}\n${body}`;
}

function addBannerToFrontmatter(content: string, bannerRef: string | null): string {
  if (!bannerRef) return content;
  if (/^banner:/m.test(content)) return content;
  if (!content.startsWith("---\n")) return content;
  const fmEnd = content.indexOf("\n---", 4);
  if (fmEnd < 0) return content;
  return `${content.slice(0, fmEnd)}\nbanner: "${bannerRef}"${content.slice(fmEnd)}`;
}

function addWeatherLine(content: string, weatherLine: string | null): string {
  if (!weatherLine) return content;
  if (content.includes("🌍 ")) return content;
  const match = content.match(/(### 📝 [^\n]+\n)/);
  if (!match || match.index === undefined) return content;
  const insertAt = match.index + match[0].length;
  return `${content.slice(0, insertAt)}${weatherLine}\n\n${content.slice(insertAt)}`;
}

function addTechBriefingLinkToContent(content: string, date: Date): string {
  const link = techBriefingLink(date);
  if (content.includes(link)) return content;
  const idx = content.indexOf("#### Exercise");
  if (idx < 0) return `${content}\n${link}\n`;
  return `${content.slice(0, idx)}${link}\n\n${content.slice(idx)}`;
}

export function createOrUpdateDailyNote(vaultPath: string, opts: DailyNoteOpts): string {
  const dir = join(vaultPath, "Daily Notes", monthDir(opts.date));
  const notePath = join(dir, `${dateStr(opts.date)}.md`);
  mkdirSync(dir, { recursive: true });

  if (!existsSync(notePath)) {
    writeFileSync(notePath, renderNewDailyNote(opts), "utf-8");
    return notePath;
  }

  let content = readFileSync(notePath, "utf-8");
  content = addBannerToFrontmatter(content, opts.bannerRef);
  content = addWeatherLine(content, opts.weatherLine);
  content = addTechBriefingLinkToContent(content, opts.date);
  writeFileSync(notePath, content, "utf-8");
  return notePath;
}
