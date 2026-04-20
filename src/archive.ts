import { readFileSync } from "fs";
import { resolve } from "path";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";

export interface StoryRow {
  url_canonical: string;
  url_original: string | null;
  title: string;
  source_name: string;
  source_domain: string;
  published_at: Date;
  first_para: string | null;
}

const SCHEMA = readFileSync(resolve(import.meta.dir, "migrations/001_archive.sql"), "utf-8");

export class ArchiveStore {
  private db: Database;
  constructor(path: string) {
    this.db = openDb(path, [SCHEMA]);
  }
  insertStory(s: StoryRow): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO stories
        (url_canonical, url_original, title, source_name, source_domain, published_at, first_para, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s.url_canonical, s.url_original, s.title, s.source_name, s.source_domain,
      s.published_at.toISOString(), s.first_para, new Date().toISOString()
    );
  }
  countAll(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM stories").get() as { c: number }).c;
  }
  getStoriesInWindow(from: Date, to: Date): StoryRow[] {
    return this.db.prepare(`
      SELECT url_canonical, url_original, title, source_name, source_domain, published_at, first_para
      FROM stories WHERE published_at BETWEEN ? AND ?
      ORDER BY published_at DESC
    `).all(from.toISOString(), to.toISOString()).map((r: any) => ({
      ...r,
      published_at: new Date(r.published_at),
    })) as StoryRow[];
  }
  close(): void { this.db.close(); }
}
