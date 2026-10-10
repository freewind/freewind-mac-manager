import type { TaskAccepted, TaskRecord } from "@shared/api-contract"
import {
  ApiRequestError,
  type Execution,
  newRequestId,
} from "@shared/client-api"
import { describeError } from "@shared/format"
import { useQueryClient } from "@tanstack/react-query"
import {
  markTaskNotified,
  runTaskCompletion,
} from "@web/features/tasks/completion"
import { taskKindLabel } from "@web/features/tasks/labels"
import {
  forgetPendingRequest,
  rememberPendingRequest,
} from "@web/features/tasks/pending-requests"
import { taskKeys, useTaskDetail } from "@web/features/tasks/queries"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

/**
 * TPayload 是这次动作的入参（例如选中的路径）。
 * 目标锁由载荷决定，因此 target 既可以是固定字符串，也可以由载荷推导。
 */
export type TaskActionOptions<TPayload, TBody> = {
  kind: string
  target: string | ((payload: TPayload) => string)
  /** 发起动作：请求标识由这里生成并放进写请求，服务端据此复用任务。 */
  run: (requestId: string, payload: TPayload) => Promise<Execution<TBody>>
  /** 阈值内完成：按该端点自己的结果处理（刷新缓存、提示）。 */
  onCompleted: (body: TBody, payload: TPayload) => void | Promise<void>
  /** 受理时的提示文案；不传用默认说明。这不是成功提示。 */
  onAccepted?: (accepted: TaskAccepted, payload: TPayload) => void
}

/**
 * 终态提示只发一次。快速完成路径与任务查询路径共用这个去重表，
 * 因此同一个动作不会被提示两遍。
 */
const notifyTerminal = (task: TaskRecord): void => {
  if (!markTaskNotified(task.id)) return
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
  toast.error(task.error ?? "这次操作的结果无法确认，请重新读取目标")
}

/**
 * 统一的动作编排。
 *
 * - 点击后立刻进入 busy，直到请求返回；受理后 busy 延续到任务真正终结。
 * - 结果未知只记录请求标识用于核实，既不提示成功，也不自动重发。
 * - 真正调用仍由各域通过 client-api 完成，这里不拼接请求。
 */
export const useTaskAction = <TBody, TPayload = undefined>(
  options: TaskActionOptions<TPayload, TBody>
) => {
  const queryClient = useQueryClient()
  const [inFlight, setInFlight] = useState(false)
  const [acceptedTaskId, setAcceptedTaskId] = useState<string | null>(null)
  const detail = useTaskDetail(acceptedTaskId)
  const task = detail.data ?? null
  const optionsRef = useRef(options)
  optionsRef.current = options

  // 终结后仍保留 acceptedTaskId，但 busy 由任务状态推导，不在 effect 里回写状态。
  const unresolved =
    acceptedTaskId !== null &&
    !detail.isError &&
    (task === null || task.status === "running")
  const busy = inFlight || unresolved

  useEffect(() => {
    if (acceptedTaskId === null) return
    if (detail.isError) {
      if (markTaskNotified(acceptedTaskId)) {
        toast.error("查不到这次操作的任务记录，请重新读取目标确定结果")
        forgetPendingRequest({ taskId: acceptedTaskId })
        void queryClient.invalidateQueries({ queryKey: taskKeys.active })
      }
      return
    }
    if (task === null || task.status === "running") return
    forgetPendingRequest({
      requestId: task.requestId ?? undefined,
      taskId: task.id,
    })
    void queryClient.invalidateQueries({ queryKey: taskKeys.active })
    void runTaskCompletion(task)
    notifyTerminal(task)
  }, [acceptedTaskId, task, detail.isError, queryClient])

  const run = async (payload: TPayload): Promise<void> => {
    if (busy) return
    const requestId = newRequestId()
    const { kind, target } = optionsRef.current
    const targetValue = typeof target === "function" ? target(payload) : target
    setInFlight(true)
    try {
      const execution = await optionsRef.current.run(requestId, payload)
      if (execution.kind === "completed") {
        await optionsRef.current.onCompleted(execution.body, payload)
        return
      }
      rememberPendingRequest({
        requestId,
        kind,
        target: targetValue,
        startedAt: Date.now(),
        taskId: execution.body.taskId,
      })
      setAcceptedTaskId(execution.body.taskId)
      if (optionsRef.current.onAccepted) {
        optionsRef.current.onAccepted(execution.body, payload)
      } else {
        toast(`已交给后台执行：${taskKindLabel(kind)}`)
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.resultUnknown) {
        // 已经登记过，只是这次响应没回来：保留标识用于核实，绝不重发。
        rememberPendingRequest({
          requestId,
          kind,
          target: targetValue,
          startedAt: Date.now(),
          taskId: null,
        })
      }
      toast.error(describeError(error))
    } finally {
      setInFlight(false)
    }
  }

  return {
    busy,
    run,
    /** 正在跟踪的任务记录（含真实进度）；无任务时为 null。 */
    task,
    watchingTaskId: unresolved ? acceptedTaskId : null,
  }
}
