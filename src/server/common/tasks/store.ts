import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

export type TaskStatus = "running" | "done" | "partial" | "failed" | "unknown"

export type TaskStoredRow = {
  id: string
  requestId: string | null
  requestFingerprint: string | null
  kind: string
  target: string
  status: TaskStatus
  /** 进度 JSON；未上报过为 null。 */
  progress: string | null
  message: string | null
  error: string | null
  /** 结果 JSON；未终结为 null。 */
  result: string | null
  startedAt: number
  finishedAt: number | null
  updatedAt: number
}

export type TaskFinish = {
  status: Exclude<TaskStatus, "running">
  result: unknown
  message: string | null
  error: string | null
  finishedAt: number
}

export type TaskListFilter = {
  statuses: TaskStatus[]
  kinds?: string[]
  requestId?: string
  limit: number
  offset: number
}

const toRow = (raw: Record<string, unknown>): TaskStoredRow => ({
  id: String(raw.id),
  requestId: raw.request_id === null ? null : String(raw.request_id),
  requestFingerprint:
    raw.request_fingerprint === null ? null : String(raw.request_fingerprint),
  kind: String(raw.kind),
  target: String(raw.target),
  status: raw.status as TaskStatus,
  progress: raw.progress === null ? null : String(raw.progress),
  message: raw.message === null ? null : String(raw.message),
  error: raw.error === null ? null : String(raw.error),
  result: raw.result === null ? null : String(raw.result),
  startedAt: Number(raw.started_at),
  finishedAt: raw.finished_at === null ? null : Number(raw.finished_at),
  updatedAt: Number(raw.updated_at),
})

/**
 * 载荷指纹：同一次请求重试必须命中同一条任务，而不同载荷复用同一标识要报冲突。
 * 只保存哈希，不保存原始载荷（其中可能有路径、配置等业务内容）。
 */
