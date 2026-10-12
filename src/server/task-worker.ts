import {
  assertRestoreBarrierOpen,
  registerDatabaseUser,
} from "./common/database-maintenance"
import { publicSystemError } from "./common/public-error"
import {
  parseWorkerJob,
  serializeWorkerMessage,
  type WorkerMessage,
} from "./common/tasks/worker-protocol"
import { createExecutorRegistry, taskExecutors } from "./tasks/executors"

/**
 * 后台任务执行子进程。
 *
 * 只接受父进程通过 stdin 发来的一条任务载荷，并把进度与结果写成一行行 JSON。
 * 载荷里的 kind 必须在本地注册表里查表，因此外部输入无法指定要加载的模块或要
 * 执行的命令；父进程退出时 stdin 关闭，尚未开始的任务直接结束，不做补偿执行。
 */
const write = (message: WorkerMessage): void => {
  process.stdout.write(serializeWorkerMessage(message))
}

const readJob = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf8").trim()
}

const main = async (): Promise<void> => {
  // 遵守维护屏障：数据库正在恢复时不碰库、不执行任务，只报告冲突；
  // 恢复本身只由启动入口执行，后台 worker 绝不擅自恢复。
  try {
    assertRestoreBarrierOpen()
  } catch (error) {
    write({
      type: "failed",
      error: error instanceof Error ? error.message : "数据库维护中",
      httpStatus: 409,
    })
    process.exitCode = 1
    return
  }

  // 登记为数据库使用者：恢复前能靠它发现还有 worker 在跑。
  let databaseUser: ReturnType<typeof registerDatabaseUser> | null = null
  try {
    databaseUser = registerDatabaseUser("task-worker")
  } catch (error) {
    write({
      type: "failed",
      error: error instanceof Error ? error.message : "使用者登记失败",
      httpStatus: 500,
    })
    process.exitCode = 1
    return
  }

  try {
    await runTask()
  } finally {
    databaseUser.unregister()
  }
}

const runTask = async (): Promise<void> => {
  const raw = await readJob()
  if (raw.length === 0) {
    // 父进程在派发前就退出了：这里没有开始任何动作。
    return
  }

  const job = parseWorkerJob(raw)
  if (!job) {
    write({ type: "failed", error: "任务载荷无法解析" })
    process.exitCode = 1
    return
  }

  const executor = createExecutorRegistry(taskExecutors).get(job.kind)
  if (!executor) {
    write({ type: "failed", error: `未注册的任务类型：${job.kind}` })
    process.exitCode = 1
    return
  }

  try {
    const outcome = await executor.run(job.payload, {
      report: (progress) => write({ type: "progress", progress }),
    })
    write({
      type: "result",
      result: outcome.result ?? null,
      message: outcome.message ?? null,
      error: outcome.error ?? null,
      status: outcome.status ?? "done",
    })
  } catch (error) {
    const failure = publicSystemError(error)
    write({
      type: "failed",
      error: failure.body.message,
      httpStatus: failure.status,
    })
    process.exitCode = 1
  }
}

// 父进程消失后写 stdout 会失败；此时不要继续跑，也不要把失败当成业务错误上报。
process.stdout.on("error", () => {
  process.exit(1)
})

void main()
