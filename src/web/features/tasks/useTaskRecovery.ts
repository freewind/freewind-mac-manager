import type { TaskRecord } from "@shared/api-contract"
import {
  ApiRequestError,
  fetchTask,
  fetchTaskByRequestId,
} from "@shared/client-api"
import { describeError } from "@shared/format"
import { useQueryClient } from "@tanstack/react-query"
import {
  markTaskNotified,
  notifyTaskTerminal,
  runTaskCompletion,
} from "@web/features/tasks/completion"
import {
  forgetPendingRequest,
  listPendingRequests,
} from "@web/features/tasks/pending-requests"
import { taskKeys } from "@web/features/tasks/queries"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

/**
 * 先按任务标识查；记录已经不存在（404）时再按请求标识找一次。
 * 两种都查不到说明无法核实，调用方据此保留为待核实。
 */
const lookup = async (
  taskId: string | null,
  requestId: string
): Promise<TaskRecord | null> => {
  if (taskId) {
    try {
      return await fetchTask(taskId)
    } catch (error) {
      if (!(error instanceof ApiRequestError && error.status === 404)) {
        throw error
      }
    }
  }
  return fetchTaskByRequestId(requestId)
}

export type TaskRecovery = {
  verifying: boolean
  /** 查不到任何记录的待核实操作数量：它们既不能算成功，也不能算失败。 */
  unresolved: number
  verify: () => Promise<void>
}

/**
 * 恢复前台或重开应用后核实「已发出但未确认结果」的操作。
 *
 * 只读：按任务标识或请求标识回到后端查真实状态；查不到就如实保留为待核实，
 * 既不提示成功，也不重新发起动作。
 */
export const useTaskRecovery = (enabled: boolean): TaskRecovery => {
  const queryClient = useQueryClient()
  const [verifying, setVerifying] = useState(false)
  const [unresolved, setUnresolved] = useState(0)

  const verify = useCallback(async (): Promise<void> => {
    const pending = listPendingRequests()
    if (pending.length === 0) {
      setUnresolved(0)
      return
    }
    setVerifying(true)
    let missing = 0
    try {
      for (const item of pending) {
        try {
          const task = await lookup(item.taskId, item.requestId)
          if (task) {
            if (task.status === "running") continue
            forgetPendingRequest({ requestId: item.requestId, taskId: task.id })
            void queryClient.invalidateQueries({ queryKey: taskKeys.active })
            await runTaskCompletion(task)
            if (markTaskNotified(task.id)) notifyTaskTerminal(task)
            continue
          }
        } catch (error) {
          // 只读查询失败不是业务失败：保留待核实，下次再查。
          toast.error(`核实任务失败：${describeError(error)}`)
          continue
        }
        // 查不到任何记录：既不能算成功，也不能算失败，如实记为待核实。
        missing += 1
      }
    } finally {
      setVerifying(false)
      setUnresolved(missing)
    }
  }, [queryClient])

  useEffect(() => {
    if (!enabled) return
    void verify()
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void verify()
    }
    const onOnline = (): void => void verify()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("online", onOnline)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", onOnline)
    }
  }, [enabled, verify])

  return { verifying, unresolved, verify }
}
