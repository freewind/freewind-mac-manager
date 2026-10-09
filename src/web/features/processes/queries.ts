import type { ProcessListResponse } from "@shared/api-contract"
import { fetchProcessList, killProcesses } from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  REFRESH_INTERVAL_SECONDS,
  useProcessesLocalStore,
} from "@web/features/processes/store"

/** 远程状态统一走 TanStack Query；本地共享状态在 Zustand，页面不自己开定时器。 */
export const processKeys = {
  list: ["processes", "list"] as const,
}

export const useProcessList = () => {
  const autoRefresh = useProcessesLocalStore((state) => state.autoRefresh)
  return useQuery({
    queryKey: processKeys.list,
    queryFn: fetchProcessList,
    refetchInterval: autoRefresh ? REFRESH_INTERVAL_SECONDS * 1000 : false,
  })
}

/** 结束进程：结束成功的进程立刻从缓存摘掉，再重新采样一次保证概览同步。 */
export const useKillProcesses = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { pids: number[]; force: boolean }) =>
      killProcesses({ pids: input.pids, force: input.force }),
    onSuccess: (outcome) => {
      const finished = new Set(
        outcome.results.filter((item) => item.succeeded).map((item) => item.pid)
      )
      if (finished.size === 0) return
      queryClient.setQueryData<ProcessListResponse>(
        processKeys.list,
        (previous) =>
          previous === undefined
            ? previous
            : {
                ...previous,
                processes: previous.processes.filter(
                  (item) => !finished.has(item.pid)
                ),
              }
      )
      void queryClient.invalidateQueries({ queryKey: processKeys.list })
    },
  })
}
