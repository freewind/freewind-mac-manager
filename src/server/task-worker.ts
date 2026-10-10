import { describeError } from "@shared/format"
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
      status: outcome.status ?? "done",
    })
  } catch (error) {
    write({ type: "failed", error: describeError(error) })
    process.exitCode = 1
  }
}

// 父进程消失后写 stdout 会失败；此时不要继续跑，也不要把失败当成业务错误上报。
process.stdout.on("error", () => {
  process.exit(1)
})

void main()
