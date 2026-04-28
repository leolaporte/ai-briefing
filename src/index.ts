import { spawnSync } from "child_process";
import { join } from "path";
import { loadConfig } from "./config";
import { fetchRss } from "./sources/rss";
import { ArchiveStore } from "./archive";
import { LabelStore } from "./labels";
import type { Show } from "./labels";
import { canonicalizeUrl, clusterStories } from "./cluster";
import { scoreCluster } from "./scorer";
import { splitScored, type ScoredCluster } from "./selection";
import { scoreClustersForShow, shortlistByScore, expandHome } from "./classifier";
import { writeBriefing } from "./writer";
import { ensureBingBanner } from "./banner";
import { createOrUpdateDailyNote } from "./daily-note";
import { fetchLatestLocation } from "./dawarich";

const DEFAULT_LOCATION = {
  coordinates: ["38.23242", "-122.63665"] as [string, string],
  name: "Petaluma, California",
  timezone: "America/Los_Angeles",
};

const DAWARICH_MAX_AGE_SEC = 24 * 3600;
const WEATHER_SCRIPT = join(import.meta.dir, "..", "bin", "weather.sh");

async function resolveLocation(): Promise<{
  lat: string;
  lon: string;
  name: string;
  coordsForFrontmatter: [string, string];
}> {
  const live = await fetchLatestLocation({ maxAgeSec: DAWARICH_MAX_AGE_SEC });
  if (live) {
    const lat = live.lat.toFixed(5);
    const lon = live.lon.toFixed(5);
    console.log(
      `[location] dawarich point ${Math.round(live.ageSec / 60)}min old: ${lat}, ${lon}`
    );
    return {
      lat,
      lon,
      name: "Current location",
      coordsForFrontmatter: [lat, lon],
    };
  }
  console.log(`[location] using default (${DEFAULT_LOCATION.name})`);
  return {
    lat: DEFAULT_LOCATION.coordinates[0],
    lon: DEFAULT_LOCATION.coordinates[1],
    name: DEFAULT_LOCATION.name,
    coordsForFrontmatter: DEFAULT_LOCATION.coordinates,
  };
}

function fetchWeatherLine(lat: string, lon: string, name: string): string | null {
  const result = spawnSync(
    WEATHER_SCRIPT,
    [lat, lon, name, DEFAULT_LOCATION.timezone],
    { encoding: "utf-8", timeout: 15000 }
  );
  if (result.status !== 0) {
    console.warn(`[daily-note] weather.sh failed: ${result.stderr?.trim()}`);
    return null;
  }
  const line = (result.stdout ?? "").trim();
  return line.length > 0 ? line : null;
}

async function main() {
  const startTime = Date.now();
  console.log("[tech-briefing] starting...");
  const config = loadConfig();

  const labels = new LabelStore(config.storage.labels_db);
  const archive = new ArchiveStore(config.storage.archive_db);
  let outPath: string | undefined;
  try {
    // 1. Fetch from OPML RSS feeds
    const rssStories = await fetchRss(config.rss).catch((err) => {
      console.error("[tech-briefing] rss failed:", err);
      return [];
    });
    console.log(`[tech-briefing] fetched: rss=${rssStories.length}`);

    // 2. Archive every fetched story
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
      return;
    }

    // 4. Cluster by topic
    const clusters = clusterStories(recent, config.pipeline.cluster_threshold);
    console.log(`[tech-briefing] ${clusters.length} topic clusters`);

    // 4b. Per-show classifier pre-filter
    let toScore: number[] = clusters.map((_, i) => i);
    if (config.classifier.enabled) {
      const showsToFilter: Show[] = ["twit", "mbw", "im"];
      const shortlist = new Set<number>();
      const evalDir = expandHome(config.classifier.eval_dir);
      let allShowsFell = true;
      for (const show of showsToFilter) {
        const scores = scoreClustersForShow(clusters, show, config.classifier, evalDir);
        if (scores === null) {
          // Fallback: missing model or low recall — include all clusters for this show
          for (let i = 0; i < clusters.length; i++) shortlist.add(i);
        } else {
          allShowsFell = false;
          for (const idx of shortlistByScore(scores, config.classifier.shortlist_size)) {
            shortlist.add(idx);
          }
        }
      }
      toScore = [...shortlist].sort((a, b) => a - b);
      console.log(
        `[tech-briefing] classifier shortlist: ${toScore.length}/${clusters.length} clusters` +
        (allShowsFell ? " (all shows in fallback mode)" : "")
      );
    }

    // 5. Score each cluster via Claude Haiku (only the shortlist)
    const scored: ScoredCluster[] = [];
    for (const idx of toScore) {
      const cluster = clusters[idx];
      const scoring = await scoreCluster(cluster, labels, {
        model: config.claude.model,
        max_tokens: config.claude.max_tokens,
        few_shot_k: config.claude.few_shot_k,
      });
      if (scoring) scored.push({ cluster, scoring });
    }
    console.log(`[tech-briefing] scored ${scored.length}/${toScore.length} clusters via Haiku`);

    // 6. Split into per-show buckets + other-notable
    const split = splitScored(scored, {
      topN: config.pipeline.top_n_per_show,
      otherThreshold: config.pipeline.other_threshold,
    });
    console.log(
      `[tech-briefing] selection: twit=${split.twit.length} mbw=${split.mbw.length} im=${split.im.length} other=${split.other.length}`
    );

    // 7. Write briefing to Obsidian
    outPath = writeBriefing(split, config.output.path, now, recent.length);

    // 8. Create or update the daily note: banner + weather + tech briefing link
    const vaultPath = config.output.path.replace(/\/AI\/News\/?$/, "");
    const banner = await ensureBingBanner(vaultPath, now);
    const location = await resolveLocation();
    const weatherLine = fetchWeatherLine(location.lat, location.lon, location.name);
    const notePath = createOrUpdateDailyNote(vaultPath, {
      date: now,
      coordinates: location.coordsForFrontmatter,
      weatherLine,
      bannerRef: banner?.ref ?? null,
    });
    console.log(
      `[daily-note] ${notePath} (banner=${banner ? "ok" : "skip"} weather=${weatherLine ? "ok" : "skip"})`
    );
  } finally {
    archive.close();
    labels.close();
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[tech-briefing] done in ${elapsed}s — ${outPath}`);
}

main().catch((err) => {
  console.error("[tech-briefing] fatal:", err);
  process.exit(1);
});
