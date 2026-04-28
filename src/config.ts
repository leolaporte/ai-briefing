// src/config.ts
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import yaml from "js-yaml";
import type { Config } from "./types";

function expandTilde(s: string): string {
  if (s.startsWith("~")) return s.replace("~", process.env.HOME ?? "/home/leo");
  return s;
}

export function loadConfig(configPath?: string): Config {
  const path = configPath ?? resolve(dirname(import.meta.dir), "config.yaml");
  const raw = readFileSync(path, "utf-8");
  const config = yaml.load(raw) as Config;
  config.output.path = expandTilde(config.output.path);
  config.storage.archive_db = expandTilde(config.storage.archive_db);
  config.storage.labels_db = expandTilde(config.storage.labels_db);
  if (config.rss.opml_file) config.rss.opml_file = expandTilde(config.rss.opml_file);
  if (config.classifier?.model_dir) config.classifier.model_dir = expandTilde(config.classifier.model_dir);
  if (config.classifier?.eval_dir) config.classifier.eval_dir = expandTilde(config.classifier.eval_dir);
  return config;
}
