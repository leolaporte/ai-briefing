// src/harvest.ts
import type { Show, LabeledPickInput, PickSource } from "./labels";
import { LabelStore } from "./labels";
import { ArchiveStore } from "./archive";
import { fetchLatestShowNotes, type FetchedShowNotes } from "./sources/show-notes";
import { fetchRaindropHistory, type RaindropRecord } from "./sources/raindrop";

export interface AssignInputs {
  showNotesUrls: Set<string>;
  raindropUrls: Set<string>;
  archiveUrls: Set<string>;
  titles?: Map<string, string>;
}

export interface AssignedLabel {
  url: string;
  source: PickSource;
  weight: number;
  title: string | null;
}

export function assignLabels(inputs: AssignInputs): AssignedLabel[] {
  const all = new Set<string>([
    ...inputs.showNotesUrls,
    ...inputs.raindropUrls,
    ...inputs.archiveUrls,
  ]);
  const out: AssignedLabel[] = [];
  for (const url of all) {
    let source: PickSource;
    let weight: number;
    if (inputs.showNotesUrls.has(url)) {
      source = "show_notes";
      weight = 1.0;
    } else if (inputs.raindropUrls.has(url)) {
      source = "raindrop";
      weight = 0.5;
    } else {
      source = "negative";
      weight = 1.0;
    }
    out.push({ url, source, weight, title: inputs.titles?.get(url) ?? null });
  }
  return out;
}

const RAINDROP_TAG: Record<Show, string> = { twit: "TWiT", mbw: "MBW", im: "IM" };

/**
 * End-to-end harvest for one show:
 *   1. Fetch latest episode page → show-notes URL set
 *   2. Fetch Raindrop bookmarks for the show (last N days)
 *   3. Pull RSS pool from archive.db for the harvest window
 *   4. Assign labels and write to labels.db
 */
export async function harvestShow(
  show: Show,
  labels: LabelStore,
  archive: ArchiveStore,
  opts: { now?: Date; raindropLookbackDays?: number; archiveLookbackDays?: number } = {}
): Promise<{
  episode_date: string;
  episode_number: number;
  show_notes_count: number;
  raindrop_count: number;
  archive_count: number;
  inserted: number;
  upgraded: number;
} | { error: string }> {
  const now = opts.now ?? new Date();
  const raindropLookback = opts.raindropLookbackDays ?? 14;
  const archiveLookback = opts.archiveLookbackDays ?? 14;

  const fetched = await fetchLatestShowNotes(show);
  if (!fetched) return { error: "show notes not available (parse failed or empty Links)" };

  const titles = new Map<string, string>();
  const showNotesUrls = new Set<string>();
  for (const l of fetched.links) {
    showNotesUrls.add(l.url);
    if (l.title) titles.set(l.url, l.title);
  }

  const raindropEnd = now.toISOString().slice(0, 10);
  const raindropStart = new Date(now.getTime() - raindropLookback * 86400000).toISOString().slice(0, 10);
  let raindropRecords: RaindropRecord[] = [];
  try {
    raindropRecords = fetchRaindropHistory(RAINDROP_TAG[show], raindropStart, raindropEnd);
  } catch (err) {
    console.warn(`[harvest] raindrop-history failed: ${(err as Error).message} — proceeding without weak positives`);
  }
  const raindropUrls = new Set(raindropRecords.map(r => r.url));
  for (const r of raindropRecords) {
    if (!titles.has(r.url) && r.title) titles.set(r.url, r.title);
  }

  const archiveCutoff = new Date(now.getTime() - archiveLookback * 86400000);
  const recent = archive.getStoriesInWindow(archiveCutoff, now);
  const archiveUrls = new Set<string>();
  for (const s of recent) {
    archiveUrls.add(s.url_canonical);
    if (!titles.has(s.url_canonical)) titles.set(s.url_canonical, s.title);
  }

  const assigned = assignLabels({ showNotesUrls, raindropUrls, archiveUrls, titles });
  const writes: LabeledPickInput[] = assigned.map(a => ({
    show,
    episode_date: fetched.episodeDate,
    story_url: a.url,
    story_title: a.title,
    source: a.source,
    weight: a.weight,
  }));
  const { inserted, upgraded } = labels.insertLabeledPicks(writes);

  return {
    episode_date: fetched.episodeDate,
    episode_number: fetched.episodeNumber,
    show_notes_count: showNotesUrls.size,
    raindrop_count: raindropUrls.size,
    archive_count: archiveUrls.size,
    inserted,
    upgraded,
  };
}
