import type { TaskRecord } from "@shared/api-contract"
import { formatBytes, formatTimestamp } from "@shared/format"
import { TASK_ELAPSED_PREFIX } from "@shared/task-policy"
import { Progress } from "@web/components/ui/progress"
import { useClockSeconds } from "./clock"
import { taskKindLabel, taskStatusLabel } from "./labels"

/**
 * 已用时间只说明等了多久，不是进度。进度数字完全来自任务上报，
 * 只有进行中的任务才需要每秒走动这个时钟。
 */
const progressText = (task: TaskRecord): string | null => {
  const progress = task.progress
  if (!progress) return null
  const parts: string[] = []
  if (progress.done > 0 || progress.total !== null) {
    parts.push(
      progress.total === null
        ? `已处理 ${progress.done}`
        : `已处理 ${progress.done}/${progress.total}`
    )
  }
  if (progress.bytesDone !== null && progress.bytesDone > 0) {
    parts.push(
      progress.bytesTotal === null
        ? `已写入 ${formatBytes(progress.bytesDone)}`
        : `${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`
    )
  }
  if (parts.length === 0) return progress.stage
  return `${progress.stage}：${parts.join("，")}`
}

/** 只有在总量已知时才给百分比；总量未知显示不确定态，不伪造比例。 */
const progressRatio = (task: TaskRecord): number | null => {
  const progress = task.progress
  if (!progress) return null
  if (progress.total !== null && progress.total > 0) {
    return Math.min(100, (progress.done / progress.total) * 100)
  }
  if (progress.bytesTotal !== null && progress.bytesTotal > 0) {
    return Math.min(
      100,
      ((progress.bytesDone ?? 0) / progress.bytesTotal) * 100
    )
  }
  return null
}

/**
 * 一张任务卡：状态、真实进度数字、已用时间与结果。
 *
 * 进度数字只来自任务上报；没有上报时显示已用时间，并明确它只是等待时长。
 * 结果未知时给出核实入口，不提供盲目重试。
 */
export const TaskCard = ({
  task,
  onVerify,
}: {
  task: TaskRecord
  onVerify?: (task: TaskRecord) => void
}) => {
  const running = task.status === "running"
  const now = useClockSeconds(running)
  const finishedAt = task.finishedAt ?? now
  const elapsedSeconds = Math.max(0, Math.round(finishedAt - task.startedAt))
  const ratio = progressRatio(task)
  const detail = progressText(task)
  const updatedAt = task.updatedAt

  return (
    <div
      data-slot="task-card"
      className="flex flex-col gap-1.5 rounded-md border p-3"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">{taskKindLabel(task.kind)}</span>
        <span className="text-muted-foreground">
          {taskStatusLabel(task.status)}
        </span>
      </div>
      <div className="truncate text-muted-foreground" title={task.target}>
        {task.target}
      </div>
      {running ? (
        ratio === null ? (
          <Progress value={null} />
        ) : (
          <Progress value={ratio} />
        )
      ) : null}
      <div className="flex flex-wrap gap-x-3 text-muted-foreground">
        <span>
          {TASK_ELAPSED_PREFIX} {elapsedSeconds} 秒
        </span>
        <span>更新于 {formatTimestamp(updatedAt)}</span>
      </div>
      {detail ? <div>{detail}</div> : null}
      {task.message ? <div>{task.message}</div> : null}
      {task.error ? <div className="text-destructive">{task.error}</div> : null}
      {task.status === "unknown" ? (
        <div className="text-destructive">
          这次操作的结果无法确认，请重新读取目标后再决定是否重试。
          {onVerify ? (
            <button
              type="button"
              className="ml-1 underline"
              onClick={() => onVerify(task)}
            >
              重新核实
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
