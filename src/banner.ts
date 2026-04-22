import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

export interface BannerResult {
  ref: string;
  path: string;
}

const BING_API =
  "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US";
const BING_ORIGIN = "https://www.bing.com";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function extractName(urlbase: unknown): string {
  if (typeof urlbase !== "string") return "bing-daily";
  const m = urlbase.match(/OHR\.([^_]+)/);
  return m ? m[1] : "bing-daily";
}

function findExistingBannerForDate(dir: string, date: Date): string | null {
  if (!existsSync(dir)) return null;
  const prefix = `${dateStr(date)}-`;
  try {
    const entries = readdirSync(dir);
    const match = entries.find(
      (f) => f.startsWith(prefix) && f.toLowerCase().endsWith(".jpg")
    );
    return match ?? null;
  } catch {
    return null;
  }
}

export async function ensureBingBanner(
  vaultPath: string,
  date: Date,
  fetchFn: typeof fetch = fetch
): Promise<BannerResult | null> {
  const dir = join(vaultPath, "Zobs/pixel-banner-images");

  const existingName = findExistingBannerForDate(dir, date);
  if (existingName) {
    return {
      ref: `![[Zobs/pixel-banner-images/${existingName}]]`,
      path: join(dir, existingName),
    };
  }

  let name: string;
  let imageUrl: string;
  try {
    const apiRes = await fetchFn(BING_API);
    if (!apiRes.ok) return null;
    const json = (await apiRes.json()) as {
      images?: Array<{ url?: string; urlbase?: string }>;
    };
    const img = json.images?.[0];
    if (!img || !img.url) return null;
    name = extractName(img.urlbase);
    imageUrl = img.url.startsWith("http") ? img.url : `${BING_ORIGIN}${img.url}`;
  } catch {
    return null;
  }

  const filename = `${dateStr(date)}-${name}.jpg`;
  const absPath = join(dir, filename);
  const ref = `![[Zobs/pixel-banner-images/${filename}]]`;

  if (existsSync(absPath)) {
    return { ref, path: absPath };
  }

  try {
    const imgRes = await fetchFn(imageUrl);
    if (!imgRes.ok) return null;
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    mkdirSync(dir, { recursive: true });
    writeFileSync(absPath, buf);
    return { ref, path: absPath };
  } catch {
    return null;
  }
}
