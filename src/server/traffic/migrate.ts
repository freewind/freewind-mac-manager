import { existsSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

const MIGRATION_NAME = "traffic.sqlite3-to-main"

/** 将旧 traffic 库导入统一库；成功后用迁移标记保证重启幂等。 */
export const migrateTrafficDatabase = (
  databaseFile: string,
  legacyFile: string
): boolean => {
  if (
    !existsSync(legacyFile) ||
    path.resolve(databaseFile) === path.resolve(legacyFile)
  ) {
    return false
  }

  const db = new DatabaseSync(databaseFile)
  db.exec(`
    CREATE TABLE IF NOT EXISTS mac_manager_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)
  let attached = false
  try {
    const applied = db
      .prepare("SELECT 1 AS applied FROM mac_manager_migrations WHERE name = ?")
      .get(MIGRATION_NAME) as { applied: number } | undefined
    if (applied) return false

    const targetTables = db
      .prepare(
        "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name IN (?, ?, ?)"
      )
      .all("traffic_samples", "traffic_snapshots", "traffic_snapshot_entries")
    if (targetTables.length !== 3) {
      throw new Error("统一数据库缺少 traffic 表，迁移已中止")
    }

    db.prepare("ATTACH DATABASE ? AS legacy").run(legacyFile)
    attached = true
    const legacyTables = db
      .prepare(
        "SELECT name FROM legacy.sqlite_master WHERE type = 'table' AND name IN (?, ?, ?)"
      )
      .all("traffic_samples", "traffic_snapshots", "traffic_snapshot_entries")
    if (legacyTables.length !== 3) return false

    db.exec("BEGIN IMMEDIATE")
    try {
      db.exec(`
        INSERT INTO traffic_samples
          (ts, name, label, parent, command, pid, bytes_in, bytes_out)
        SELECT ts, name, label, parent, command, pid, bytes_in, bytes_out
        FROM legacy.traffic_samples;
        INSERT OR IGNORE INTO traffic_snapshots
          (id, saved_at, from_at, to_at, saved_by, bytes_in, bytes_out)
        SELECT id, saved_at, from_at, to_at, saved_by, bytes_in, bytes_out
        FROM legacy.traffic_snapshots;
        INSERT INTO traffic_snapshot_entries
          (snapshot_id, name, label, parent, command, ports, pids, bytes_in, bytes_out)
        SELECT snapshot_id, name, label, parent, command, ports, pids, bytes_in, bytes_out
        FROM legacy.traffic_snapshot_entries;
        INSERT INTO mac_manager_migrations (name, applied_at)
        VALUES ('${MIGRATION_NAME}', unixepoch());
      `)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
    return true
  } finally {
    if (attached) db.exec("DETACH DATABASE legacy")
    db.close()
  }
}
