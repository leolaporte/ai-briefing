import { spawnSync } from "child_process";

export interface DawarichOpts {
  maxAgeSec: number;
  container?: string;
  db?: string;
  user?: string;
}

export interface DawarichPoint {
  lat: number;
  lon: number;
  timestamp: number;
  ageSec: number;
}

export type PsqlRunner = (sql: string) => string | null;

const LATEST_POINT_SQL =
  "SELECT ST_Y(lonlat::geometry), ST_X(lonlat::geometry), timestamp " +
  "FROM points ORDER BY timestamp DESC LIMIT 1;";

function defaultRunner(
  container: string,
  db: string,
  user: string
): PsqlRunner {
  return (sql: string) => {
    const result = spawnSync(
      "docker",
      ["exec", container, "psql", "-U", user, "-d", db, "-tAc", sql],
      { encoding: "utf-8", timeout: 10000 }
    );
    if (result.status !== 0) return null;
    return (result.stdout ?? "").trim();
  };
}

export function parseLatestPoint(row: string): { lat: number; lon: number; timestamp: number } | null {
  if (!row || !row.trim()) return null;
  const firstLine = row.split("\n")[0].trim();
  const parts = firstLine.split("|");
  if (parts.length < 3) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  const timestamp = parseInt(parts[2], 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timestamp)) {
    return null;
  }
  return { lat, lon, timestamp };
}

export async function fetchLatestLocation(
  opts: DawarichOpts,
  runner?: PsqlRunner
): Promise<DawarichPoint | null> {
  const run =
    runner ??
    defaultRunner(
      opts.container ?? "dawarich_db",
      opts.db ?? "dawarich_production",
      opts.user ?? "dawarich"
    );

  let raw: string | null;
  try {
    raw = run(LATEST_POINT_SQL);
  } catch {
    return null;
  }
  if (raw === null) return null;

  const parsed = parseLatestPoint(raw);
  if (!parsed) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - parsed.timestamp;
  if (ageSec > opts.maxAgeSec) return null;

  return { ...parsed, ageSec };
}
