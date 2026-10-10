import type { TaskRecord } from "@shared/api-contract"
import { toast } from "sonner"
import { taskKindLabel } from "./labels"

type CompletionHandler = (task: TaskRecord) => void | Promise<void>

const handlers = new Map<string, CompletionHandler>()

/**
 * 各域在模块加载时登记自己任务种类的完成处理（刷新缓存、更新选择等）。
 *
 * 任务中心因此不需要引用任何域页面或私有 store，只按 kind 回调；域之间也不互相
 * 引用实现。
 */
export const registerTaskCompletion = (
  kind: string,
  handler: CompletionHandler
): void => {
  handlers.set(kind, handler)
}

export const runTaskCompletion = async (task: TaskRecord): Promise<void> => {
  await handlers.get(task.kind)?.(task)
}

const NOTIFIED_LIMIT = 500
const notified: string[] = []
const notifiedSet = new Set<string>()

/**
 * 终态只通知一次。快速完成路径与任务查询路径共用这一份去重，
 * 避免同一个动作被提示两遍。
 */
export const markTaskNotified = (taskId: string): boolean => {
  if (notifiedSet.has(taskId)) return false
  notifiedSet.add(taskId)
  notified.push(taskId)
  if (notified.length > NOTIFIED_LIMIT) {
    const dropped = notified.shift()
    if (dropped) notifiedSet.delete(dropped)
  }
  return true
}

export const isTaskTerminal = (task: TaskRecord): boolean =>
  task.status !== "running"

/**
 * 终态提示：快速完成路径、任务查询路径、恢复核实路径共用这一处，
 * 并由 markTaskNotified 保证同一个任务只提示一次。
 * 受理不是成功，因此这里只描述真实终态。
 */
export const notifyTaskTerminal = (task: TaskRecord): void => {
  if (task.status === "done") {
    toast.success(`已完成：${taskKindLabel(task.kind)}`)
    return
  }
  if (task.status === "partial") {
    toast.warning(task.message ?? `部分完成：${taskKindLabel(task.kind)}`)
    return
  }
  if (task.status === "failed") {
    toast.error(task.error ?? `失败：${taskKindLabel(task.kind)}`)
    return
  }
  if (task.status === "unknown") {
    toast.error(task.error ?? "这次操作的结果无法确认，请重新读取目标")
  }
}
