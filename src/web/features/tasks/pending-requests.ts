import { TaskAcceptedSchema } from "@shared/api-contract"
import { useSyncExternalStore } from "react"

const STORAGE_KEY = "mac-manager.pending-requests"
const listeners = new Set<() => void>()
let cachedRaw: string | null = null
let cachedItems: PendingRequest[] = []
const emptyItems: PendingRequest[] = []

const notify = (): void => {
  cachedRaw = null
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

/**
 * 已经发出、但还没有确认结果的操作。
 *
 * 只保留请求标识与展示用的最小信息：不存载荷，不存执行队列，也不做离线排队。
 * 它只用于在恢复前台或重开应用后回到后端核实，同一标识不会再次发起动作。
 */
export type PendingRequest = {
  requestId: string
  kind: string
  target: string
  startedAt: number
  /** 收到受理回执后才知道的任务标识；结果未知时仍为 null。 */
  taskId: string | null
}

const read = (): PendingRequest[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyItems
    if (raw === cachedRaw) return cachedItems
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return emptyItems
    cachedRaw = raw
    cachedItems = parsed.flatMap((item) => {
      if (typeof item !== "object" || item === null) return []
      const value = item as Record<string, unknown>
      if (typeof value.requestId !== "string" || !value.requestId) return []
      if (typeof value.kind !== "string" || !value.kind) return []
      if (typeof value.target !== "string") return []
      return [
        {
          requestId: value.requestId,
          kind: value.kind,
          target: value.target,
          startedAt:
            typeof value.startedAt === "number" &&
            Number.isFinite(value.startedAt)
              ? value.startedAt
              : 0,
          taskId:
            typeof value.taskId === "string" && value.taskId
              ? value.taskId
              : null,
        },
      ]
    })
    return cachedItems
  } catch {
    // 存储不可读时不能让恢复流程崩溃；写操作仍会在持久化预检处被阻止。
    return emptyItems
  }
}

const write = (items: PendingRequest[]): boolean => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    notify()
    return true
  } catch {
    return false
  }
}

export const listPendingRequests = (): PendingRequest[] => read()

export const usePendingRequests = (): PendingRequest[] =>
  useSyncExternalStore(subscribe, read, () => emptyItems)

export const rememberPendingRequest = (
  request: PendingRequest
): PendingRequest[] => {
  const next = [
    ...read().filter((item) => item.requestId !== request.requestId),
    request,
  ]
  if (!write(next)) {
    throw new Error("无法保存待核实记录")
  }
  return next
}

/**
 * 核实到已知结果后清除；运行中或结果未知时保留。
 * 按任务标识匹配（受理回执给的是任务标识），结果未知时按请求标识匹配。
 */
export const forgetPendingRequest = (match: {
  requestId?: string
  taskId?: string
}): PendingRequest[] => {
  const current = read()
  const next = current.filter(
    (item) =>
      !(
        (match.requestId !== undefined && item.requestId === match.requestId) ||
        (match.taskId !== undefined && item.taskId === match.taskId)
      )
  )
  return write(next) ? next : current
}

export const clearPendingRequests = (): void => {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    notify()
  } catch {
    // 测试清理与应用恢复不能因浏览器禁用存储而崩溃。
  }
}

/** 受理回执只带任务标识；把它和本地记住的请求标识关联起来。 */
export const pendingRequestKeyOf = (accepted: unknown): string | null => {
  const parsed = TaskAcceptedSchema.safeParse(accepted)
  return parsed.success ? parsed.data.taskId : null
}
