import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { DATABASE_FILE } from "@server/env"
import type {
  ClashMergeConfig,
  SaveClashMergeConfigBody,
} from "@shared/api-contract"
import { ClashMergeConfigSchema } from "@shared/api-contract/schemas/clash-verge"

/** 合并订阅设置只有一份：用单行表存整份 JSON，省掉多余的键值散列。 */
const TABLE = "clash_merge_config"
const SINGLETON_ID = 1

type Row = { payload: string; updated_at: number }

/**
 * 合并订阅设置的本地存储。
 *
 * 单独建表而不是塞进 profiles.yaml：Clash Verge 会重写自己的配置，
 * 我们的分组规则属于本应用，写入它的文件既跑不通也会被覆盖。
 */
export class ClashMergeStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file, { timeout: 5000 })
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = NORMAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id INTEGER PRIMARY KEY CHECK (id = ${SINGLETON_ID}),
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  /** 读回上次保存的设置；没有记录或内容不合法时给 null，由调用方用空配置。 */
  read(): ClashMergeConfig | null {
    const row = this.db
      .prepare(`SELECT payload, updated_at FROM ${TABLE} WHERE id = ?`)
      .get(SINGLETON_ID) as Row | undefined
    if (row === undefined) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(row.payload)
    } catch {
      return null
    }
    const result = ClashMergeConfigSchema.safeParse({
      ...(typeof parsed === "object" && parsed !== null ? parsed : {}),
      updatedAt: row.updated_at,
    })
    return result.success ? result.data : null
  }

  /** 整份替换并返回服务端写入的时间（秒）。 */
  save(input: SaveClashMergeConfigBody): number {
    const updatedAt = Math.floor(Date.now() / 1000)
    this.db
      .prepare(
        `INSERT INTO ${TABLE} (id, payload, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload,
           updated_at = excluded.updated_at`
      )
      .run(SINGLETON_ID, JSON.stringify(input), updatedAt)
    return updatedAt
  }
}

let singleton: ClashMergeStore | null = null

/** 应用内共用一个连接：SQLite 单库多连接会放大锁竞争。 */
export const getClashMergeStore = (): ClashMergeStore => {
  singleton ??= new ClashMergeStore(DATABASE_FILE)
  return singleton
}
