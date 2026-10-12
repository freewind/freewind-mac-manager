import { type ChildProcess, spawn } from "node:child_process"
import { closeSync, constants, openSync, readSync, statSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import {
  assertRestoreBarrierOpen,
  type RegisteredDatabaseUser,
  registerDatabaseUser,
} from "@server/common/database-maintenance"
import { databaseBackupValidationWorkerCommand } from "@server/env"
import { z } from "zod"
import { inspectBackupContent } from "./catalog"

/**
 * 上传备份的校验层：先看文件形态，再只读打开做完整性与外键一致性检查，
 * 最后单独判断是否具备恢复到本应用的必要结构。
 *
 * 约定：
 * - 校验只执行 PRAGMA 与 sqlite_master 读取，不执行上传库里的任何 SQL、
 *   触发器或迁移，也不加载扩展（node:sqlite 默认禁用扩展加载）。
 * - 有效 SQLite 与可恢复是两件事：文件合格就纳入备份列表，缺应用必要表的
 *   另行标记为不可恢复并给出原因，两者互不覆盖。
 * - 校验放进一次性子进程，超时可以整进程终止；并发与排队有上限，GB 级
 *   文件的完整性检查用分钟级时限，不沿用查询任务的 5 秒上限。
 */

/** GB 级文件的完整性检查上限：15 分钟；到点整进程终止，不拖住主进程。 */
export const DATABASE_BACKUP_VALIDATION_TIMEOUT_MS = 15 * 60 * 1000
/** 校验并发 1、排队 8：完整性检查会整文件读盘，不做并发放大。 */
export const DATABASE_BACKUP_VALIDATION_MAX_CONCURRENCY = 1
export const DATABASE_BACKUP_VALIDATION_QUEUE_LIMIT = 8

const STDERR_LIMIT = 4096
const KILL_GRACE_MS = 2000
/** SQLite 头固定 100 字节；更小的文件不可能是库。 */
const SQLITE_HEADER_SIZE = 100
/** 文件长度必须是页大小的整数倍（最小页 512 字节）。 */
const SQLITE_MIN_PAGE_BYTES = 512
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1")
/** WAL 文件头魔数（小端 0x377f0682 / 0x377f0683）。 */
const WAL_MAGIC_A = Buffer.from([0x82, 0x06, 0x7f, 0x37])
const WAL_MAGIC_B = Buffer.from([0x83, 0x06, 0x7f, 0x37])

export type BackupValidationResult = {
  /** 是否为可独立验证的完整 SQLite 单文件。 */
  ok: boolean
  /** 不合格原因；合格时为 null。 */
  reason: string | null
  sizeBytes: number
  tableCount: number | null
  structureSignature: string | null
  /** 恢复阻塞原因：具备应用必要结构为 null，否则是具体说明。 */
  restoreBlockedReason: string | null
}

export const BackupValidationJobSchema = z.object({
  file: z.string().min(1).max(4096),
})
export type BackupValidationJob = z.infer<typeof BackupValidationJobSchema>

export const BackupValidationResultSchema = z.object({
  ok: z.boolean(),
  reason: z.string().nullable(),
  sizeBytes: z.number().int().min(0),
  tableCount: z.number().int().min(0).nullable(),
  structureSignature: z.string().nullable(),
  restoreBlockedReason: z.string().nullable(),
})

const BackupValidationMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("result"), result: BackupValidationResultSchema }),
  z.object({ type: z.literal("failed"), error: z.string().min(1) }),
])
export type BackupValidationMessage = z.infer<
  typeof BackupValidationMessageSchema
>

