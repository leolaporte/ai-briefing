import type { StoryRow } from "./archive";

const TRACKING_PARAM_RE = /^(utm_|fbclid|gclid|mc_|_hsenc|_hsmi|ref|ref_src)/i;

export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.host = u.host.toLowerCase();
    const keep: [string, string][] = [];
    for (const [k, v] of u.searchParams) {
      if (!TRACKING_PARAM_RE.test(k)) keep.push([k, v]);
    }
    u.search = "";
    for (const [k, v] of keep) u.searchParams.append(k, v);
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}

function trigrams(s: string): Set<string> {
  const norm = s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const padded = `  ${norm}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

export function trigramJaccard(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function clusterStories(stories: StoryRow[], threshold: number): StoryRow[][] {
  const clusters: StoryRow[][] = [];
  for (const s of stories) {
    let placed = false;
    for (const c of clusters) {
      if (trigramJaccard(s.title, c[0].title) >= threshold) {
        c.push(s);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([s]);
  }
  return clusters;
}
