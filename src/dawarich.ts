export interface DawarichOpts {
  url: string;
  apiKey: string;
  maxAgeSec: number;
}

export interface DawarichPoint {
  lat: number;
  lon: number;
  timestamp: number;
  ageSec: number;
}

interface RawPoint {
  latitude?: string | number;
  longitude?: string | number;
  timestamp?: number;
}

export async function fetchLatestLocation(
  opts: DawarichOpts,
  fetchFn: typeof fetch = fetch
): Promise<DawarichPoint | null> {
  if (!opts.apiKey) return null;

  const url = `${opts.url.replace(/\/$/, "")}/api/v1/points?per_page=1&order=desc`;

  let points: RawPoint[];
  try {
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });
    if (!res.ok) return null;
    points = (await res.json()) as RawPoint[];
  } catch {
    return null;
  }

  if (!Array.isArray(points) || points.length === 0) return null;

  const p = points[0];
  if (!p.timestamp || p.latitude === undefined || p.longitude === undefined) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - p.timestamp;
  if (ageSec > opts.maxAgeSec) return null;

  const lat = typeof p.latitude === "number" ? p.latitude : parseFloat(p.latitude);
  const lon = typeof p.longitude === "number" ? p.longitude : parseFloat(p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lon, timestamp: p.timestamp, ageSec };
}
