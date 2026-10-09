import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  configSignature,
  fetchFrpConfig,
  probeFrpProxy,
  saveFrpcConfig,
  type FrpConfig,
  type FrpProbe,
  type FrpProxy,
  type FrpServer,
} from "@web/features/frp/mock-data"
import { useFrpLocalStore } from "@web/features/frp/store"

/**
 * 远程状态统一走 TanStack Query。
 *
 * 目前 queryFn / mutationFn 直接操作演示数据；接后端时只需把这里换成
 * `@shared/client-api` 的调用，页面与本地状态都不用动。
 */
export const frpKeys = {
  config: ["frp", "config"] as const,
}

export type FrpConfigInput = { server: FrpServer; proxies: FrpProxy[] }

export const useFrpConfigQuery = () =>
  useQuery({ queryKey: frpKeys.config, queryFn: fetchFrpConfig })

type QueryClient = ReturnType<typeof useQueryClient>

const updateProxies = (
  client: QueryClient,
  updater: (proxies: FrpProxy[]) => FrpProxy[]
) => {
  client.setQueryData<FrpConfig>(frpKeys.config, (previous) =>
    previous ? { ...previous, proxies: updater(previous.proxies) } : previous
  )
}

/** 新增一条隧道。 */
export const useAddProxy = () => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (proxy: FrpProxy): Promise<FrpProxy> => proxy,
    onSuccess: (proxy) =>
      updateProxies(client, (proxies) => [...proxies, proxy]),
  })
}

/** 修改一条隧道；改名时按原名定位并替换。 */
export const useUpdateProxy = () => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      originalName: string
      proxy: FrpProxy
    }): Promise<{ originalName: string; proxy: FrpProxy }> => input,
    onSuccess: ({ originalName, proxy }) =>
      updateProxies(client, (proxies) =>
        proxies.map((item) => (item.name === originalName ? proxy : item))
      ),
  })
}

/** 删除一条隧道，并清掉它的探测结果。 */
export const useDeleteProxy = () => {
  const client = useQueryClient()
  const clearProbe = useFrpLocalStore((state) => state.clearProbe)
  return useMutation({
    mutationFn: async (name: string): Promise<string> => name,
    onSuccess: (name) => {
      updateProxies(client, (proxies) =>
        proxies.filter((item) => item.name !== name)
      )
      clearProbe(name)
    },
  })
}

/** 探测一条隧道，过程与结果都写入本地状态。 */
export const useProbeProxy = () => {
  const setProbe = useFrpLocalStore((state) => state.setProbe)
  const setChecking = useFrpLocalStore((state) => state.setChecking)
  return useMutation({
    mutationFn: (proxy: FrpProxy) => probeFrpProxy(proxy),
    onMutate: (proxy: FrpProxy) => {
      setChecking(proxy.name, true)
    },
    onSuccess: (probe: FrpProbe, proxy: FrpProxy) => {
      setProbe(proxy.name, probe)
    },
    onSettled: (_probe, _error, proxy: FrpProxy) => {
      setChecking(proxy.name, false)
    },
  })
}

/** 把当前配置写回 frpc 文件，成功后刷新「已保存」指纹。 */
export const useSaveFrp = () => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: FrpConfigInput) => saveFrpcConfig(input),
    onSuccess: (_result, input) => {
      client.setQueryData<FrpConfig>(frpKeys.config, (previous) =>
        previous
          ? { ...previous, savedSignature: configSignature(input) }
          : previous
      )
    },
  })
}
