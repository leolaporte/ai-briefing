import { loadConfig } from "./config";
import { fetchRss } from "./sources/rss";
import { ArchiveStore } from "./archive";
import { LabelStore } from "./labels";
import { ingestArchives } from "./twitshow/ingest";
import { canonicalizeUrl, clusterStories } from "./cluster";
import { scoreCluster } from "./scorer";
import { splitScored, type ScoredCluster } from "./selection";
import { writeBriefing, linkInDailyNote } from "./writer";

async function main() {
  const startTime = Date.now();
  console.log("[tech-briefing] starting...");
  const config = loadConfig();

  // 0. Refresh labels from local archive folders
  const labels = new LabelStore(config.storage.labels_db);
  const ingest = await ingestArchives(config.archive.root, labels);
  console.log(
    `[tech-briefing] archive ingest: parsed=${ingest.files_parsed} skipped=${ingest.files_skipped} new_picks=${ingest.picks_inserted}`
  );

  // 1. Fetch from OPML RSS feeds
  const rssStories = await fetchRss(config.rss).catch((err) => {
    console.error("[tech-briefing] rss failed:", err);
    return [];
  });
  console.log(`[tech-briefing] fetched: rss=${rssStories.length}`);

  // 2. Archive every fetched story
  const archive = new ArchiveStore(config.storage.archive_db);
  for (const s of rssStories) {
    try {
      const url_canonical = canonicalizeUrl(s.url);
      const url_host = new URL(url_canonical).host;
      archive.insertStory({
        url_canonical, url_original: null,
        title: s.title, source_name: s.sourceName,
        source_domain: url_host, published_at: s.publishedAt,
        first_para: s.summary ?? null,
      });
    } catch { /* skip malformed URLs */ }
  }

  // 3. Filter to past 24h
  const now = new Date();
  const cutoff = new Date(now.getTime() - config.pipeline.window_hours * 3600 * 1000);
  const recent = archive.getStoriesInWindow(cutoff, now);
  console.log(`[tech-briefing] ${recent.length} stories in past ${config.pipeline.window_hours}h`);

  if (recent.length === 0) {
    console.error("[tech-briefing] no recent stories, exiting without write");
    archive.close();
    process.exit(0);
  }

  // 4. Cluster by topic
  const clusters = clusterStories(recent, config.pipeline.cluster_threshold);
  console.log(`[tech-briefing] ${clusters.length} topic clusters`);

  // 5. Score each cluster via Claude Haiku
  const scored: ScoredCluster[] = [];
  for (const cluster of clusters) {
    const scoring = await scoreCluster(cluster, labels, {
      model: config.claude.model,
      max_tokens: config.claude.max_tokens,
      few_shot_k: config.claude.few_shot_k,
    });
    if (scoring) scored.push({ cluster, scoring });
  }
  console.log(`[tech-briefing] scored ${scored.length}/${clusters.length} clusters`);

  // 6. Split into per-show buckets + other-notable
  const split = splitScored(scored, {
    topN: config.pipeline.top_n_per_show,
    otherThreshold: config.pipeline.other_threshold,
  });
  console.log(
    `[tech-briefing] selection: twit=${split.twit.length} mbw=${split.mbw.length} im=${split.im.length} other=${split.other.length}`
  );

  // 7. Write briefing to Obsidian
  const outPath = writeBriefing(split, config.output.path, now, recent.length);

  // 8. Link in daily note
  const vaultPath = config.output.path.replace(/\/AI\/News\/?$/, "");
  await linkInDailyNote(vaultPath, now);

  archive.close();
  labels.close();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[tech-briefing] done in ${elapsed}s — ${outPath}`);
}

main().catch((err) => {
  console.error("[tech-briefing] fatal:", err);
  process.exit(1);
});
