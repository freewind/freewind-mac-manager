import {
  type ActionResponse,
  type FrpConfig,
  type FrpConfigInput,
  type FrpProxy,
  TASK_KINDS,
} from "@shared/api-contract"
import { saveFrpConfig as saveFrpConfigApi } from "@shared/client-api"
import { describeError } from "@shared/format"
import { configSignature, serializeFrpcToml } from "@shared/frp-format"
import { frpConfigTaskTarget } from "@shared/task-targets"
import { useQueryClient } from "@tanstack/react-query"
import {
  frpKeys,
  useAddProxy,
  useDeleteProxy,
  useFrpConfigQuery,
  useProbeProxy,
  useUpdateProxy,
} from "@web/features/frp/queries"
import { useFrpLocalStore } from "@web/features/frp/store"
import { useTaskAction } from "@web/hooks/use-task-action"
import { useMemo } from "react"
import { toast } from "sonner"

/**
 * FRP 页的数据入口。
 *
 * - 远程状态：TanStack Query（frpc 配置）
 * - 本地共享状态：Zustand（搜索、类型筛选、选中、探测结果）
 * - 页面级瞬时状态：React state（表单弹窗、删除确认，留在页面组件内）
 */
export const useFrp = () => {
  const queryClient = useQueryClient()
  const local = useFrpLocalStore()
  const configQuery = useFrpConfigQuery()
  const addProxy = useAddProxy()
  const updateProxy = useUpdateProxy()
  const deleteProxy = useDeleteProxy()
  const probeProxy = useProbeProxy()

  const config = configQuery.data ?? null
  const server = config?.server ?? null
  const proxies = useMemo(() => config?.proxies ?? [], [config])

  /** 当前内容与磁盘上已保存内容是否一致。 */
  const dirty = config
    ? configSignature(config) !== config.savedSignature
    : false

  const visibleProxies = useMemo(() => {
    const keyword = local.search.trim().toLowerCase()
    return proxies.filter((proxy) => {
      if (local.typeFilter !== "all" && proxy.type !== local.typeFilter) {
        return false
      }
      if (!keyword) return true
      return (
        proxy.name.toLowerCase().includes(keyword) ||
        String(proxy.remotePort).includes(keyword) ||
        String(proxy.localPort).includes(keyword) ||
        `${proxy.localIP}:${proxy.localPort}`.toLowerCase().includes(keyword)
      )
    })
  }, [proxies, local.search, local.typeFilter])

  const toml = useMemo(
    () => (config ? serializeFrpcToml(config) : ""),
    [config]
  )

  const selected =
    proxies.find((proxy) => proxy.name === local.selectedName) ?? null

  const summary = useMemo(
    () => ({
      total: proxies.length,
      reachable: proxies.filter(
        (proxy) => local.probes[proxy.name]?.reachable === true
      ).length,
      unreachable: proxies.filter(
        (proxy) => local.probes[proxy.name]?.reachable === false
      ).length,
    }),
    [proxies, local.probes]
  )

  /** 新增一条隧道。 */
  const create = (proxy: FrpProxy) => {
    addProxy.mutate(proxy, {
      onSuccess: () => toast.success(`已新增隧道 ${proxy.name}`),
    })
  }

  /** 修改一条隧道（改名时按原名定位）。 */
  const update = (originalName: string, proxy: FrpProxy) => {
    updateProxy.mutate(
      { originalName, proxy },
      {
        onSuccess: () =>
          toast.success(
            originalName === proxy.name
              ? `已更新隧道 ${proxy.name}`
              : `已重命名 ${originalName} → ${proxy.name}`
          ),
      }
    )
  }

  /** 删除一条隧道。 */
  const remove = (name: string) => {
    deleteProxy.mutate(name, {
      onSuccess: () => toast.success(`已删除隧道 ${name}`),
    })
  }

  /** 探测一条隧道是否通。 */
  const probe = (proxy: FrpProxy) => {
    probeProxy.mutate(proxy, {
      onSuccess: (result) => {
        if (result.reachable) {
          toast.success(`${proxy.name} 可连接（${result.latencyMs}ms）`)
        } else {
          toast.error(`${proxy.name} 连接失败`)
        }
      },
    })
  }

  /** 探测全部隧道，返回可达数量。 */
  const probeAll = async () => {
    if (proxies.length === 0) {
      toast.info("没有可探测的隧道")
      return
    }
    const results = await Promise.all(
      proxies.map((proxy) => probeProxy.mutateAsync(proxy))
    )
    const reachable = results.filter((result) => result.reachable).length
    toast[reachable === results.length ? "success" : "warning"](
      `已探测 ${results.length} 条隧道：${reachable} 条可达`
    )
  }

  /** 重新读取 frpc 配置。 */
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: frpKeys.config })
    toast.info("已重新读取 frpc 配置")
  }

  const saveAction = useTaskAction<ActionResponse, FrpConfigInput>({
    kind: TASK_KINDS.frpConfigSave,
    target: frpConfigTaskTarget(),
    run: (requestId, input) => saveFrpConfigApi(requestId, input),
    onCompleted: (result, input) => {
      queryClient.setQueryData<FrpConfig>(frpKeys.config, (previous) =>
        previous
          ? { ...previous, savedSignature: configSignature(input) }
          : previous
      )
      toast.success(result.message)
    },
  })

  /** 保存配置到 frpc 文件：受理不等于已保存，只有真正完成才更新指纹。 */
  const save = () => {
    if (!config) return
    void saveAction.run({ server: config.server, proxies: config.proxies })
  }

  return {
    // 数据
    server,
    proxies,
    visibleProxies,
    toml,
    dirty,
    summary,
    isLoading: configQuery.isLoading,
    /** 配置是否已成功读到；未读到时不宣称「已保存」。 */
    hasConfig: config !== null,
    error: configQuery.isError ? describeError(configQuery.error) : null,
    selected,
    existingNames: proxies.map((proxy) => proxy.name),

    // 本地共享状态
    search: local.search,
    setSearch: local.setSearch,
    typeFilter: local.typeFilter,
    setTypeFilter: local.setTypeFilter,
    selectedName: local.selectedName,
    select: local.select,
    probes: local.probes,
    checking: local.checking,

    // 动作
    create,
    update,
    remove,
    probe,
    probeAll,
    refresh,
    save,
    saving: saveAction.busy,
    probing: local.checking.length > 0,
  }
}

export type FrpPageModel = ReturnType<typeof useFrp>
