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
 * 轮询间隔由后端的采样间隔推导：服务端改成多少秒，页面就跟随多少，
 * 避免两处各写一个数字后出现「页面写着每 1 秒、实际 5 秒才刷新」的滞后。
 */
export const trafficPollMs = (intervalSeconds: number | undefined): number =>
  (intervalSeconds ?? FALLBACK_INTERVAL_SECONDS) * 1000

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
    refetchInterval: (query) =>
      trafficPollMs(query.state.data?.intervalSeconds),
  })

/** 选中「实时」时拉当前进程，否则拉所选快照的合计；实时会自动刷新。 */
export const useTrafficGroups = (ids: string[]) => {
  const realtime = ids.length === 0 || ids.includes(REALTIME_SNAPSHOT_ID)
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: trafficKeys.groups(ids),
    queryFn: async (): Promise<TrafficGroup[]> => {
      const result = await fetchTrafficGroups(
        realtime ? { realtime: true } : { ids }
      )
      return result.groups
    },
    // 实时态跟随采样间隔；非实时态（快照）保持不轮询。
    refetchInterval: realtime
      ? () =>
          trafficPollMs(
            queryClient.getQueryData<TrafficStatus>(trafficKeys.status)
              ?.intervalSeconds
          )
      : false,
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
