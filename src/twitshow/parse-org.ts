import type { Show } from "../labels";
import type { ParsedPage, ParsedSection } from "./parse";

// Matches top-level sections: exactly one leading asterisk
const TOP_SECTION_RE = /^\*\s+(.+?)\s*$/;
// Matches article headings: exactly two leading asterisks
const ARTICLE_RE = /^\*\*\s+(.+?)\s*$/;
// Matches the *** URL subheading
const URL_HEADING_RE = /^\*\*\*\s+URL\s*$/i;

/**
 * Parse a TWiT org-mode archive file.
 *
 * Structure expected:
 *   * SectionName          ← top-level topic heading
 *   ** Article Title       ← article heading (title)
 *   *** URL
 *   https://...            ← plain URL on the line after *** URL
 *   *** Date
 *   *** Summary
 *   ...
 */
export function parseOrgFile(org: string, show: Show, episode_date: string): ParsedPage {
  const lines = org.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;
  let pendingTitle: string | null = null;
  let awaitingUrl = false;
  let sectionOrder = 0;

  for (const line of lines) {
    // Top-level section heading (* Foo)
    if (TOP_SECTION_RE.test(line)) {
      const m = line.match(TOP_SECTION_RE)!;
      sectionOrder++;
      currentSection = { name: m[1], order: sectionOrder, picks: [] };
      sections.push(currentSection);
      pendingTitle = null;
      awaitingUrl = false;
      continue;
    }

    // Article heading (** Title)
    if (ARTICLE_RE.test(line)) {
      const m = line.match(ARTICLE_RE)!;
      pendingTitle = m[1];
      awaitingUrl = false;
      continue;
    }

    // *** URL subheading — next non-blank line is the URL
    if (URL_HEADING_RE.test(line)) {
      awaitingUrl = true;
      continue;
    }

    // Collect the URL that follows *** URL
    if (awaitingUrl) {
      const trimmed = line.trim();
      if (!trimmed) continue; // skip blank lines until we get the URL
      awaitingUrl = false;
      if (/^https?:\/\//.test(trimmed) && pendingTitle && currentSection) {
        currentSection.picks.push({
          url: trimmed,
          title: pendingTitle,
          rank_in_section: currentSection.picks.length + 1,
        });
        pendingTitle = null;
      }
      continue;
    }
  }

  return { show, episode_date, sections };
}
