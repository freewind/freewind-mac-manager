import type {
  TrafficGroup,
  TrafficSnapshot,
  TrafficStatus,
} from "@shared/api-contract"
import {
  deleteTrafficSnapshots,
  fetchTrafficGroups,
  fetchTrafficSnapshots,
  fetchTrafficStatus,
  killTrafficProcesses,
  mergeTrafficSnapshots,
  saveTrafficSnapshot,
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
    refetchInterval: 5000,
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
    refetchInterval: realtime ? 5000 : false,
  })
}

const useInvalidateTraffic = () => {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["traffic"] })
  }
}

/** 手动保存一份快照。 */
export const useSaveSnapshot = () => {
  const invalidate = useInvalidateTraffic()
  return useMutation({
    mutationFn: async () => saveTrafficSnapshot(),
    onSuccess: () => invalidate(),
  })
}

/** 删除若干份快照，后继快照由后端重新计算。 */
export const useDeleteSnapshots = () => {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateTraffic()
  return useMutation({
    mutationFn: async (ids: string[]) => deleteTrafficSnapshots(ids),
    onSuccess: (data) => {
      queryClient.setQueryData(trafficKeys.snapshots, data.snapshots)
      invalidate()
    },
  })
}

/** 把选中的多份快照合并成一份。 */
export const useMergeSnapshots = () => {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateTraffic()
  return useMutation({
    mutationFn: async (ids: string[]) => mergeTrafficSnapshots(ids),
    onSuccess: (data) => {
      queryClient.setQueryData(trafficKeys.snapshots, data.snapshots)
      invalidate()
    },
  })
}

/** 结束进程。 */
export const useKillProcesses = () => {
  const invalidate = useInvalidateTraffic()
  return useMutation({
    mutationFn: async (input: { pids: number[]; force?: boolean }) =>
      killTrafficProcesses(input),
    onSuccess: () => invalidate(),
  })
}
