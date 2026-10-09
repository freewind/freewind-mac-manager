import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { migrateTrafficDatabase } from "./migrate"
import { TrafficStore } from "./store"

const roots: string[] = []

const createLegacyDatabase = (file: string): void => {
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE traffic_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      parent TEXT NOT NULL,
      command TEXT NOT NULL,
      pid INTEGER NOT NULL,
      bytes_in INTEGER NOT NULL,
      bytes_out INTEGER NOT NULL
    );
    CREATE TABLE traffic_snapshots (
      id TEXT PRIMARY KEY,
      saved_at INTEGER NOT NULL,
      from_at INTEGER NOT NULL,
      to_at INTEGER NOT NULL,
      saved_by TEXT NOT NULL,
      bytes_in INTEGER NOT NULL,
      bytes_out INTEGER NOT NULL
    );
    CREATE TABLE traffic_snapshot_entries (
      snapshot_id TEXT NOT NULL,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      parent TEXT NOT NULL,
      command TEXT NOT NULL,
      ports TEXT NOT NULL,
      pids TEXT NOT NULL,
      bytes_in INTEGER NOT NULL,
      bytes_out INTEGER NOT NULL
    );
  `)
  db.prepare(
    "INSERT INTO traffic_samples (ts, name, label, parent, command, pid, bytes_in, bytes_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(1, "node", "app", "user", "node app", 42, 10, 20)
  db.close()
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe("traffic database migration", () => {
  it("imports legacy rows once and preserves them", () => {
    const root = mkdtempSync(path.join("/tmp", "mac-manager-migration-"))
    roots.push(root)
    const target = path.join(root, "main.sqlite3")
    const legacy = path.join(root, "traffic.sqlite3")
    new TrafficStore(target).close()
    createLegacyDatabase(legacy)

    expect(migrateTrafficDatabase(target, legacy)).toBe(true)
    expect(migrateTrafficDatabase(target, legacy)).toBe(false)

    const db = new DatabaseSync(target)
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM traffic_samples").get()
    ).toEqual({ count: 1 })
    db.close()
  })

  it("rolls back partial writes when the target schema is incomplete", () => {
    const root = mkdtempSync(path.join("/tmp", "mac-manager-migration-"))
    roots.push(root)
    const target = path.join(root, "main.sqlite3")
    const legacy = path.join(root, "traffic.sqlite3")
    const db = new DatabaseSync(target)
    db.exec(`
      CREATE TABLE traffic_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, name TEXT NOT NULL,
        label TEXT NOT NULL, parent TEXT NOT NULL, command TEXT NOT NULL,
        pid INTEGER NOT NULL, bytes_in INTEGER NOT NULL, bytes_out INTEGER NOT NULL
      );
      CREATE TABLE traffic_snapshots (
        id TEXT PRIMARY KEY, saved_at INTEGER NOT NULL, from_at INTEGER NOT NULL,
        to_at INTEGER NOT NULL, saved_by TEXT NOT NULL, bytes_in INTEGER NOT NULL,
        bytes_out INTEGER NOT NULL
      );
    `)
    db.close()
    createLegacyDatabase(legacy)

    expect(() => migrateTrafficDatabase(target, legacy)).toThrow()
    const check = new DatabaseSync(target)
    expect(
      check.prepare("SELECT COUNT(*) AS count FROM traffic_samples").get()
    ).toEqual({ count: 0 })
    check.close()
  })
})
