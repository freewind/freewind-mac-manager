import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { GrowthEntry, ScanSnapshot, TreeNode } from "@shared/api-contract"
import type { ScanEntryRow, ScanResult } from "./scanner"

type EntryKind = "dir" | "file"

type EntryQueryRow = {
  path: string
  kind: string
  size: number
  delta: number
  folded: number
}

/** 快照存储：一份 scan 记录 + 该次扫描的全部 entry 明细。 */
export class DiskGrowthStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = NORMAL")
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at REAL NOT NULL,
        finished_at REAL,
        root TEXT NOT NULL,
        total_size INTEGER NOT NULL DEFAULT 0,
        dir_count INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        folded_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS entry (
        scan_id INTEGER NOT NULL,
        path TEXT NOT NULL,
        parent TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        folded INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_entry_scan_parent ON entry(scan_id, parent);
      CREATE INDEX IF NOT EXISTS idx_entry_scan_path ON entry(scan_id, path);
    `)
  }

  insertSnapshot(
    result: ScanResult,
    options: { startedAt: number; finishedAt: number; root: string }
  ): number {
    const insertScan = this.db.prepare(
      `INSERT INTO scan (started_at, finished_at, root, total_size, dir_count, file_count, error_count, folded_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertEntry = this.db.prepare(
      `INSERT INTO entry (scan_id, path, parent, kind, size, folded) VALUES (?, ?, ?, ?, ?, ?)`
    )
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const scanResult = insertScan.run(
        options.startedAt,
        options.finishedAt,
        options.root,
        Math.round(result.totalSize),
        result.dirCount,
        result.fileCount,
        // 记录本次扫描是否碰到不可读项：不完整的结果不能当成完整的全盘结果。
        result.incomplete ? 1 : 0,
        result.foldedCount
      )
      const scanId = Number(scanResult.lastInsertRowid)
      for (const entry of result.entries) {
        insertEntry.run(
          scanId,
          entry.path,
          entry.parent,
          entry.kind,
          Math.round(entry.size),
          entry.folded ? 1 : 0
        )
      }
      this.db.exec("COMMIT")
      return scanId
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  /** 关闭连接：后台执行器完成任务后必须释放，避免多个进程长期占用同一份库。 */
  close(): void {
    this.db.close()
  }

  listSnapshots(): ScanSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT id, started_at, finished_at, total_size, dir_count, file_count, error_count, folded_count
         FROM scan ORDER BY started_at DESC`
      )
      .all() as Record<string, number | null>[]
    return rows.map((row) => ({
      id: Number(row.id),
      startedAt: Number(row.started_at),
      finishedAt: row.finished_at == null ? null : Number(row.finished_at),
      totalSize: Number(row.total_size),
      dirCount: Number(row.dir_count),
      fileCount: Number(row.file_count),
      errorCount: Number(row.error_count),
      foldedCount: Number(row.folded_count),
    }))
  }

  previousScanId(beforeId: number): number | null {
    const row = this.db
      .prepare(
        `SELECT id FROM scan WHERE id < ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(beforeId) as { id: number } | undefined
    return row ? Number(row.id) : null
  }

  listEntries(options: {
    scanId: number
    /** 差值基线；不传则用 scanId 的前一份快照。 */
    baselineScanId?: number | null
    parent: string
    keyword?: string
    limit?: number
  }): GrowthEntry[] {
    const previousId =
      options.baselineScanId !== undefined
        ? (options.baselineScanId ?? -1)
        : (this.previousScanId(options.scanId) ?? -1)
    const limit = options.limit ?? 2000
    const keyword = options.keyword?.trim()
    const sql = keyword
      ? `SELECT e.path, e.kind, e.size, e.size - COALESCE(p.size, 0) AS delta, e.folded
         FROM entry e LEFT JOIN entry p ON p.scan_id = ? AND p.path = e.path
         WHERE e.scan_id = ? AND e.path LIKE ?
         ORDER BY delta DESC LIMIT ?`
      : `SELECT e.path, e.kind, e.size, e.size - COALESCE(p.size, 0) AS delta, e.folded
         FROM entry e LEFT JOIN entry p ON p.scan_id = ? AND p.path = e.path
         WHERE e.scan_id = ? AND e.parent = ?
         ORDER BY delta DESC LIMIT ?`
    const parameters = keyword
      ? [previousId, options.scanId, `%${keyword}%`, limit]
      : [previousId, options.scanId, options.parent, limit]
    const rows = this.db.prepare(sql).all(...parameters) as EntryQueryRow[]
    return rows.map(toGrowthEntry)
  }

  getEntry(options: {
    scanId: number
    previousScanId: number | null
    path: string
  }): GrowthEntry | null {
    const row = this.db
      .prepare(
        `SELECT e.path, e.kind, e.size, e.size - COALESCE(p.size, 0) AS delta, e.folded
         FROM entry e LEFT JOIN entry p ON p.scan_id = ? AND p.path = e.path
         WHERE e.scan_id = ? AND e.path = ? LIMIT 1`
      )
      .get(options.previousScanId ?? -1, options.scanId, options.path) as
      | EntryQueryRow
      | undefined
    return row ? toGrowthEntry(row) : null
  }

  /** 按层取子树，供分布图一次性拿到前几层。 */
  subtree(options: {
    scanId: number
    baselineScanId: number | null
    path: string
    depth: number
  }): TreeNode | null {
    const build = (target: string, remaining: number): TreeNode | null => {
      const entry = this.getEntry({
        scanId: options.scanId,
        previousScanId: options.baselineScanId,
        path: target,
      })
      if (!entry) return null
      const children =
        remaining > 1
          ? this.listEntries({
              scanId: options.scanId,
              baselineScanId: options.baselineScanId,
              parent: target,
              limit: 400,
            })
              .map((child) => build(child.path, remaining - 1))
              .filter((child): child is TreeNode => child !== null)
          : []
      return {
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        size: entry.size,
        delta: entry.delta,
        folded: entry.folded,
        children,
      }
    }
    return build(options.path, options.depth)
  }

  /** 删除指定快照；剩下的快照差值会自动跨越被删区间。 */
  deleteSnapshots(ids: number[]): number {
    if (ids.length === 0) return 0
    const placeholders = ids.map(() => "?").join(", ")
    const entryResult = this.db
      .prepare(`DELETE FROM entry WHERE scan_id IN (${placeholders})`)
      .run(...ids)
    const scanResult = this.db
      .prepare(`DELETE FROM scan WHERE id IN (${placeholders})`)
      .run(...ids)
    return (
      Number(scanResult.changes ?? 0) + Number(entryResult.changes ?? 0) * 0
    )
  }

  /** 只保留最近 keep 份快照。 */
  pruneSnapshots(keep: number): void {
    if (keep <= 0) return
    this.db
      .prepare(
        `DELETE FROM entry WHERE scan_id NOT IN (SELECT id FROM scan ORDER BY started_at DESC LIMIT ?)`
      )
      .run(keep)
    this.db
      .prepare(
        `DELETE FROM scan WHERE id NOT IN (SELECT id FROM scan ORDER BY started_at DESC LIMIT ?)`
      )
      .run(keep)
  }
}

const toGrowthEntry = (row: EntryQueryRow): GrowthEntry => {
  const kind: EntryKind = row.kind === "dir" ? "dir" : "file"
  return {
    path: row.path,
    name: row.path.split("/").filter(Boolean).pop() ?? row.path,
    kind,
    size: Number(row.size),
    delta: Number(row.delta),
    folded: Number(row.folded) !== 0,
  }
}

export type { ScanEntryRow }
