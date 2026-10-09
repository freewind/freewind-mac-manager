import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { PortBinding } from "@shared/api-contract"
import {
  fetchPortBindings as fetchPortBindingsApi,
  killPortProcesses as killPortProcessesApi,
} from "@shared/client-api"
import {
  REFRESH_INTERVAL_SECONDS,
  usePortsLocalStore,
} from "@web/features/ports/store"

/**
 * 远程状态统一走 TanStack Query，数据都从 `@shared/client-api` 取。
 * 组件只消费这里的 hook，不直接碰 contract / initClient。
 */
export const portKeys = {
  bindings: ["ports", "bindings"] as const,
}

export const usePortBindings = () => {
  const autoRefresh = usePortsLocalStore((state) => state.autoRefresh)
  return useQuery({
    queryKey: portKeys.bindings,
    queryFn: async (): Promise<PortBinding[]> => {
      const response = await fetchPortBindingsApi()
      return response.bindings
    },
    refetchInterval: autoRefresh ? REFRESH_INTERVAL_SECONDS * 1000 : false,
  })
}

/** 结束端口上的进程；后端只结束确实占用该端口的 PID。 */
export const useKillPortProcesses = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { port: number; pids: number[] }) =>
      killPortProcessesApi(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: portKeys.bindings })
    },
  })
}
