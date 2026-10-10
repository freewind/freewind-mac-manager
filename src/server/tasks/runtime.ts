import { TaskRunner } from "@server/common/tasks/runner"
import { TaskStore } from "@server/common/tasks/store"
import {
  createProcessHost,
  type TaskRunnerHost,
} from "@server/common/tasks/worker-host"
import { DATABASE_FILE, taskWorkerCommand } from "@server/env"
import { TASK_RESPONSE_THRESHOLD_MS } from "@shared/task-policy"

export type TaskRuntime = {
  runner: TaskRunner
  store: TaskStore
}

/**
 * 组装父进程侧的任务能力：一个任务表 + 一个子进程执行器。
 *
 * 通用层不引用任何业务域：任务种类与执行实现都在子进程入口注册，这里只负责
 * 存储、调度与响应切换。
 */
export const createTaskRuntime = (options?: {
  store?: TaskStore
  host?: TaskRunnerHost
  thresholdMs?: number
  recoverInterrupted?: boolean
}): TaskRuntime => {
  const ownsStore = options?.store === undefined
  const store = options?.store ?? new TaskStore(DATABASE_FILE)
  const host =
    options?.host ??
    createProcessHost({
      ...taskWorkerCommand(),
      // 执行器与父进程共享同一份任务上限，避免无限堆积。
      maxConcurrency: 4,
    })
  const runner = new TaskRunner({
    store,
    host,
    thresholdMs: options?.thresholdMs ?? TASK_RESPONSE_THRESHOLD_MS,
  })

  // 只在本进程独占真实任务表时回收遗留任务；注入 store 的测试自行决定。
  const shouldRecover = options?.recoverInterrupted ?? ownsStore
  if (shouldRecover) {
    const count = runner.recoverInterrupted()
    if (count > 0) {
      console.log(
        `[mac-manager] ${count} 个任务在上次服务中断，已标记为结果未知`
      )
    }
    // 退出时同步回收执行子进程：开发环境热重启等路径不会走 main.ts 的关闭流程。
    // 不接管 SIGINT/SIGTERM，避免和外部（Vite、main.ts）的处理顺序打架。
    process.once("exit", () => runner.shutdown())
  }

  return { runner, store }
}
