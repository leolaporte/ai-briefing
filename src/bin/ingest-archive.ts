#!/usr/bin/env bun
import { LabelStore } from "../labels";
import { ingestArchives } from "../twitshow/ingest";

const LABELS_DB = `${process.env.HOME}/.local/share/ai-briefing/labels.db`;
const ROOT = process.argv[2] ?? `${process.env.HOME}/Documents`;

const store = new LabelStore(LABELS_DB);
const res = await ingestArchives(ROOT, store);
console.log(
  `[ingest] parsed=${res.files_parsed} skipped=${res.files_skipped} inserted=${res.picks_inserted}`
);
store.close();
