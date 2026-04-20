import type { Show } from "../labels";

export interface ParsedPick {
  url: string;
  title: string;
  rank_in_section: number;
}

export interface ParsedSection {
  name: string;
  order: number;
  picks: ParsedPick[];
}

export interface ParsedPage {
  show: Show;
  episode_date: string;
  sections: ParsedSection[];
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

const decodeEntities = (s: string): string =>
  s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

function parseEpisodeDate(title: string): string {
  // "This Week in Tech Briefing - Sunday, 19 April 2026"
  const m = title.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (!m) throw new Error(`Cannot parse date from title: ${title}`);
  const [, day, monthName, year] = m;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) throw new Error(`Unknown month: ${monthName}`);
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

export function parseTwitShowHtml(html: string, show: Show): ParsedPage {
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (!titleMatch) throw new Error("No <title> in HTML");
  const episode_date = parseEpisodeDate(titleMatch[1]);

  const sections: ParsedSection[] = [];
  // Each section: <summary><h2>N. Name</h2></summary> ... <h3>Title</h3> ... <a href="URL"
  const sectionRegex = /<h2>\s*(\d+)\.\s*([^<]+?)\s*<\/h2>/g;
  const splits: Array<{ order: number; name: string; start: number }> = [];
  let sm: RegExpExecArray | null;
  while ((sm = sectionRegex.exec(html)) !== null) {
    splits.push({ order: Number(sm[1]), name: decodeEntities(sm[2].trim()), start: sm.index + sm[0].length });
  }
  for (let i = 0; i < splits.length; i++) {
    const end = i + 1 < splits.length ? splits[i + 1].start : html.length;
    const body = html.slice(splits[i].start, end);
    const picks: ParsedPick[] = [];
    const entryRegex = /<h3>\s*([^<]+?)\s*<\/h3>[\s\S]*?<a\s+href="([^"]+)"/g;
    let em: RegExpExecArray | null;
    let rank = 1;
    while ((em = entryRegex.exec(body)) !== null) {
      const title = decodeEntities(em[1].trim());
      const url = em[2].replace(/&amp;/g, "&");
      picks.push({ url, title, rank_in_section: rank++ });
    }
    sections.push({ name: splits[i].name, order: splits[i].order, picks });
  }

  return { show, episode_date, sections };
}
