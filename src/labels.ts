import { readFileSync } from "fs";
import { resolve } from "path";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";

export type Show = "twit" | "mbw" | "im";

export interface PickRow {
  show: Show;
  episode_date: string;         // "YYYY-MM-DD"
  section_name: string | null;
  section_order: number | null;
  rank_in_section: number | null;
  story_url: string;
  story_title: string | null;
  source_file: string | null;
}

const SCHEMA = readFileSync(resolve(import.meta.dir, "migrations/002_labels.sql"), "utf-8");

export class LabelStore {
  private db: Database;
  constructor(path: string) {
    this.db = openDb(path, [SCHEMA]);
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
      SELECT show, episode_date, section_name, section_order, rank_in_section, story_url, story_title, source_file
      FROM picks WHERE show = ?
      ORDER BY episode_date DESC, section_order ASC, rank_in_section ASC
      LIMIT ?
    `).all(show, limit) as PickRow[];
  }
  close(): void { this.db.close(); }
}
