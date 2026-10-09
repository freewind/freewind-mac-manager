import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  fetchPortBindings,
  type PortBinding,
} from "@web/features/ports/mock-data"
import {
  REFRESH_INTERVAL_SECONDS,
  usePortsLocalStore,
} from "@web/features/ports/store"

/**
 * 远程状态统一走 TanStack Query。
 *
 * 目前 queryFn / mutationFn 直接操作演示数据；接后端时只需把 fetchPortBindings
 * 换成 `@shared/client-api` 的调用，页面与本地状态都不用动。
 */
export const portKeys = {
  bindings: ["ports", "bindings"] as const,
}

export const usePortBindings = () => {
  const autoRefresh = usePortsLocalStore((state) => state.autoRefresh)
  return useQuery({
    queryKey: portKeys.bindings,
    queryFn: fetchPortBindings,
    refetchInterval: autoRefresh ? REFRESH_INTERVAL_SECONDS * 1000 : false,
  })
}

/** 结束端口上的进程：把对应绑定从缓存里移除。 */
export const useTerminatePorts = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { port: number; pids: number[] }) => input,
    onSuccess: ({ port, pids }) => {
      const target = new Set(pids)
      queryClient.setQueryData<PortBinding[]>(portKeys.bindings, (previous) =>
        previous
          ? previous.filter(
              (item) => !(item.port === port && target.has(item.pid))
            )
          : previous
      )
    },
  })
}
