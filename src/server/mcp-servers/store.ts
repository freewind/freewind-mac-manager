import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { DATABASE_FILE } from "@server/env"
import type {
  McpCallKind,
  McpCallRecord,
  McpCallStatus,
  McpCapabilities,
  McpContentBlock,
  McpKeyValue,
  McpServerConfig,
  McpServerInput,
  McpTransport,
} from "@shared/api-contract"
import { MCP_CALLS_KEEP } from "./limits"

type ServerRow = {
  id: string
  name: string
  description: string
  transport: string
  command: string
  args_json: string
  cwd: string | null
  env_json: string
  url: string
  headers_json: string
  enabled: number
  tags_json: string
  timeout_seconds: number | null
  capabilities_json: string | null
  capabilities_fetched_at: number | null
  created_at: number
  updated_at: number
}

type CallRow = {
  id: string
  server_id: string
  server_name: string
  kind: string
  name: string
  status: string
  started_at: number
  duration_ms: number
  request_json: string
  content_json: string
  error: string | null
}

const SERVER_COLUMNS = `id, name, description, transport, command, args_json, cwd,
  env_json, url, headers_json, enabled, tags_json, timeout_seconds,
  capabilities_json, capabilities_fetched_at, created_at, updated_at`

const CALL_COLUMNS = `id, server_id, server_name, kind, name, status, started_at,
  duration_ms, request_json, content_json, error`

/**
 * 解析库里的 JSON 列。
 *
 * 这些列由本服务自己写入，理论上总是合法；但手工改库或历史迁移都可能留下
 * 坏数据，所以读不动就退化成空值，不让一条记录把整个列表变成 500。
 */
const parseJson = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

const isTransport = (value: string): value is McpTransport =>
  value === "stdio" || value === "http"

const isCallKind = (value: string): value is McpCallKind =>
  value === "tool" || value === "resource" || value === "prompt"

const isCallStatus = (value: string): value is McpCallStatus =>
  value === "ok" ||
  value === "tool-error" ||
  value === "protocol-error" ||
  value === "timeout-unknown"

