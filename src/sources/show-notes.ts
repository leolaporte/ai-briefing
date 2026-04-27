import { canonicalizeUrl } from "../cluster";
import { decodeEntities } from "./rss";

export interface ShowNotesLink {
  url: string;
  title: string | null;
}

/**
 * Extract URLs from the "Links" section of a twit.tv episode page.
 * The Links section is identified by an <h3> or <h4> with text "Links",
 * followed by <a href> elements. URLs are canonicalized.
 */
export function extractShowNotesLinks(html: string): ShowNotesLink[] {
  const headingRe = /<h[1-6][^>]*>\s*Links\s*<\/h[1-6]>/i;
  const headingMatch = headingRe.exec(html);
  if (!headingMatch) return [];

  const sliceStart = headingMatch.index + headingMatch[0].length;
  const tail = html.slice(sliceStart);
  const nextHeading = /<h[1-4][^>]*>/i.exec(tail);
  const section = nextHeading ? tail.slice(0, nextHeading.index) : tail;

  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out: ShowNotesLink[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(section)) !== null) {
    const href = m[1];
    if (!/^https?:\/\//i.test(href)) continue;
    const canonical = canonicalizeUrl(href);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const titleHtml = decodeEntities(m[2].replace(/<[^>]+>/g, "")).trim();
    out.push({ url: canonical, title: titleHtml || null });
  }
  return out;
}

/**
 * Parse the show's episode listing page and return the most recent
 * episode's number and air date.
 */
export function parseEpisodeListing(html: string): { number: number; date: string } | null {
  const re = /\/episodes\/(\d+)["'][^>]*>[\s\S]{0,200}?(\w+\s+\d+,\s+\d{4})/;
  const m = re.exec(html);
  if (!m) return null;
  const number = parseInt(m[1], 10);
  const date = new Date(m[2]).toISOString().slice(0, 10);
  return { number, date };
}

const SHOW_SLUGS: Record<string, string> = {
  twit: "this-week-in-tech",
  mbw: "macbreak-weekly",
  im: "intelligent-machines",
};

export interface FetchedShowNotes {
  show: string;
  episodeNumber: number;
  episodeDate: string; // YYYY-MM-DD
  links: ShowNotesLink[];
}

/**
 * Fetch the most recent episode for a show. If `episode` is given, fetches
 * that specific episode. Returns null on parse failure (notes not yet
 * published, network error, page format change).
 */
export async function fetchLatestShowNotes(
  show: keyof typeof SHOW_SLUGS,
  episode?: number
): Promise<FetchedShowNotes | null> {
  const slug = SHOW_SLUGS[show];
  if (!slug) throw new Error(`unknown show: ${show}`);

  let episodeNumber: number;
  let episodeDate: string;

  if (episode !== undefined) {
    episodeNumber = episode;
    episodeDate = new Date().toISOString().slice(0, 10);
  } else {
    const listing = await fetch(`https://twit.tv/shows/${slug}`).then(r => r.text());
    const parsed = parseEpisodeListing(listing);
    if (!parsed) return null;
    episodeNumber = parsed.number;
    episodeDate = parsed.date;
  }

  const html = await fetch(`https://twit.tv/shows/${slug}/episodes/${episodeNumber}`).then(r => r.text());
  const links = extractShowNotesLinks(html);
  if (links.length === 0) return null;
  return { show, episodeNumber, episodeDate, links };
}
