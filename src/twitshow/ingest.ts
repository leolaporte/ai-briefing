import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseTwitShowHtml } from "./parse";
import { parseOrgFile } from "./parse-org";
import { parseLinksCsv } from "./parse-csv";
import type { LabelStore, PickRow, Show } from "../labels";
import type { ParsedPage } from "./parse";

const SHOWS: Show[] = ["twit", "mbw", "im"];

// Filename patterns: <show>-YYYY-MM-DD.html | .org | -LINKS.csv
const DATE_FROM_NAME = /^(twit|mbw|im)-(\d{4}-\d{2}-\d{2})(?:\.html|\.org|-LINKS\.csv)$/;

export interface IngestResult {
  files_parsed: number;
  files_skipped: number;
  picks_inserted: number;
}

interface FileRef {
  show: Show;
  date: string;
  format: "html" | "org" | "csv";
  path: string;
  name: string;
}

function formatOf(name: string): "html" | "org" | "csv" | null {
  if (name.endsWith(".html")) return "html";
  if (name.endsWith(".org")) return "org";
  if (name.endsWith("-LINKS.csv")) return "csv";
  return null;
}

function parseFile(ref: FileRef): ParsedPage {
  const content = readFileSync(ref.path, "utf-8");
  if (ref.format === "html") return parseTwitShowHtml(content, ref.show);
  if (ref.format === "org") return parseOrgFile(content, ref.show, ref.date);
  return parseLinksCsv(content, ref.show, ref.date);
}

function toPickRows(parsed: ParsedPage, source_file: string): PickRow[] {
  const rows: PickRow[] = [];
  for (const section of parsed.sections) {
    for (const pick of section.picks) {
      rows.push({
        show: parsed.show,
        episode_date: parsed.episode_date,
        section_name: section.name,
        section_order: section.order,
        rank_in_section: pick.rank_in_section,
        story_url: pick.url,
        story_title: pick.title,
        source_file,
      });
    }
  }
  return rows;
}

export async function ingestArchives(rootDir: string, store: LabelStore): Promise<IngestResult> {
  const byStem = new Map<string, FileRef[]>();

  for (const show of SHOWS) {
    const dir = join(rootDir, `archive-${show}`);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const m = name.match(DATE_FROM_NAME);
      if (!m || m[1] !== show) continue;
      const format = formatOf(name);
      if (!format) continue;
      const stem = `${show}-${m[2]}`;
      const arr = byStem.get(stem) ?? [];
      arr.push({ show, date: m[2], format, path: join(dir, name), name });
      byStem.set(stem, arr);
    }
  }

  const priority: Record<"html" | "org" | "csv", number> = { html: 0, org: 1, csv: 2 };
  let files_parsed = 0, files_skipped = 0, picks_inserted = 0;

  for (const refs of byStem.values()) {
    refs.sort((a, b) => priority[a.format] - priority[b.format]);
    const winner = refs[0];
    files_skipped += refs.length - 1;
    try {
      const parsed = parseFile(winner);
      const rows = toPickRows(parsed, winner.name);
      const before = store.countByShow(winner.show);
      store.insertPicks(rows);
      const after = store.countByShow(winner.show);
      picks_inserted += after - before;
      files_parsed++;
    } catch (err) {
      console.error(`[ingest] failed to parse ${winner.path}: ${err}`);
    }
  }

  return { files_parsed, files_skipped, picks_inserted };
}