/** 解析子进程返回的一行消息；不认识的行返回 null，由父进程统一报错。 */
export const parseBackupValidationMessage = (
  line: string
): BackupValidationMessage | null => {
  try {
    const parsed = BackupValidationMessageSchema.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const rejectResult = (
  reason: string,
  sizeBytes: number
): BackupValidationResult => ({
  ok: false,
  reason,
  sizeBytes,
  tableCount: null,
  structureSignature: null,
  restoreBlockedReason: null,
})

/**
 * 文件形态预检：只读文件头与长度，不打开连接。
 * 拒绝三类伪装：不是 SQLite（含压缩包）、WAL/SHM 旁置文件冒充独立库、
 * 长度不是页整数倍（拼接或截断）。
 */
export const probeSqliteFile = (
  file: string
): { ok: true; sizeBytes: number } | { ok: false; reason: string } => {
  let sizeBytes: number
  try {
    sizeBytes = statSync(file).size
  } catch {
    return { ok: false, reason: "读不到上传的临时文件" }
  }
  if (sizeBytes < SQLITE_HEADER_SIZE) {
    return { ok: false, reason: "文件太小，不是 SQLite 数据库" }
  }
  if (sizeBytes % SQLITE_MIN_PAGE_BYTES !== 0) {
    return {
      ok: false,
      reason: "文件长度不是页大小的整数倍，可能是拼接或截断的文件",
    }
  }
  let fd: number
  try {
    fd = openSync(file, constants.O_RDONLY)
  } catch {
    return { ok: false, reason: "无法读取上传的临时文件" }
  }
  try {
    const header = Buffer.alloc(SQLITE_HEADER_SIZE)
    const read = readSync(fd, header, 0, SQLITE_HEADER_SIZE, 0)
    if (read < SQLITE_HEADER_SIZE) {
      return { ok: false, reason: "文件头不完整，不是 SQLite 数据库" }
    }
    if (!header.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
      if (
        header.subarray(0, 4).equals(WAL_MAGIC_A) ||
        header.subarray(0, 4).equals(WAL_MAGIC_B)
      ) {
        return {
          ok: false,
          reason: "这是 WAL 日志文件，不是独立数据库，请提供完整的库文件",
        }
      }
      return {
        ok: false,
        reason: "文件头不是 SQLite 格式，可能是压缩包或其他文件",
      }
    }
    // 写版本 / 读版本为 2 表示 WAL 模式：没有配套 -wal 就无法确认数据完整。
    if (header[18] === 2 || header[19] === 2) {
      return {
        ok: false,
        reason:
          "文件是 WAL 模式库，缺少配套的 -wal 内容，无法独立验证数据是否完整",
      }
    }
    return { ok: true, sizeBytes }
  } finally {
    closeSync(fd)
  }
}

/**
 * 单文件校验（同步，子进程内执行）。
 * 只读打开、只跑 PRAGMA 与 sqlite_master 读取；任何读不懂的情况都返回
 * 不合格加原因，不抛错：调用方要的是「这个文件能不能收」的结论。
 */
export const validateBackupFileSync = (
  file: string
): BackupValidationResult => {
  const probe = probeSqliteFile(file)
  if (!probe.ok) return rejectResult(probe.reason, 0)

  const inspection = inspectBackupContent(file)
  if (!inspection.integrity.ok) {
    return rejectResult(
      `完整性校验未通过：${inspection.integrity.reason}`,
      probe.sizeBytes
    )
  }

  let database: DatabaseSync | null = null
  try {
    // 外键一致性：同样用 pragma 表值函数 + LIMIT，坏库也不会整表进内存。
    database = new DatabaseSync(file, { readOnly: true, allowExtension: false })
    const violation = database
      .prepare("SELECT * FROM pragma_foreign_key_check() LIMIT 1")
      .get()
    if (violation !== undefined) {
      return rejectResult(
        `外键一致性校验未通过（涉及表 ${String(violation.table)}）`,
        probe.sizeBytes
      )
    }
  } catch (error) {
    return rejectResult(
      `无法独立验证：${error instanceof Error ? error.message : String(error)}`.slice(
        0,
        160
      ),
      probe.sizeBytes
    )
  } finally {
    if (database !== null) {
      try {
        database.close()
      } catch {
        // 已经关掉或从未成功打开：这里不再抛错。
      }
    }
  }

  return {
    ok: true,
    reason: null,
    sizeBytes: probe.sizeBytes,
    tableCount: inspection.tableCount,
    structureSignature: inspection.structureSignature,
    restoreBlockedReason: inspection.restoreBlockedReason,
  }
}

export type BackupValidationRunner = {
  /** 在有界子进程里校验一个临时文件；不合格以结果返回，基础设施故障抛错。 */
  validate: (file: string) => Promise<BackupValidationResult>
  /** 当前并发与排队数量，用于测试与诊断。 */
  stats: () => { running: number; queued: number }
  shutdown: () => void
}

export type BackupValidationRunnerOptions = {
  command?: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  maxConcurrency?: number
  queueLimit?: number
  timeoutMs?: number
}

type Waiter = {
  resolve: () => void
  reject: (error: Error) => void
}

export const createBackupValidationRunner = (
  options: BackupValidationRunnerOptions = {}
): BackupValidationRunner => {
  const worker = databaseBackupValidationWorkerCommand()
  const command = options.command ?? worker.command
  const args = options.args ?? worker.args
  const cwd = options.cwd ?? worker.cwd
  const env = options.env ?? process.env
  const maxConcurrency =
    options.maxConcurrency ?? DATABASE_BACKUP_VALIDATION_MAX_CONCURRENCY
  const queueLimit =
    options.queueLimit ?? DATABASE_BACKUP_VALIDATION_QUEUE_LIMIT
  const timeoutMs = options.timeoutMs ?? DATABASE_BACKUP_VALIDATION_TIMEOUT_MS

  let running = 0
  let closed = false
  const waiting: Waiter[] = []
  const children = new Set<ChildProcess>()

  const acquire = (): Promise<void> => {
    if (closed) {
      return Promise.reject(new Error("备份校验运行器已关闭"))
    }
    if (running < maxConcurrency) {
      running += 1
      return Promise.resolve()
    }
    if (waiting.length >= queueLimit) {
      return Promise.reject(
        new Error(`备份校验排队已满（上限 ${queueLimit}），请稍后重试`)
      )
    }
    return new Promise<void>((resolve, reject) => {
      waiting.push({ resolve, reject })
    })
  }

  const release = (): void => {
    const next = waiting.shift()
    if (next) {
      // 槽位直接交给下一个，不减少 running 计数
      next.resolve()
      return
    }
    running -= 1
  }

  const killChild = (child: ChildProcess): void => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill("SIGTERM")
    const force = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
    force.unref()
  }

  const runOnce = (file: string): Promise<BackupValidationResult> =>
    new Promise<BackupValidationResult>((resolve, reject) => {
      // 维护屏障：恢复进行中不做校验（校验会开库读），按冲突拒绝。
      try {
        assertRestoreBarrierOpen()
      } catch (error) {
        reject(
          new Error(error instanceof Error ? error.message : "数据库维护中")
        )
        return
      }
      const child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      })
      children.add(child)
      // 登记子进程为数据库使用者：恢复前能发现还有校验在跑。
      let registration: RegisteredDatabaseUser | null = null
      if (child.pid !== undefined) {
        try {
          registration = registerDatabaseUser("validation", { pid: child.pid })
        } catch (error) {
          killChild(child)
          reject(
            new Error(
              `校验子进程无法登记：${error instanceof Error ? error.message : String(error)}`
            )
          )
          return
        }
      }

      let settled = false
      let timeout: NodeJS.Timeout | null = null
      let buffer = ""
      let stderr = ""
      let protocolFailure: string | null = null

      const settle = (finish: () => void): void => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        timeout = null
        children.delete(child)
        registration?.unregister()
        killChild(child)
        finish()
      }

      const fail = (error: Error): void => {
        settle(() => reject(error))
      }

      timeout = setTimeout(() => {
        fail(new Error(`备份校验超过 ${timeoutMs} 毫秒，已终止并放弃这次校验`))
      }, timeoutMs)

      const handleLine = (line: string): void => {
        const message = parseBackupValidationMessage(line)
        if (!message) {
          protocolFailure ??= "备份校验进程返回了无法识别的消息"
          return
        }
        if (message.type === "failed") {
          fail(new Error(message.error))
          return
        }
        const parsed = BackupValidationResultSchema.safeParse(message.result)
        if (!parsed.success) {
          fail(new Error("备份校验进程返回的结果不符合约定结构"))
          return
        }
        settle(() => resolve(parsed.data))
      }

      child.stdout?.setEncoding("utf8")
      child.stdout?.on("data", (chunk: string) => {
        buffer += chunk
        let index = buffer.indexOf("\n")
        while (index >= 0) {
          handleLine(buffer.slice(0, index))
          buffer = buffer.slice(index + 1)
          index = buffer.indexOf("\n")
        }
      })
      child.stderr?.setEncoding("utf8")
      child.stderr?.on("data", (chunk: string) => {
        if (stderr.length < STDERR_LIMIT) stderr += chunk
      })

      child.on("error", () => {
        fail(new Error("无法启动备份校验进程"))
      })

      child.on("close", (code, signalName) => {
        children.delete(child)
        if (settled) {
          if (stderr.trim().length > 0) {
            console.error(`[mac-manager] 备份校验子进程输出：${stderr.trim()}`)
          }
          return
        }
        if (buffer.trim().length > 0) handleLine(buffer)
        if (settled) return
        if (protocolFailure) {
          fail(new Error(protocolFailure))
          return
        }
        if (stderr.trim().length > 0) {
          console.error(`[mac-manager] 备份校验子进程输出：${stderr.trim()}`)
        }
        fail(
          new Error(
            signalName
              ? `备份校验进程被信号 ${signalName} 中止`
              : `备份校验进程未返回结果就退出了（退出码 ${code}）`
          )
        )
      })

      child.stdin?.on("error", () => {
        // 子进程可能已在读取前退出；错误由 close 分支统一报告。
      })
      child.stdin?.write(`${JSON.stringify({ file })}\n`)
      child.stdin?.end()
    })

  return {
    validate: async (file) => {
      await acquire()
      try {
        return await runOnce(file)
      } finally {
        release()
      }
    },
    stats: () => ({ running, queued: waiting.length }),
    shutdown: () => {
      closed = true
      for (const waiter of waiting.splice(0)) {
        waiter.reject(new Error("备份校验运行器已关闭"))
      }
      for (const child of children) killChild(child)
      children.clear()
    },
  }
}

let defaultRunner: BackupValidationRunner | null = null

/** 默认校验运行器：进程内共用一个，避免每次导入都另建并发闸门。 */
export const defaultBackupValidationRunner = (): BackupValidationRunner => {
  defaultRunner ??= createBackupValidationRunner()
  return defaultRunner
}
