import type { TaskRecord } from "@shared/api-contract"

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
