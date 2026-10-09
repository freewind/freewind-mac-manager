import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  fetchProcessSample,
  terminateProcesses,
  REFRESH_INTERVAL_SECONDS,
  type ProcessSample,
} from "@web/features/processes/mock-data"
import { useProcessesLocalStore } from "@web/features/processes/store"

/**
 * 远程状态统一走 TanStack Query。
 *
 * 目前 queryFn / mutationFn 直接操作演示数据；接后端时只需把 fetchProcessSample
 * 换成 `@shared/client-api` 的调用，页面与本地状态都不用动。
 */
export const processKeys = {
  sample: ["processes", "sample"] as const,
}

export const useProcessSample = () => {
  const autoRefresh = useProcessesLocalStore((state) => state.autoRefresh)
  return useQuery({
    queryKey: processKeys.sample,
    queryFn: fetchProcessSample,
    refetchInterval: autoRefresh ? REFRESH_INTERVAL_SECONDS * 1000 : false,
  })
}

/** 结束进程：把结束成功的进程从缓存里摘掉，并让下一次采样重新汇总整机概览。 */
export const useTerminateProcesses = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { pids: number[]; force: boolean }) =>
      terminateProcesses(input.pids),
    onSuccess: (outcome) => {
      if (outcome.succeeded.length === 0) return
      const removed = new Set(outcome.succeeded.map((item) => item.pid))
      queryClient.setQueryData<ProcessSample>(
        processKeys.sample,
        (previous) =>
          previous === undefined
            ? previous
            : {
                ...previous,
                processes: previous.processes.filter(
                  (item) => !removed.has(item.pid)
                ),
              }
      )
      void queryClient.invalidateQueries({ queryKey: processKeys.sample })
    },
  })
}
