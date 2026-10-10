import type { TaskRunner, TaskSubmitResult } from "@server/common/tasks/runner"
import { DATABASE_FILE } from "@server/env"
import type { ScanTaskResult } from "@shared/api-contract"
import { ScanTaskResultSchema } from "@shared/api-contract/schemas/disk-growth"
import { scanTaskTarget } from "@shared/task-targets"
import { DiskGrowthStore } from "./store"
import { SCAN_KIND, type ScanOutcome } from "./task"

/** 每日自动扫描时刻（本地时间）。 */
export const SCHEDULED_HOUR = 6

/** 扫描根：固定整盘，保持与既有快照的历史一致。 */
export const SCAN_ROOT = "/"

const store = new DiskGrowthStore(DATABASE_FILE)

/** 读接口共用的存储连接（只读路径）；扫描写入在后台执行器里独立完成。 */
export const diskGrowthStore = store

/** 执行器返回的结果必须是契约里的形状，否则不能当成完成结果返回给客户端。 */
const toCompletedResponse = (outcome: {
  result: unknown
}): { status: 201; body: ScanTaskResult } => {
  const parsed = ScanTaskResultSchema.safeParse(outcome.result)
  if (!parsed.success) {
    throw new Error("扫描结果不符合契约，无法作为完成结果返回")
  }
  return { status: 201, body: parsed.data }
}

/**
 * 提交一次扫描任务。
 *
 * requestId 为空表示不是客户端请求发起（例如每日定时扫描）；两者共用同一个
 * 目标锁，因此定时扫描与手动扫描不会同时跑。
 */
export const submitScanTask = (
  runner: TaskRunner,
  requestId: string | null
): Promise<TaskSubmitResult<ScanTaskResult>> =>
  runner.submit({
    kind: SCAN_KIND,
    target: scanTaskTarget(SCAN_ROOT),
    payload: { root: SCAN_ROOT },
    requestId,
    toCompletedResponse,
  })

const describeOutcome = (outcome: TaskSubmitResult<ScanTaskResult>): string => {
  if (outcome.kind === "completed") {
    return `已完成（快照 #${outcome.body.snapshotId}）`
  }
  if (outcome.kind === "accepted") return "已转入后台执行"
  return outcome.message
}

/** 等到下一个 6:00 提交扫描任务，不等待它执行完，然后继续排下一次。 */
export const startScheduler = (runner: TaskRunner): void => {
  const scheduleNext = (): void => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(SCHEDULED_HOUR, 0, 0, 0)
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1)
    }
    const delay = next.getTime() - now.getTime()
    console.log(
      `[mac-manager] 下次自动扫描：${next.toLocaleString("zh-CN")}（${Math.round(delay / 1000)} 秒后）`
    )
    setTimeout(() => {
      void submitScanTask(runner, null).then(
        (outcome) =>
          console.log(`[mac-manager] 定时扫描：${describeOutcome(outcome)}`),
        (error) => console.error(`[mac-manager] 定时扫描失败：${error}`)
      )
      scheduleNext()
    }, delay)
  }
  scheduleNext()
}

export type { ScanOutcome }
