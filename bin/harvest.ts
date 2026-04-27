// bin/harvest.ts
import { loadConfig } from "../src/config";
import { LabelStore } from "../src/labels";
import { ArchiveStore } from "../src/archive";
import { harvestShow } from "../src/harvest";

const SHOWS = ["twit", "mbw", "im"] as const;

async function main() {
  const show = process.argv[2];
  if (!SHOWS.includes(show as any)) {
    console.error(`usage: bun bin/harvest.ts <${SHOWS.join("|")}>`);
    process.exit(2);
  }
  const config = loadConfig();
  const labels = new LabelStore(config.storage.labels_db);
  const archive = new ArchiveStore(config.storage.archive_db);
  try {
    const result = await harvestShow(show as any, labels, archive);
    console.log(`[harvest:${show}]`, JSON.stringify(result));
  } finally {
    archive.close();
    labels.close();
  }
}

main().catch(err => {
  console.error("[harvest] fatal:", err);
  process.exit(1);
});
