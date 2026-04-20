import type { Show } from "../labels";
import type { ParsedPage, ParsedSection } from "./parse";

// CSV columns (observed in twit-YYYY-MM-DD-LINKS.csv):
//   col 0: empty (always blank)
//   col 1: section name (first row of each section); empty string on continuation rows
//   col 2: title (may be quoted; may contain commas)
//   col 3: notes (usually empty)
//   col 4: URL
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let buf = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { buf += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else buf += c;
    } else {
      if (c === ',') { fields.push(buf); buf = ""; }
      else if (c === '"' && buf === "") inQuotes = true;
      else buf += c;
    }
  }
  fields.push(buf);
  return fields;
}

export function parseLinksCsv(csv: string, show: Show, episode_date: string): ParsedPage {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let sectionOrder = 0;

  for (const rawLine of csv.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const fields = parseCsvLine(rawLine);
    const sectionName = (fields[1] ?? "").trim();
    const title = (fields[2] ?? "").trim();
    const url = (fields[4] ?? "").trim();
    if (!url || !/^https?:\/\//.test(url)) continue;

    if (sectionName) {
      sectionOrder++;
      current = { name: sectionName, order: sectionOrder, picks: [] };
      sections.push(current);
    }
    if (!current) {
      sectionOrder++;
      current = { name: "(uncategorized)", order: sectionOrder, picks: [] };
      sections.push(current);
    }
    current.picks.push({
      url, title,
      rank_in_section: current.picks.length + 1,
    });
  }
  return { show, episode_date, sections };
}
