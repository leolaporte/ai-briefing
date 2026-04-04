import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import yaml from "js-yaml";
import type { Config } from "./types";

export function loadConfig(configPath?: string): Config {
  const path = configPath ?? resolve(dirname(import.meta.dir), "config.yaml");
  const raw = readFileSync(path, "utf-8");
  const config = yaml.load(raw) as Config;

  // Resolve ~ to home directory
  if (config.output.path.startsWith("~")) {
    config.output.path = config.output.path.replace("~", process.env.HOME ?? "/home/leo");
  }

  return config;
}
