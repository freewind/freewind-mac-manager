import { TaskAcceptedSchema } from "@shared/api-contract"

const STORAGE_KEY = "mac-manager.pending-requests"

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
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (typeof item !== "object" || item === null) return []
      const value = item as Record<string, unknown>
      if (typeof value.requestId !== "string") return []
      if (typeof value.kind !== "string") return []
      if (typeof value.target !== "string") return []
      return [
        {
          requestId: value.requestId,
          kind: value.kind,
          target: value.target,
          startedAt: typeof value.startedAt === "number" ? value.startedAt : 0,
          taskId: typeof value.taskId === "string" ? value.taskId : null,
        },
      ]
    })
  } catch {
    return []
  }
}

const write = (items: PendingRequest[]): void => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export const listPendingRequests = (): PendingRequest[] => read()

export const rememberPendingRequest = (
  request: PendingRequest
): PendingRequest[] => {
  const next = [
    ...read().filter((item) => item.requestId !== request.requestId),
    request,
  ]
  write(next)
  return next
}

/**
 * 核实完成后清除：无论结果是成功、失败还是未知，都不再需要它。
 * 按任务标识匹配（受理回执给的是任务标识），结果未知时按请求标识匹配。
 */
export const forgetPendingRequest = (match: {
  requestId?: string
  taskId?: string
}): PendingRequest[] => {
  const next = read().filter(
    (item) =>
      !(
        (match.requestId !== undefined && item.requestId === match.requestId) ||
        (match.taskId !== undefined && item.taskId === match.taskId)
      )
  )
  write(next)
  return next
}

export const clearPendingRequests = (): void => {
  window.localStorage.removeItem(STORAGE_KEY)
}

/** 受理回执只带任务标识；把它和本地记住的请求标识关联起来。 */
export const pendingRequestKeyOf = (accepted: unknown): string | null => {
  const parsed = TaskAcceptedSchema.safeParse(accepted)
  return parsed.success ? parsed.data.taskId : null
}
