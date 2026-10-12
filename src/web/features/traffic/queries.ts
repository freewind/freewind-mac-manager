import type {
  TrafficGroup,
  TrafficSnapshot,
  TrafficStatus,
} from "@shared/api-contract"
import {
  fetchTrafficGroups,
  fetchTrafficSnapshots,
  fetchTrafficStatus,
  killTrafficProcesses,
} from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { REALTIME_SNAPSHOT_ID } from "@web/features/traffic/store"

/**
 * 远程状态统一走 TanStack Query：查询与改动都通过 client-api 调后端，页面只读缓存。
 */
export const trafficKeys = {
  snapshots: ["traffic", "snapshots"] as const,
  status: ["traffic", "status"] as const,
  groups: (ids: string[]) =>
    ["traffic", "groups", [...ids].sort().join("|")] as const,
}

/** 状态还没拿到时的兜底采样秒数；正常轮询一律以后端返回的 intervalSeconds 为准。 */
export const FALLBACK_INTERVAL_SECONDS = 1

/**
 * 状态查询的轮询间隔（毫秒），由后端的采样间隔推导：服务端改成多少秒，页面就跟随多少。
 * 状态查询只读 sqlite 两行（实测可忽略），因此可以跟随 1 秒的采样节奏。
 */
export const statusPollMs = (intervalSeconds: number | undefined): number =>
  (intervalSeconds ?? FALLBACK_INTERVAL_SECONDS) * 1000

/**
 * 实时进程明细的刷新间隔（毫秒）。
 *
 * 它必须比采样慢，不能跟随 intervalSeconds：明细接口每轮要跑 `ps -axo`
 * （实测 0.08–0.09 秒）和 `lsof -nP -iTCP -a -p`（128 pid 一批实测 0.9–1.2 秒），
 * 单轮就是近 1 秒量级；若跟随 1 秒采样就等于让服务端每秒跑一次 lsof，
 * CPU 与 IO 会持续升高。采样每 1 秒与「页面每 1 秒重拉一次带 lsof 的明细」是两回事。
 */
export const REALTIME_DETAILS_REFRESH_MS = 5000

export const useTrafficSnapshots = () =>
  useQuery({
    queryKey: trafficKeys.snapshots,
    queryFn: async (): Promise<TrafficSnapshot[]> =>
      (await fetchTrafficSnapshots()).snapshots,
  })

export const useTrafficStatus = () =>
  useQuery({
    queryKey: trafficKeys.status,
    queryFn: async (): Promise<TrafficStatus> => fetchTrafficStatus(),
    // 间隔不写死：跟随状态里的采样间隔；状态未就绪时先按兜底间隔取一次。
    refetchInterval: (query) => statusPollMs(query.state.data?.intervalSeconds),
  })

/** 选中「实时」时拉当前进程，否则拉所选快照的合计；实时会自动刷新。 */
export const useTrafficGroups = (ids: string[]) => {
  const realtime = ids.length === 0 || ids.includes(REALTIME_SNAPSHOT_ID)

  return useQuery({
    queryKey: trafficKeys.groups(ids),
    queryFn: async (): Promise<TrafficGroup[]> => {
      const result = await fetchTrafficGroups(
        realtime ? { realtime: true } : { ids }
      )
      return result.groups
    },
    // 实时态按自己的慢节奏刷新（含 ps+lsof，见 REALTIME_DETAILS_REFRESH_MS）；
    // 非实时态（快照）保持不轮询。
    refetchInterval: realtime ? REALTIME_DETAILS_REFRESH_MS : false,
  })
}

const useInvalidateTraffic = () => {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["traffic"] })
  }
}

/** 快照写操作不再回传整份历史：完成后统一重新读取列表与明细。 */
export const useInvalidateTrafficAll = () => useInvalidateTraffic()

/** 结束进程。 */
export const useKillProcesses = () => {
  const invalidate = useInvalidateTraffic()
  return useMutation({
    mutationFn: async (input: { pids: number[]; force?: boolean }) =>
      killTrafficProcesses(input),
    onSuccess: () => invalidate(),
  })
}