export const payloadFingerprint = (payload: unknown): string => {
  const canonical = stableStringify(payload)
  return createHash("sha256").update(canonical).digest("hex")
}

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)
  )
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS task_record (
    id TEXT PRIMARY KEY,
    request_id TEXT,
    request_fingerprint TEXT,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    status TEXT NOT NULL,
    progress TEXT,
    message TEXT,
    error TEXT,
    result TEXT,
    started_at REAL NOT NULL,
    finished_at REAL,
    updated_at REAL NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_record_request
    ON task_record (request_id);
  DROP INDEX IF EXISTS idx_task_record_active_target;
  CREATE INDEX IF NOT EXISTS idx_task_record_status
    ON task_record (status, updated_at DESC);
  -- 互斥只看目标、不看种类：创建、改名与批量删除可能落在同一个目标上，
  -- 必须互相拦住。各类目标自带前缀（scan:/files:/traffic:v...），因此不会误撞。
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_record_target
    ON task_record (target) WHERE status = 'running';
`

/**
 * 任务记录存储。父进程是任务状态的唯一写入方；子进程只通过消息上报，
 * 不直接写 task_record，避免两个进程互相争用同一张表。
 */
export class TaskStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true })
    // 子进程可能同时在写业务表，这里给出有界等待而不是立刻失败。
    this.db = new DatabaseSync(file, { timeout: 5000 })
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = NORMAL")
    this.db.exec(SCHEMA)
  }

  /** 执行前登记；同 requestId 或同目标已有运行任务时抛错，由调用方复核。 */
  insert(row: {
    id: string
    requestId: string | null
    requestFingerprint: string | null
    kind: string
    target: string
    startedAt: number
  }): void {
    this.db
      .prepare(
        `INSERT INTO task_record (id, request_id, request_fingerprint, kind, target, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`
      )
      .run(
        row.id,
        row.requestId,
        row.requestFingerprint,
        row.kind,
        row.target,
        row.startedAt,
        row.startedAt
      )
  }

  get(id: string): TaskStoredRow | null {
    const raw = this.db
      .prepare("SELECT * FROM task_record WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined
    return raw ? toRow(raw) : null
  }

  findByRequestId(requestId: string): TaskStoredRow | null {
    const raw = this.db
      .prepare("SELECT * FROM task_record WHERE request_id = ?")
      .get(requestId) as Record<string, unknown> | undefined
    return raw ? toRow(raw) : null
  }

  /** 目标是否已有运行中的任务；与种类无关。 */
  findActive(target: string): TaskStoredRow | null {
    const raw = this.db
      .prepare(
        "SELECT * FROM task_record WHERE target = ? AND status = 'running' LIMIT 1"
      )
      .get(target) as Record<string, unknown> | undefined
    return raw ? toRow(raw) : null
  }

  list(filter: TaskListFilter): { rows: TaskStoredRow[]; total: number } {
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (filter.statuses.length > 0) {
      clauses.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`)
      params.push(...filter.statuses)
    }
    if (filter.kinds && filter.kinds.length > 0) {
      clauses.push(`kind IN (${filter.kinds.map(() => "?").join(", ")})`)
      params.push(...filter.kinds)
    }
    if (filter.requestId) {
      clauses.push("request_id = ?")
      params.push(filter.requestId)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
    const total = Number(
      (
        this.db
          .prepare(`SELECT COUNT(*) AS count FROM task_record ${where}`)
          .get(...params) as { count: number }
      ).count
    )
    const raw = this.db
      .prepare(
        `SELECT * FROM task_record ${where} ORDER BY started_at DESC, id LIMIT ? OFFSET ?`
      )
      .all(...params, filter.limit, filter.offset) as Record<string, unknown>[]
    return { rows: raw.map(toRow), total }
  }

  listActive(): TaskStoredRow[] {
    const raw = this.db
      .prepare("SELECT * FROM task_record WHERE status = 'running'")
      .all() as Record<string, unknown>[]
    return raw.map(toRow)
  }

  /** 进度更新；任务一旦终结就不再接受迟到上报。 */
  updateProgress(id: string, progress: string, updatedAt: number): boolean {
    const result = this.db
      .prepare(
        "UPDATE task_record SET progress = ?, updated_at = ? WHERE id = ? AND status = 'running'"
      )
      .run(progress, updatedAt, id)
    return Number(result.changes ?? 0) > 0
  }

  /** 写入终态；只有第一次生效，重复/迟到调用返回 false。 */
  finish(id: string, finish: TaskFinish): boolean {
    const result = this.db
      .prepare(
        `UPDATE task_record
         SET status = ?, result = ?, message = ?, error = ?, finished_at = ?, updated_at = ?
         WHERE id = ? AND status = 'running'`
      )
      .run(
        finish.status,
        finish.result === undefined ? null : JSON.stringify(finish.result),
        finish.message,
        finish.error,
        finish.finishedAt,
        finish.finishedAt,
        id
      )
    return Number(result.changes ?? 0) > 0
  }

  /**
   * 启动时把上一进程遗留的运行中任务标为未知：服务重启会终止子进程，
   * 这些动作的真实结果无法从任务侧确认，需要用户按目标重新核实。
   */
  markInterrupted(updatedAt: number): number {
    const result = this.db
      .prepare(
        `UPDATE task_record
         SET status = 'unknown', finished_at = ?, updated_at = ?,
             error = COALESCE(error, '服务重启，结果未知，请重新读取目标确认')
         WHERE status = 'running'`
      )
      .run(updatedAt, updatedAt)
    return Number(result.changes ?? 0)
  }

  /** 只清理已终结的历史记录，绝不删除仍在运行的任务。 */
  pruneFinished(keep: number): void {
    this.db
      .prepare(
        `DELETE FROM task_record
         WHERE status <> 'running' AND id NOT IN (
           SELECT id FROM task_record WHERE status <> 'running'
           ORDER BY finished_at DESC, id DESC LIMIT ?
         )`
      )
      .run(keep)
  }

  close(): void {
    this.db.close()
  }
}
