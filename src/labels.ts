import { readFileSync } from "fs";
import { resolve } from "path";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";

export type Show = "twit" | "mbw" | "im";

export type PickSource = "archive" | "show_notes" | "raindrop" | "negative";

export interface PickRow {
  show: Show;
  episode_date: string;         // "YYYY-MM-DD"
  section_name: string | null;
  section_order: number | null;
  rank_in_section: number | null;
  story_url: string;
  story_title: string | null;
  source_file: string | null;
  weight: number;       // NEW
  source: PickSource;   // NEW
}

export interface LabeledPickInput {
  show: Show;
  episode_date: string;
  story_url: string;
  story_title: string | null;
  source: PickSource;
  weight: number;
}

const SCHEMA_002 = readFileSync(resolve(import.meta.dir, "migrations/002_labels.sql"), "utf-8");
const SCHEMA_003 = readFileSync(resolve(import.meta.dir, "migrations/003_labels_weight_source.sql"), "utf-8");

export class LabelStore {
  private db: Database;
  constructor(path: string) {
    this.db = openDb(path, [SCHEMA_002, SCHEMA_003]);
  }

  insertPicks(picks: PickRow[]): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO picks
        (show, episode_date, section_name, section_order, rank_in_section, story_url, story_title, scraped_at, source_file)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const p of picks) {
        stmt.run(p.show, p.episode_date, p.section_name, p.section_order,
          p.rank_in_section, p.story_url, p.story_title, now, p.source_file);
      }
    })();
  }

  countByShow(show: Show): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM picks WHERE show = ?").get(show) as { c: number }).c;
  }

  getRecentPicks(show: Show, limit: number): PickRow[] {
    return this.db.prepare(`
      SELECT show, episode_date, section_name, section_order, rank_in_section, story_url, story_title, source_file,
             weight, source
      FROM picks WHERE show = ?
      ORDER BY episode_date DESC, section_order ASC, rank_in_section ASC
      LIMIT ?
    `).all(show, limit) as PickRow[];
  }

  tableColumns(table: string): string[] {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.map(r => r.name);
  }

  insertLabeledPicks(picks: LabeledPickInput[]): { inserted: number; upgraded: number } {
    const stmt = this.db.prepare(`
      INSERT INTO picks (show, episode_date, story_url, story_title, source, weight, scraped_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(show, episode_date, story_url) DO UPDATE SET
        source = CASE
          WHEN excluded.source = 'show_notes' THEN 'show_notes'
          WHEN excluded.source = 'raindrop' AND picks.source IN ('archive','negative') THEN 'raindrop'
          ELSE picks.source
        END,
        weight = MAX(picks.weight, excluded.weight),
        story_title = COALESCE(picks.story_title, excluded.story_title)
    `);
    const now = new Date().toISOString();
    let inserted = 0, upgraded = 0;
    for (const p of picks) {
      const before = this.db.prepare(`SELECT source FROM picks WHERE show=? AND episode_date=? AND story_url=?`)
        .get(p.show, p.episode_date, p.story_url) as { source: string } | null;
      stmt.run(p.show, p.episode_date, p.story_url, p.story_title, p.source, p.weight, now);
      if (!before) {
        inserted++;
      } else {
        const after = this.db.prepare(`SELECT source FROM picks WHERE show=? AND episode_date=? AND story_url=?`)
          .get(p.show, p.episode_date, p.story_url) as { source: string };
        if (before.source !== after.source) upgraded++;
      }
    }
    return { inserted, upgraded };
  }

  allPicks(show: Show): PickRow[] {
    return this.db.prepare(`SELECT * FROM picks WHERE show = ? ORDER BY episode_date DESC, id`)
      .all(show) as PickRow[];
  }

  close(): void { this.db.close(); }
}
