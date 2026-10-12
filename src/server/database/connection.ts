import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { DATABASE_FILE } from "@server/env"

/** 有界锁等待：数据库被别的写事务占用时最多等 5 秒，超时直接报错。 */
export const DATABASE_BUSY_TIMEOUT_MS = 5000

export type DatabaseMode = "readwrite" | "readonly"

export type OpenDatabaseOptions = {
  /** 只允许测试显式注入临时库；生产走 env.DATABASE_FILE。 */
  file?: string
  mode?: DatabaseMode
}

/**
 * 打开应用数据库。
 *
 * - readonly：查询子进程用。readOnly 打开后 SQLite 会拒绝任何写入，再加
 *   query_only 兜底；整数一律读成 bigint，避免大整数在 JS number 里丢精度。
 * - readwrite：业务域写入用。按项目约定设 WAL、synchronous=NORMAL 与外键检查。
 *
 * WAL 是数据库级持久设置，只能由可写连接设置；只读连接不去改它。
 */
export const openDatabase = (
  options: OpenDatabaseOptions = {}
): DatabaseSync => {
  const mode = options.mode ?? "readwrite"
  const file = options.file ?? DATABASE_FILE
  if (mode === "readonly" && !existsSync(file)) {
    throw new Error(`[mac-manager] 数据库文件不存在：${file}`)
  }
  const database = new DatabaseSync(file, {
    readOnly: mode === "readonly",
    readBigInts: true,
    enableForeignKeyConstraints: true,
    timeout: DATABASE_BUSY_TIMEOUT_MS,
  })
  if (mode === "readonly") {
    database.exec("PRAGMA query_only = ON")
  } else {
    database.exec("PRAGMA journal_mode = WAL")
    database.exec("PRAGMA synchronous = NORMAL")
  }
  return database
}

/** 关闭连接；已经关闭时是空操作，重复关闭不会抛错。 */
export const closeDatabase = (database: DatabaseSync): void => {
  database.close()
}

/** 打开 → 执行 → 一定关闭，异常路径也不漏连接。 */
export const withDatabase = <T>(
  options: OpenDatabaseOptions,
  run: (database: DatabaseSync) => T
): T => {
  const database = openDatabase(options)
  try {
    return run(database)
  } finally {
    closeDatabase(database)
  }
}
