import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

export type SampleRow = {
  ts: number
  name: string
  label: string
  parent: string
  command: string
  pid: number
  bytesIn: number
  bytesOut: number
}

export type SnapshotRow = {
  id: string
  savedAt: number
  fromAt: number
  toAt: number
  savedBy: "scheduled" | "manual"
  bytesIn: number
  bytesOut: number
}

export type SnapshotEntryRow = {
  snapshotId: string
  name: string
  label: string
  parent: string
  command: string
  ports: number[]
  pids: number[]
  bytesIn: number
  bytesOut: number
}

type RawEntryRow = {
  snapshot_id: string
  name: string
  label: string
  parent: string
  command: string
  ports: string
  pids: string
  bytes_in: number
  bytes_out: number
}

/**
 * 流量采样与快照的存储（node:sqlite，无第三方依赖）。
 *
 * - `traffic_samples`：每次采样写入的增量明细，是快照的唯一数据来源
 * - `traffic_snapshots` / `traffic_snapshot_entries`：增量快照及其进程明细
 */
export class TrafficStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true })
    // 采样在父进程、快照重算在后台执行器：两边可能同时写，需要忙等超时。
    this.db = new DatabaseSync(file, { timeout: 5000 })
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = NORMAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traffic_samples (
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
      CREATE INDEX IF NOT EXISTS idx_traffic_samples_ts ON traffic_samples (ts);

      CREATE TABLE IF NOT EXISTS traffic_snapshots (
        id TEXT PRIMARY KEY,
        saved_at INTEGER NOT NULL,
        from_at INTEGER NOT NULL,
        to_at INTEGER NOT NULL,
        saved_by TEXT NOT NULL,
        bytes_in INTEGER NOT NULL,
        bytes_out INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_traffic_snapshots_saved_at ON traffic_snapshots (saved_at);

      CREATE TABLE IF NOT EXISTS traffic_snapshot_entries (
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
      CREATE INDEX IF NOT EXISTS idx_traffic_entries_snapshot ON traffic_snapshot_entries (snapshot_id);
    `)
  }

  close(): void {
    this.db.close()
  }

  /** 同步组合写入持有整次操作的事务，内部单项写入使用保存点。 */
  transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = run()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  insertSamples(rows: SampleRow[]): void {
    if (rows.length === 0) {
      return
    }

    const statement = this.db.prepare(
      `INSERT INTO traffic_samples (ts, name, label, parent, command, pid, bytes_in, bytes_out)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )

    this.db.exec("BEGIN IMMEDIATE")
    try {
      for (const row of rows) {
        statement.run(
          row.ts,
          row.name,
          row.label,
          row.parent,
          row.command,
          row.pid,
          row.bytesIn,
          row.bytesOut
        )
      }
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  latestSampleTimestamp(): number | null {
    const row = this.db
      .prepare("SELECT MAX(ts) AS ts FROM traffic_samples")
      .get() as { ts: number | null } | undefined
    return row?.ts ?? null
  }

  latestSampleDelta(): { bytesIn: number; bytesOut: number } {
    const ts = this.latestSampleTimestamp()
    if (ts === null) {
      return { bytesIn: 0, bytesOut: 0 }
    }
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(bytes_in), 0) AS bytes_in, COALESCE(SUM(bytes_out), 0) AS bytes_out FROM traffic_samples WHERE ts = ?"
      )
      .get(ts) as { bytes_in: number; bytes_out: number }
    return { bytesIn: row.bytes_in, bytesOut: row.bytes_out }
  }

  /** 区间 [from, to) 内的采样明细。 */
  listSamples(from: number, to: number): SampleRow[] {
    const rows = this.db
      .prepare(
        `SELECT ts, name, label, parent, command, pid, bytes_in, bytes_out
         FROM traffic_samples WHERE ts >= ? AND ts < ? ORDER BY ts`
      )
      .all(from, to) as {
      ts: number
      name: string
      label: string
      parent: string
      command: string
      pid: number
      bytes_in: number
      bytes_out: number
    }[]

    return rows.map((row) => ({
      ts: row.ts,
      name: row.name,
      label: row.label,
      parent: row.parent,
      command: row.command,
      pid: row.pid,
      bytesIn: row.bytes_in,
      bytesOut: row.bytes_out,
    }))
  }

  insertSnapshot(
    row: SnapshotRow,
    entries: Omit<SnapshotEntryRow, "snapshotId">[]
  ): void {
    this.writeSnapshot(() => {
      this.db
        .prepare(
          `INSERT INTO traffic_snapshots (id, saved_at, from_at, to_at, saved_by, bytes_in, bytes_out)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.savedAt,
          row.fromAt,
          row.toAt,
          row.savedBy,
          row.bytesIn,
          row.bytesOut
        )
      this.writeEntries(row.id, entries)
    })
  }

  replaceSnapshot(
    row: SnapshotRow,
    entries: Omit<SnapshotEntryRow, "snapshotId">[]
  ): void {
    this.writeSnapshot(() => {
      this.db
        .prepare(
          `UPDATE traffic_snapshots SET saved_at = ?, from_at = ?, to_at = ?, saved_by = ?, bytes_in = ?, bytes_out = ?
           WHERE id = ?`
        )
        .run(
          row.savedAt,
          row.fromAt,
          row.toAt,
          row.savedBy,
          row.bytesIn,
          row.bytesOut,
          row.id
        )
      this.db
        .prepare("DELETE FROM traffic_snapshot_entries WHERE snapshot_id = ?")
        .run(row.id)
      this.writeEntries(row.id, entries)
    })
  }

  deleteSnapshot(id: string): void {
    this.writeSnapshot(() => {
      this.db
        .prepare("DELETE FROM traffic_snapshot_entries WHERE snapshot_id = ?")
        .run(id)
      this.db.prepare("DELETE FROM traffic_snapshots WHERE id = ?").run(id)
    })
  }

  private writeSnapshot(run: () => void): void {
    this.db.exec("SAVEPOINT traffic_write")
    try {
      run()
      this.db.exec("RELEASE traffic_write")
    } catch (error) {
      this.db.exec("ROLLBACK TO traffic_write; RELEASE traffic_write")
      throw error
    }
  }

  /** 按保存时间倒序（最新在前）。 */
  listSnapshotRows(): SnapshotRow[] {
    const rows = this.db
      .prepare(
        "SELECT id, saved_at, from_at, to_at, saved_by, bytes_in, bytes_out FROM traffic_snapshots ORDER BY saved_at DESC"
      )
      .all() as {
      id: string
      saved_at: number
      from_at: number
      to_at: number
      saved_by: string
      bytes_in: number
      bytes_out: number
    }[]

    return rows.map((row) => ({
      id: row.id,
      savedAt: row.saved_at,
      fromAt: row.from_at,
      toAt: row.to_at,
      savedBy: row.saved_by === "manual" ? "manual" : "scheduled",
      bytesIn: row.bytes_in,
      bytesOut: row.bytes_out,
    }))
  }

  listEntries(snapshotIds: string[]): SnapshotEntryRow[] {
    if (snapshotIds.length === 0) {
      return []
    }

    const placeholders = snapshotIds.map(() => "?").join(", ")
    const rows = this.db
      .prepare(
        `SELECT snapshot_id, name, label, parent, command, ports, pids, bytes_in, bytes_out
         FROM traffic_snapshot_entries WHERE snapshot_id IN (${placeholders})`
      )
      .all(...snapshotIds) as RawEntryRow[]

    return rows.map((row) => ({
      snapshotId: row.snapshot_id,
      name: row.name,
      label: row.label,
      parent: row.parent,
      command: row.command,
      ports: JSON.parse(row.ports) as number[],
      pids: JSON.parse(row.pids) as number[],
      bytesIn: row.bytes_in,
      bytesOut: row.bytes_out,
    }))
  }

  private writeEntries(
    snapshotId: string,
    entries: Omit<SnapshotEntryRow, "snapshotId">[]
  ): void {
    if (entries.length === 0) {
      return
    }

    const statement = this.db.prepare(
      `INSERT INTO traffic_snapshot_entries
         (snapshot_id, name, label, parent, command, ports, pids, bytes_in, bytes_out)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (const entry of entries) {
      statement.run(
        snapshotId,
        entry.name,
        entry.label,
        entry.parent,
        entry.command,
        JSON.stringify(entry.ports),
        JSON.stringify(entry.pids),
        entry.bytesIn,
        entry.bytesOut
      )
    }
  }
}
