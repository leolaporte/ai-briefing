import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

export function openDb(path: string, migrations: string[]): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = db.prepare("SELECT COUNT(*) AS c FROM _migrations").get() as { c: number };
  for (let i = applied.c; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)")
        .run(i, new Date().toISOString());
    })();
  }
  return db;
}
