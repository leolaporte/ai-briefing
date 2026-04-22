import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { renderNewDailyNote, createOrUpdateDailyNote, type DailyNoteOpts } from "../src/daily-note";

const WED = new Date("2026-04-22T10:00:00Z");
const OPTS: DailyNoteOpts = {
  date: WED,
  coordinates: ["38.23242", "-122.63665"],
  weatherLine: "🌍 Petaluma, California: 🌧️ ⬆️ 61°F | ⬇️ 49°F | 🌅 06:24 AM | 🌇 07:53 PM | 🌒",
  bannerRef: "![[Zobs/pixel-banner-images/2026-04-22-TartuEstonia.jpg]]",
};

describe("renderNewDailyNote", () => {
  test("emits frontmatter with coordinates, tags, banner, created date", () => {
    const md = renderNewDailyNote(OPTS);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain('coordinates:\n  - "38.23242"\n  - "-122.63665"');
    expect(md).toContain('tags:\n  - "#Dailies"');
    expect(md).toContain("created: 2026-04-22");
    expect(md).toContain('banner: "![[Zobs/pixel-banner-images/2026-04-22-TartuEstonia.jpg]]"');
  });

  test("weather line appears immediately after weekday heading", () => {
    const md = renderNewDailyNote(OPTS);
    const headingIdx = md.indexOf("### 📝 Wednesday's Notes");
    expect(headingIdx).toBeGreaterThan(0);
    const weatherIdx = md.indexOf("🌍 Petaluma");
    expect(weatherIdx).toBeGreaterThan(headingIdx);
    const between = md.slice(headingIdx + "### 📝 Wednesday's Notes".length, weatherIdx);
    expect(between).toBe("\n");
  });

  test("tech briefing link sits above #### Exercise", () => {
    const md = renderNewDailyNote(OPTS);
    const linkIdx = md.indexOf("[[AI/News/2026/04/2026-04-22|📰 Tech Briefing]]");
    const exerciseIdx = md.indexOf("#### Exercise");
    expect(linkIdx).toBeGreaterThan(0);
    expect(exerciseIdx).toBeGreaterThan(linkIdx);
  });

  test("includes template structure sections", () => {
    const md = renderNewDailyNote(OPTS);
    expect(md).toContain("#### Exercise");
    expect(md).toContain("#### Meals");
    expect(md).toContain("#### Voice Notes");
    expect(md).toContain("#### Listening");
    expect(md).toContain("#### Rose, thorn, bud");
    expect(md).toContain("#### 🙏 Gratitude");
    expect(md).toContain("[Today in Wikipedia](https://en.wikipedia.org/wiki/Main_Page)");
    expect(md).toContain("#### ☑️ Tasks for Today");
    expect(md).toContain("```tasks");
  });

  test("does NOT include a quote callout (Templater owns that)", () => {
    const md = renderNewDailyNote(OPTS);
    expect(md).not.toContain("[!quote]");
  });

  test("omits banner field when bannerRef is null", () => {
    const md = renderNewDailyNote({ ...OPTS, bannerRef: null });
    expect(md).not.toContain("banner:");
  });

  test("omits weather line when weatherLine is null", () => {
    const md = renderNewDailyNote({ ...OPTS, weatherLine: null });
    expect(md).not.toContain("🌍");
  });
});

describe("createOrUpdateDailyNote", () => {
  let vault: string;
  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "vault-"));
  });
  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  test("creates a daily note when the file is missing", () => {
    createOrUpdateDailyNote(vault, OPTS);
    const path = join(vault, "Daily Notes/2026/04/2026-04-22.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("🌍 Petaluma");
    expect(content).toContain("📰 Tech Briefing");
    expect(content).toContain("banner:");
    expect(content).toContain("#### Exercise");
  });

  test("is idempotent: running twice produces the same file content", () => {
    createOrUpdateDailyNote(vault, OPTS);
    const path = join(vault, "Daily Notes/2026/04/2026-04-22.md");
    const first = readFileSync(path, "utf-8");
    createOrUpdateDailyNote(vault, OPTS);
    const second = readFileSync(path, "utf-8");
    expect(second).toBe(first);
  });

  test("updates an existing Templater-created note: adds banner, weather, tech link non-destructively", () => {
    const dir = join(vault, "Daily Notes/2026/04");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "2026-04-22.md");
    const existing = `---
tags:
  - "#Dailies"
created: 2026-04-22
modified:
type:
status:
aliases:
summary: ""
related: []

---
> [!quote] Some quote text
> — Someone
---
### 📝 Wednesday's Notes

9:00AM: I woke up early and wrote this.

#### Exercise

#### Meals
`;
    writeFileSync(path, existing, "utf-8");
    createOrUpdateDailyNote(vault, OPTS);
    const updated = readFileSync(path, "utf-8");
    expect(updated).toContain('banner: "![[Zobs/pixel-banner-images/2026-04-22-TartuEstonia.jpg]]"');
    expect(updated).toContain("🌍 Petaluma");
    expect(updated).toContain("[[AI/News/2026/04/2026-04-22|📰 Tech Briefing]]");
    expect(updated).toContain("9:00AM: I woke up early and wrote this.");
    expect(updated).toContain("[!quote] Some quote text");
  });

  test("does not duplicate extras when run twice on an existing note", () => {
    createOrUpdateDailyNote(vault, OPTS);
    createOrUpdateDailyNote(vault, OPTS);
    const path = join(vault, "Daily Notes/2026/04/2026-04-22.md");
    const content = readFileSync(path, "utf-8");
    expect((content.match(/^banner:/gm) || []).length).toBe(1);
    expect((content.match(/🌍 Petaluma/g) || []).length).toBe(1);
    expect((content.match(/📰 Tech Briefing/g) || []).length).toBe(1);
  });
});
