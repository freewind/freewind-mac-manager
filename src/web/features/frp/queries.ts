import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  FrpConfig,
  FrpConfigInput,
  FrpProbe,
  FrpProxy,
} from "@shared/api-contract"
import {
  fetchFrpConfig,
  probeFrpProxy,
  saveFrpConfig,
} from "@shared/client-api"
import { configSignature } from "@shared/frp-format"
import { useFrpLocalStore } from "@web/features/frp/store"

/**
 * 远程状态统一走 TanStack Query：读配置、保存、探测都通过 @shared/client-api 调后端。
 * 新增 / 修改 / 删除只是本地编辑，不动磁盘，等用户点保存才写回文件。
 */
export const frpKeys = {
  config: ["frp", "config"] as const,
}

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

/** 新增一条隧道（仅本地，保存时才落盘）。 */
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

/** 探测一条隧道：用当前配置的服务端地址，过程与结果都写入本地状态。 */
export const useProbeProxy = () => {
  const client = useQueryClient()
  const setProbe = useFrpLocalStore((state) => state.setProbe)
  const setChecking = useFrpLocalStore((state) => state.setChecking)
  return useMutation({
    mutationFn: (proxy: FrpProxy) => {
      const config = client.getQueryData<FrpConfig>(frpKeys.config)
      if (!config) throw new Error("尚未读取到 frpc 配置")
      return probeFrpProxy({
        serverAddr: config.server.serverAddr,
        remotePort: proxy.remotePort,
      })
    },
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
    mutationFn: (input: FrpConfigInput) => saveFrpConfig(input),
    onSuccess: (_result, input) => {
      client.setQueryData<FrpConfig>(frpKeys.config, (previous) =>
        previous
          ? { ...previous, savedSignature: configSignature(input) }
          : previous
      )
    },
  })
}
