import type { TaskAccepted } from "@shared/api-contract"
import {
  ApiRequestError,
  assertWriteOnline,
  type Execution,
  newRequestId,
} from "@shared/client-api"
import { describeError } from "@shared/format"
import { useQueryClient } from "@tanstack/react-query"
import {
  markTaskNotified,
  notifyTaskTerminal,
  runTaskCompletion,
} from "@web/features/tasks/completion"
import { taskKindLabel } from "@web/features/tasks/labels"
import {
  forgetPendingRequest,
  rememberPendingRequest,
  usePendingRequests,
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
  const pendingRequests = usePendingRequests()
  const submitting = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  // 终结后仍保留 acceptedTaskId，但 busy 由任务状态推导，不在 effect 里回写状态。
  const unresolved =
    acceptedTaskId !== null &&
    (task === null || task.status === "running" || task.status === "unknown")
  const pendingForAction = pendingRequests.some(
    (item) =>
      item.kind === options.kind &&
      (typeof options.target === "function" || item.target === options.target)
  )
  const busy = inFlight || unresolved || pendingForAction

  useEffect(() => {
    if (acceptedTaskId === null) return
    if (detail.isError || task === null || task.status === "running") return
    if (task.status === "unknown") {
      if (markTaskNotified(task.id)) notifyTaskTerminal(task)
      return
    }
    forgetPendingRequest({
      requestId: task.requestId ?? undefined,
      taskId: task.id,
    })
    void queryClient.invalidateQueries({ queryKey: taskKeys.active })
    void runTaskCompletion(task)
      .then(() => {
        if (markTaskNotified(task.id)) notifyTaskTerminal(task)
      })
      .catch((error: unknown) => {
        toast.error(`操作已终结，但读取结果失败：${describeError(error)}`)
      })
  }, [acceptedTaskId, task, detail.isError, queryClient])

  const run = async (payload: TPayload): Promise<boolean> => {
    if (busy || submitting.current) return false
    const requestId = newRequestId()
    const { kind, target } = optionsRef.current
    const targetValue = typeof target === "function" ? target(payload) : target
    const pending = {
      requestId,
      kind,
      target: targetValue,
      startedAt: Date.now(),
      taskId: null,
    }
    submitting.current = true
    setInFlight(true)
    let requestSent = false
    try {
      assertWriteOnline()
      // 先持久化，再发送写请求。页面关闭或进程退出时仍可按标识核实。
      rememberPendingRequest(pending)
      requestSent = true
      const execution = await optionsRef.current.run(requestId, payload)
      if (execution.kind === "completed") {
        setAcceptedTaskId(null)
        forgetPendingRequest({ requestId })
        await optionsRef.current.onCompleted(execution.body, payload)
        return true
      }
      setAcceptedTaskId(execution.body.taskId)
      rememberPendingRequest({ ...pending, taskId: execution.body.taskId })
      if (optionsRef.current.onAccepted) {
        optionsRef.current.onAccepted(execution.body, payload)
      } else {
        toast(`已交给后台执行：${taskKindLabel(kind)}`)
      }
      return true
    } catch (error) {
      const rejectedBeforeExecution =
        !requestSent ||
        (error instanceof ApiRequestError &&
          error.status !== null &&
          (error.status === 0 ||
            (error.status >= 400 &&
              error.status < 500 &&
              error.status !== 408)))
      if (rejectedBeforeExecution) {
        forgetPendingRequest({ requestId })
      }
      // 网络断开、服务端异常或响应格式错误都保留请求标识，不能安全重发。
      toast.error(
        requestSent
          ? describeError(error)
          : `操作未发送：${describeError(error)}`
      )
      return false
    } finally {
      submitting.current = false
      void queryClient.invalidateQueries({ queryKey: taskKeys.active })
      void queryClient.invalidateQueries({ queryKey: taskKeys.recent })
      void queryClient.invalidateQueries({ queryKey: taskKeys.recovery })
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