const toConfig = (row: ServerRow): McpServerConfig => ({
  id: row.id,
  name: row.name,
  description: row.description,
  transport: isTransport(row.transport) ? row.transport : "stdio",
  command: row.command,
  args: parseJson<string[]>(row.args_json, []),
  cwd: row.cwd,
  env: parseJson<McpKeyValue[]>(row.env_json, []),
  url: row.url,
  headers: parseJson<McpKeyValue[]>(row.headers_json, []),
  enabled: row.enabled !== 0,
  tags: parseJson<string[]>(row.tags_json, []),
  timeoutSeconds: row.timeout_seconds,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toCall = (row: CallRow): McpCallRecord => ({
  id: row.id,
  serverId: row.server_id,
  serverName: row.server_name,
  kind: isCallKind(row.kind) ? row.kind : "tool",
  name: row.name,
  status: isCallStatus(row.status) ? row.status : "protocol-error",
  startedAt: row.started_at,
  durationMs: row.duration_ms,
  request: parseJson<unknown>(row.request_json, null),
  content: parseJson<McpContentBlock[]>(row.content_json, []),
  error: row.error,
})

const configValues = (config: McpServerConfig): (string | number | null)[] => [
  config.id,
  config.name,
  config.description,
  config.transport,
  config.command,
  JSON.stringify(config.args),
  config.cwd,
  JSON.stringify(config.env),
  config.url,
  JSON.stringify(config.headers),
  config.enabled ? 1 : 0,
  JSON.stringify(config.tags),
  config.timeoutSeconds,
  config.createdAt,
  config.updatedAt,
]

const INSERT_SERVER_SQL = `INSERT INTO mcp_server (
  id, name, description, transport, command, args_json, cwd, env_json, url,
  headers_json, enabled, tags_json, timeout_seconds, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

/**
 * 幂等补列：老库的 mcp_server 没有新列时补上，历史配置不动。
 * SQLite 的 ADD COLUMN 对已有行填 NULL，正是「未设置、用默认值」的语义。
 */
const ensureColumn = (
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string
): void => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string
  }[]
  if (rows.some((row) => row.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

/**
 * MCP Server 配置、能力缓存与调用记录的存储（node:sqlite，无第三方依赖）。
 *
 * 能力快照单独存一列：断开连接或进程重启后仍能看到上次读到的工具清单，
 * 页面据此标注「可能已过期」，而不是把缓存当成当前状态。
 */
export class McpServerStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file, { timeout: 5000 })
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = NORMAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_server (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        transport TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        cwd TEXT,
        env_json TEXT NOT NULL,
        url TEXT NOT NULL,
        headers_json TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        tags_json TEXT NOT NULL,
        timeout_seconds INTEGER,
        capabilities_json TEXT,
        capabilities_fetched_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_call (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        request_json TEXT NOT NULL,
        content_json TEXT NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_call_server ON mcp_call (server_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mcp_call_started ON mcp_call (started_at DESC);
    `)
    // 已有库补列：新库建表时已带上，老库在这里补上，配置与记录都不丢。
    ensureColumn(this.db, "mcp_server", "timeout_seconds", "INTEGER")
  }

  close(): void {
    this.db.close()
  }

  /** 多行写入持整次操作的事务，失败整体回滚。 */
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

  /** 配置按名称排序，界面顺序稳定；能力快照不在这里读。 */
  listConfigs(): McpServerConfig[] {
    const rows = this.db
      .prepare(`SELECT ${SERVER_COLUMNS} FROM mcp_server ORDER BY name`)
      .all() as ServerRow[]
    return rows.map(toConfig)
  }

  findConfig(id: string): McpServerConfig | null {
    const row = this.db
      .prepare(`SELECT ${SERVER_COLUMNS} FROM mcp_server WHERE id = ?`)
      .get(id) as ServerRow | undefined
    return row === undefined ? null : toConfig(row)
  }

  /** 名称唯一性检查；修改时要排除自身，传 excludeId。 */
  findConfigByName(
    name: string,
    excludeId: string | null
  ): McpServerConfig | null {
    const row = this.db
      .prepare(
        `SELECT ${SERVER_COLUMNS} FROM mcp_server WHERE name = ? AND id <> ?`
      )
      .get(name, excludeId ?? "") as ServerRow | undefined
    return row === undefined ? null : toConfig(row)
  }

  createConfig(input: McpServerInput): McpServerConfig {
    const now = Date.now()
    const config: McpServerConfig = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.db.prepare(INSERT_SERVER_SQL).run(...configValues(config))
    return config
  }

  /** 目标不存在时返回 null，由上层映射 404。 */
  updateConfig(id: string, input: McpServerInput): McpServerConfig | null {
    const existing = this.findConfig(id)
    if (existing === null) return null
    const updated: McpServerConfig = {
      ...input,
      id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }
    this.db
      .prepare(
        `UPDATE mcp_server SET name = ?, description = ?, transport = ?,
         command = ?, args_json = ?, cwd = ?, env_json = ?, url = ?,
         headers_json = ?, enabled = ?, tags_json = ?, timeout_seconds = ?,
         updated_at = ?
         WHERE id = ?`
      )
      .run(
        updated.name,
        updated.description,
        updated.transport,
        updated.command,
        JSON.stringify(updated.args),
        updated.cwd,
        JSON.stringify(updated.env),
        updated.url,
        JSON.stringify(updated.headers),
        updated.enabled ? 1 : 0,
        JSON.stringify(updated.tags),
        updated.timeoutSeconds,
        updated.updatedAt,
        id
      )
    return updated
  }

  /** 删除配置连同它的调用记录与能力快照；目标不存在时返回 false。 */
  deleteConfig(id: string): boolean {
    return this.transaction(() => {
      this.db.prepare("DELETE FROM mcp_call WHERE server_id = ?").run(id)
      const result = this.db
        .prepare("DELETE FROM mcp_server WHERE id = ?")
        .run(id)
      return Number(result.changes) > 0
    })
  }

  readCapabilities(id: string): McpCapabilities | null {
    const row = this.db
      .prepare("SELECT capabilities_json FROM mcp_server WHERE id = ?")
      .get(id) as { capabilities_json: string | null } | undefined
    if (row === undefined || row.capabilities_json === null) return null
    return parseJson<McpCapabilities | null>(row.capabilities_json, null)
  }

  saveCapabilities(id: string, capabilities: McpCapabilities): void {
    this.db
      .prepare(
        `UPDATE mcp_server SET capabilities_json = ?, capabilities_fetched_at = ?
         WHERE id = ?`
      )
      .run(JSON.stringify(capabilities), capabilities.fetchedAt, id)
  }

  /** 传输方式或地址变了就等于换了目标，旧能力不能再当作这台服务器的能力。 */
  clearCapabilities(id: string): void {
    this.db
      .prepare(
        `UPDATE mcp_server SET capabilities_json = NULL,
         capabilities_fetched_at = NULL WHERE id = ?`
      )
      .run(id)
  }

  insertCall(record: McpCallRecord): void {
    this.db
      .prepare(
        `INSERT INTO mcp_call (${CALL_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        record.id,
        record.serverId,
        record.serverName,
        record.kind,
        record.name,
        record.status,
        record.startedAt,
        record.durationMs,
        JSON.stringify(record.request ?? null),
        JSON.stringify(record.content),
        record.error
      )
  }

  /** 记录倒序，最新在前；同一毫秒内的多条按写入先后排。 */
  listCalls(options: {
    serverId: string | null
    limit: number
  }): McpCallRecord[] {
    const rows = (
      options.serverId === null
        ? this.db
            .prepare(
              `SELECT ${CALL_COLUMNS} FROM mcp_call
               ORDER BY started_at DESC, rowid DESC LIMIT ?`
            )
            .all(options.limit)
        : this.db
            .prepare(
              `SELECT ${CALL_COLUMNS} FROM mcp_call WHERE server_id = ?
               ORDER BY started_at DESC, rowid DESC LIMIT ?`
            )
            .all(options.serverId, options.limit)
    ) as CallRow[]
    return rows.map(toCall)
  }

  /** 每台服务器只保留最近若干条，插入新记录后调用。 */
  pruneCalls(serverId: string): void {
    this.db
      .prepare(
        `DELETE FROM mcp_call WHERE server_id = ? AND id NOT IN (
           SELECT id FROM mcp_call WHERE server_id = ?
           ORDER BY started_at DESC, rowid DESC LIMIT ?
         )`
      )
      .run(serverId, serverId, MCP_CALLS_KEEP)
  }
}

let singleton: McpServerStore | null = null

/**
 * 应用内共用一个连接：SQLite 单库多连接会放大锁竞争。
 * 测试直接 new McpServerStore(临时文件) 注入，不碰真实库。
 */
export const getMcpServerStore = (): McpServerStore => {
  singleton ??= new McpServerStore(DATABASE_FILE)
  return singleton
}
