import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { SelectionSplit, ScoredCluster } from "./selection";
import type { Show } from "./labels";

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
function dateStr(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthDir(d: Date): string { return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}`; }
function headingDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function briefingPathFor(basePath: string, d: Date): string {
  return join(basePath, monthDir(d), `${dateStr(d)}.md`);
}

const SHOW_LABEL: Record<Show, string> = {
  twit: "TWiT (general tech)",
  mbw: "MBW (Apple)",
  im: "IM (AI)",
};

function renderShowSection(show: Show, picks: ScoredCluster[]): string {
  if (picks.length === 0) return "";
  const lines: string[] = [`## ${SHOW_LABEL[show]} — ${picks.length} candidate${picks.length === 1 ? "" : "s"}`];
  for (const pick of picks) {
    const canonicalIdx = Math.max(0, Math.min(pick.cluster.length - 1, pick.scoring[show].canonical_idx - 1));
    const canonical = pick.cluster[canonicalIdx];
    const summary = canonical.first_para?.slice(0, 200) ?? "";
    lines.push(`- **${canonical.title}** — ${summary} ([${canonical.source_name}](${canonical.url_canonical}))`);
    for (let i = 0; i < pick.cluster.length; i++) {
      if (i === canonicalIdx) continue;
      const alt = pick.cluster[i];
      lines.push(`  - ([${alt.source_name}](${alt.url_canonical}))`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderOtherSection(clusters: ScoredCluster[]): string {
  if (clusters.length === 0) return "";
  const lines = [`## Other notable — ${clusters.length} below-threshold items`, ""];
  lines.push("*Items that didn't hit the per-show cutoff but scored above floor on at least one axis.*", "");
  for (const c of clusters) {
    const canonical = c.cluster[0];
    lines.push(`- **${canonical.title}** ([${canonical.source_name}](${canonical.url_canonical}))`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderBriefing(split: SelectionSplit, date: Date, poolSize: number): string {
  const sections = [
    `---\ndate: ${dateStr(date)}\ntype: tech-briefing\npool_size: ${poolSize}\n---`,
    "",
    `# Tech Briefing — ${headingDate(date)}`,
    "",
    renderShowSection("twit", split.twit),
    renderShowSection("mbw", split.mbw),
    renderShowSection("im", split.im),
    renderOtherSection(split.other),
  ];
  return sections.filter(Boolean).join("\n");
}

export function writeBriefing(
  split: SelectionSplit,
  basePath: string,
  date: Date,
  poolSize: number
): string {
  const path = briefingPathFor(basePath, date);
  mkdirSync(join(basePath, monthDir(date)), { recursive: true });
  writeFileSync(path, renderBriefing(split, date, poolSize), "utf-8");
  console.log(`[writer] wrote briefing to ${path}`);
  return path;
}