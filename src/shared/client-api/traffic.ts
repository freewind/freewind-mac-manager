import type {
  KillProcessesResponse,
  TrafficGroupsResponse,
  TrafficSnapshotResponse,
  TrafficSnapshotsResponse,
  TrafficStatus,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

export const fetchTrafficStatus = async (): Promise<TrafficStatus> =>
  unwrap<TrafficStatus>(await apiClient.getTrafficStatus())

export const fetchTrafficSnapshots =
  async (): Promise<TrafficSnapshotsResponse> =>
    unwrap<TrafficSnapshotsResponse>(await apiClient.listTrafficSnapshots())

export const fetchTrafficGroups = async (options: {
  ids?: string[]
  realtime?: boolean
}): Promise<TrafficGroupsResponse> =>
  unwrap<TrafficGroupsResponse>(
    await apiClient.listTrafficGroups({
      query: {
        ids: options.ids,
        realtime: options.realtime ? "1" : undefined,
      },
    })
  )

export const saveTrafficSnapshot = async (): Promise<TrafficSnapshotResponse> =>
  unwrap<TrafficSnapshotResponse>(await apiClient.createTrafficSnapshot())

export const mergeTrafficSnapshots = async (
  ids: string[]
): Promise<TrafficSnapshotsResponse> =>
  unwrap<TrafficSnapshotsResponse>(
    await apiClient.mergeTrafficSnapshots({ body: { ids } })
  )

export const deleteTrafficSnapshots = async (
  ids: string[]
): Promise<TrafficSnapshotsResponse> =>
  unwrap<TrafficSnapshotsResponse>(
    await apiClient.deleteTrafficSnapshots({ query: { ids } })
  )

export const killTrafficProcesses = async (options: {
  pids: number[]
  force?: boolean
}): Promise<KillProcessesResponse> =>
  unwrap<KillProcessesResponse>(
    await apiClient.killTrafficProcesses({
      body: { pids: options.pids, force: options.force },
    })
  )
