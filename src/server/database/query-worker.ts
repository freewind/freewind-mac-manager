import { closeDatabase, openDatabase } from "./connection"
import { getTable, listTables } from "./metadata"
import { getRecord, listRecords } from "./query"
import {
  DatabaseQueryError,
  type DatabaseQueryJob,
  DatabaseQueryJobSchema,
  type DatabaseQueryMessage,
  serializeDatabaseQueryMessage,
} from "./query-protocol"

/**
 * 数据库查询子进程。
 *
 * 只接受父进程通过 stdin 发来的一条受校验的查询结构（没有 SQL 文本字段），
 * 用只读连接执行，并把结果写成一行 JSON。同步 sqlite 会阻塞事件循环，所以
 * 重活放在子进程里；父进程据此可以按超时直接终止，不拖累主进程。
 */
const write = (message: DatabaseQueryMessage): void => {
  process.stdout.write(serializeDatabaseQueryMessage(message))
}

const readJob = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf8").trim()
}

const execute = (job: DatabaseQueryJob): unknown => {
  const database = openDatabase({ mode: "readonly" })
  try {
    switch (job.kind) {
      case "list_tables":
        return { tables: listTables(database) }
      case "table_detail": {
        const table = getTable(database, job.table)
        if (!table) {
          throw new DatabaseQueryError(404, `表或视图「${job.table}」不存在`)
        }
        return table
      }
      case "list_records":
        return listRecords(database, {
          table: job.table,
          page: job.query.page,
          pageSize: job.query.pageSize,
          filters: job.query.filters,
          sorts: job.query.sorts,
        })
      case "get_record":
        return getRecord(database, { table: job.table, key: job.key })
    }
  } finally {
    closeDatabase(database)
  }
}

const main = async (): Promise<void> => {
  const raw = await readJob()
  if (raw.length === 0) {
    // 父进程在派发前就退出了：这里没有开始任何动作。
    return
  }

  let job: DatabaseQueryJob
  try {
    const parsed = DatabaseQueryJobSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      write({
        type: "failed",
        error: "查询请求不符合约定结构",
        httpStatus: 400,
      })
      process.exitCode = 1
      return
    }
    job = parsed.data
  } catch {
    write({
      type: "failed",
      error: "查询请求无法解析",
      httpStatus: 400,
    })
    process.exitCode = 1
    return
  }

  try {
    write({ type: "result", result: execute(job) })
  } catch (error) {
    if (error instanceof DatabaseQueryError) {
      write({
        type: "failed",
        error: error.message,
        httpStatus: error.httpStatus,
      })
      return
    }
    // 细节只留在服务端日志里，返回给客户端的只有一句通用说明
    process.stderr.write(
      `[mac-manager] 数据库查询失败：${error instanceof Error ? error.message : "未知错误"}\n`
    )
    write({ type: "failed", error: "数据库查询失败", httpStatus: 500 })
  }
}

// 父进程消失后写 stdout 会失败；此时不要继续跑。
process.stdout.on("error", () => {
  process.exit(1)
})

void main()
