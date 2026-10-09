import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  mergeSnapshotGroups,
  mergeSnapshotsIntoOne,
  mockGroups,
  mockSnapshots,
  mockStatus,
  removeSnapshotAndRecompute,
  scaleGroupsForManualSnapshot,
  type TrafficGroup,
  type TrafficSnapshot,
  type TrafficStatus,
} from "@web/features/traffic/mock-data"
import { REALTIME_SNAPSHOT_ID } from "@web/features/traffic/store"

/**
 * 远程状态统一走 TanStack Query。
 *
 * 目前 queryFn / mutationFn 直接操作演示数据；接后端时只需把这里换成
 * `@shared/client-api` 的调用，页面与本地状态都不用动。
 */
export const trafficKeys = {
  snapshots: ["traffic", "snapshots"] as const,
  status: ["traffic", "status"] as const,
  groups: (ids: string[]) =>
    ["traffic", "groups", [...ids].sort().join("|")] as const,
}

const fetchSnapshots = async (): Promise<TrafficSnapshot[]> => mockSnapshots

const fetchStatus = async (): Promise<TrafficStatus> => mockStatus

const fetchGroups = async (ids: string[]): Promise<TrafficGroup[]> => {
  if (ids.length === 0 || ids.includes(REALTIME_SNAPSHOT_ID)) {
    return mockGroups
  }

  const chosen = mockSnapshots.filter((item) => ids.includes(item.id))
  if (chosen.length === 0) {
    return []
  }
  if (chosen.length === 1) {
    return chosen[0].groups
  }
  return mergeSnapshotGroups(chosen)
}

export const useTrafficSnapshots = () =>
  useQuery({ queryKey: trafficKeys.snapshots, queryFn: fetchSnapshots })

export const useTrafficStatus = () =>
  useQuery({
    queryKey: trafficKeys.status,
    queryFn: fetchStatus,
    refetchInterval: 5000,
  })

export const useTrafficGroups = (ids: string[]) =>
  useQuery({
    queryKey: trafficKeys.groups(ids),
    queryFn: () => fetchGroups(ids),
  })

/** 手动保存一份快照。 */
export const useSaveSnapshot = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const current = queryClient.getQueryData<TrafficSnapshot[]>(
        trafficKeys.snapshots
      )
      return scaleGroupsForManualSnapshot(current?.length ?? 0)
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData<TrafficSnapshot[]>(
        trafficKeys.snapshots,
        (previous) => (previous ? [snapshot, ...previous] : [snapshot])
      )
    },
  })
}

/** 删除一份快照，后继快照会重新计算。 */
export const useRemoveSnapshot = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => id,
    onSuccess: (id) => {
      queryClient.setQueryData<TrafficSnapshot[]>(
        trafficKeys.snapshots,
        (previous) =>
          previous ? removeSnapshotAndRecompute(previous, id) : previous
      )
    },
  })
}

/** 批量删除选中的快照。 */
export const useRemoveSnapshots = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => ids,
    onSuccess: (ids) => {
      const target = new Set(ids)
      queryClient.setQueryData<TrafficSnapshot[]>(
        trafficKeys.snapshots,
        (previous) => {
          if (!previous) {
            return previous
          }
          let next = previous
          for (const snapshot of [...previous].reverse()) {
            if (target.has(snapshot.id)) {
              next = removeSnapshotAndRecompute(next, snapshot.id)
            }
          }
          return next
        }
      )
    },
  })
}

/** 把选中的多份快照合并成一份。 */
export const useMergeSnapshots = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => ids,
    onSuccess: (ids) => {
      queryClient.setQueryData<TrafficSnapshot[]>(
        trafficKeys.snapshots,
        (previous) =>
          previous ? mergeSnapshotsIntoOne(previous, ids) : previous
      )
    },
  })
}
