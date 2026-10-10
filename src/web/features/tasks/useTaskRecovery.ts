import type { TaskRecord } from "@shared/api-contract"
import {
  ApiRequestError,
  fetchTask,
  fetchTaskByRequestId,
} from "@shared/client-api"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
import { useCallback, useEffect } from "react"

/**
 * 先按任务标识查；记录已经不存在（404）时再按请求标识找一次。
 * 两种都查不到说明无法核实，需要保留待核实记录。
 */
const lookup = async (
  taskId: string | null,
  requestId: string,
  signal: AbortSignal
): Promise<TaskRecord | null> => {
  if (taskId) {
    try {
      return await fetchTask(taskId, { signal })
    } catch (error) {
      if (!(error instanceof ApiRequestError && error.status === 404)) {
        throw error
      }
    }
  }
  return fetchTaskByRequestId(requestId, { signal })
}

export type TaskRecovery = {
  verifying: boolean
  /** 查不到记录的待核实操作数量；运行中任务仍可确认，不计入此数。 */
  unresolved: number
  verify: () => Promise<void>
}

/**
 * 恢复前台或重开应用后核实「已发出但未确认结果」的操作。
 *
 * 只读查询按 TanStack Query 管理；待核实记录存在时持续轮询，查不到则保留，
 * 既不提示成功，也不重新发起动作。
 */
export const useTaskRecovery = (enabled: boolean): TaskRecovery => {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: taskKeys.recovery,
    enabled,
    queryFn: async ({ signal }): Promise<number> => {
      const pending = listPendingRequests()
      let unresolved = 0
      for (const item of pending) {
        let task: TaskRecord | null
        try {
          task = await lookup(item.taskId, item.requestId, signal)
        } catch {
          // 查询失败或记录过期均不能证明动作未执行，保留记录等待核实。
          unresolved += 1
          continue
        }
        if (!task) {
          unresolved += 1
          continue
        }
        if (signal.aborted) return unresolved
        queryClient.setQueryData(taskKeys.detail(task.id), task)
        if (task.status === "running") continue
        if (task.status === "unknown") {
          unresolved += 1
          if (markTaskNotified(task.id)) notifyTaskTerminal(task)
          continue
        }

        forgetPendingRequest({ requestId: item.requestId, taskId: task.id })
        void queryClient.invalidateQueries({ queryKey: taskKeys.active })
        void queryClient.invalidateQueries({ queryKey: taskKeys.recent })
        await runTaskCompletion(task)
        if (markTaskNotified(task.id)) notifyTaskTerminal(task)
      }
      return unresolved
    },
    refetchInterval: () => (listPendingRequests().length > 0 ? 2000 : false),
  })

  const verify = useCallback(async (): Promise<void> => {
    if (!enabled) return
    await query.refetch()
  }, [enabled, query.refetch])

  useEffect(() => {
    if (!enabled) return
    const onVisible = (): void => {
      if (document.visibilityState === "visible") {
        void queryClient.invalidateQueries({ queryKey: taskKeys.recovery })
      }
    }
    const onOnline = (): void => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.recovery })
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("online", onOnline)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", onOnline)
    }
  }, [enabled, queryClient])

  return {
    verifying: query.isFetching,
    unresolved: query.data ?? 0,
    verify,
  }
}
