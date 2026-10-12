import type { DatabaseSync } from "node:sqlite"
import { closeDatabase, openDatabase } from "./connection"
import {
  DatabaseMutationError,
  type MutationJob,
  MutationJobSchema,
  type MutationMessage,
  serializeMutationMessage,
} from "./mutation-protocol"
import { deleteRecords, insertRecord, updateRecord } from "./mutations"

/**
 * 数据库写子进程。
 *
 * 只接受父进程通过 stdin 发来的一条受校验的写结构（没有 SQL 文本字段），
 * 用可写连接在事务里执行，并把结果写成一行 JSON。长触发器和锁等待都被关在
 * 这个一次性子进程里；进程结束时连接关闭，未提交事务由 SQLite 自动回滚。
 */
const write = (message: MutationMessage): void => {
  process.stdout.write(serializeMutationMessage(message))
}

const readJob = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf8").trim()
}

const openWritable = (): DatabaseSync => {
  try {
    return openDatabase({ mode: "readwrite" })
  } catch (error) {
    // 连连接都建不起来，可以确定没有发生任何写入
    process.stderr.write(
      `[mac-manager] 无法打开数据库：${error instanceof Error ? error.message : "未知错误"}\n`
    )
    throw new DatabaseMutationError(
      500,
      "无法打开数据库，未执行任何写入",
      "not_started"
    )
  }
}

const execute = (job: MutationJob): unknown => {
  const database = openWritable()
  let result: unknown
  try {
    switch (job.kind) {
      case "insert":
        result = insertRecord(database, {
          table: job.table,
          values: job.values,
        })
        break
      case "update":
        result = updateRecord(database, {
          table: job.table,
          key: job.key,
          expectedSignature: job.expectedSignature,
          values: job.values,
        })
        break
      case "delete":
        result = deleteRecords(database, {
          table: job.table,
          items: job.items,
        })
        break
    }
  } finally {
    // 未提交事务在这里被回滚，连接不会留在子进程里
    closeDatabase(database)
  }
  return result
}

const main = async (): Promise<void> => {
  const raw = await readJob()
  if (raw.length === 0) {
    // 父进程在派发前就退出了：这里没有开始任何动作。
    return
  }

  let job: MutationJob
  try {
    const parsed = MutationJobSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      write({
        type: "failed",
        error: "写入请求不符合约定结构",
        httpStatus: 400,
        executionStatus: "not_started",
      })
      process.exitCode = 1
      return
    }
    job = parsed.data
  } catch {
    write({
      type: "failed",
      error: "写入请求无法解析",
      httpStatus: 400,
      executionStatus: "not_started",
    })
    process.exitCode = 1
    return
  }

  try {
    write({ type: "result", result: execute(job) })
  } catch (error) {
    if (error instanceof DatabaseMutationError) {
      write({
        type: "failed",
        error: error.message,
        httpStatus: error.httpStatus,
        executionStatus: error.executionStatus,
      })
      return
    }
    // 细节只留在服务端日志里，返回给客户端的只有通用说明
    process.stderr.write(
      `[mac-manager] 数据库写入失败：${error instanceof Error ? error.message : "未知错误"}\n`
    )
    write({
      type: "failed",
      error: "数据库写入失败，结果未知，请重新读取确认",
      httpStatus: 500,
      executionStatus: "unknown",
    })
  }
}

// 父进程消失后写 stdout 会失败；此时不要继续跑。
process.stdout.on("error", () => {
  process.exit(1)
})

void main()
