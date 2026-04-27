// bin/seed.ts
// One-shot seeding script: harvest each show then train its classifier.
// Idempotent — safe to re-run; harvest deduplicates via INSERT OR IGNORE.
import { spawnSync } from "child_process";
import { join } from "path";
import { loadConfig } from "../src/config";
import { LabelStore } from "../src/labels";
import { ArchiveStore } from "../src/archive";
import { harvestShow } from "../src/harvest";
import type { Show } from "../src/labels";

const SHOWS: Show[] = ["twit", "mbw", "im"];
const TRAIN_PY = join(import.meta.dir, "..", "bin", "train.py");

async function main() {
  const config = loadConfig();
  // loadConfig already expands ~ for labels_db and model_dir
  const labels = new LabelStore(config.storage.labels_db);
  const archive = new ArchiveStore(config.storage.archive_db);
  try {
    for (const show of SHOWS) {
      console.log(`\n=== seeding ${show} ===`);

      // Step 1: harvest
      const result = await harvestShow(show, labels, archive);
      if ("error" in result) {
        console.error(`[seed:${show}] harvest failed: ${result.error}`);
        continue;
      }
      console.log(`[seed:${show}] harvest:`, JSON.stringify(result));

      // Step 2: train
      const train = spawnSync("uv", [
        "run", "python", TRAIN_PY,
        "--train", "--show", show,
        "--labels-db", config.storage.labels_db,
        "--model-dir", config.classifier.model_dir,
        "--eval-dir", config.classifier.eval_dir,
      ], { encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] });

      if (train.status !== 0) {
        console.error(`[seed:${show}] train exit ${train.status}`);
        continue;
      }
      const summary = (train.stdout || "").trim().split("\n").pop() || "{}";
      console.log(`[seed:${show}] train:`, summary);
    }
  } finally {
    archive.close();
    labels.close();
  }
}

main().catch(err => {
  console.error("[seed] fatal:", err);
  process.exit(1);
});
