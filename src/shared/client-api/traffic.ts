import type {
  KillProcessesResponse,
  SnapshotMutationResult,
  SnapshotSaveResult,
  TrafficGroupsResponse,
  TrafficSnapshotsResponse,
  TrafficStatus,
} from "@shared/api-contract"
import { apiClient, taskRequestHeaders, unwrap } from "./client"
import { type Execution, runExecution } from "./execution"

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

/**
 * 保存、合并、删除都会重算增量链：请求标识由服务端用来复用任务，
 * 结果要么是完成的摘要，要么是受理回执（继续按任务查询）。
 */
export const saveTrafficSnapshot = async (
  requestId: string
): Promise<Execution<SnapshotSaveResult>> =>
  runExecution<SnapshotSaveResult>(() =>
    apiClient.createTrafficSnapshot({ headers: taskRequestHeaders(requestId) })
  )

export const mergeTrafficSnapshots = async (
  requestId: string,
  ids: string[]
): Promise<Execution<SnapshotMutationResult>> =>
  runExecution<SnapshotMutationResult>(() =>
    apiClient.mergeTrafficSnapshots({
      body: { ids },
      headers: taskRequestHeaders(requestId),
    })
  )

export const deleteTrafficSnapshots = async (
  requestId: string,
  ids: string[]
): Promise<Execution<SnapshotMutationResult>> =>
  runExecution<SnapshotMutationResult>(() =>
    apiClient.deleteTrafficSnapshots({
      query: { ids },
      headers: taskRequestHeaders(requestId),
    })
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
