import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { openDb } from "../src/db";

const TMP_DB = "/tmp/ai-briefing-test-db.sqlite";

describe("openDb", () => {
  beforeEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });
  afterEach(() => { if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

  test("creates the file and runs the given migration", () => {
    const db = openDb(TMP_DB, ["CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)"]);
    db.prepare("INSERT INTO t (v) VALUES (?)").run("hi");
    const row = db.prepare("SELECT v FROM t WHERE id = 1").get() as { v: string };
    expect(row.v).toBe("hi");
    db.close();
  });

  test("is idempotent — re-opening doesn't re-run applied migrations", () => {
    const migs = ["CREATE TABLE t (id INTEGER PRIMARY KEY)"];
    openDb(TMP_DB, migs).close();
    const db = openDb(TMP_DB, migs);   // must not throw "table t already exists"
    db.close();
  });
});
