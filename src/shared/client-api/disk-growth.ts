import type {
  ActionResponse,
  DiskSnapshotDeleteResult,
  EntriesResponse,
  ScansResponse,
  ScanTaskResult,
  TreeResponse,
} from "@shared/api-contract"
import { apiClient, taskRequestHeaders, unwrap } from "./client"
import { type Execution, runExecution } from "./execution"

export const fetchScans = async (): Promise<ScansResponse> =>
  unwrap<ScansResponse>(await apiClient.listScans())

export const fetchEntries = async (options: {
  scanId: number
  baselineScanId?: number
  path: string
  keyword?: string
}): Promise<EntriesResponse> =>
  unwrap<EntriesResponse>(await apiClient.listEntries({ query: options }))

/**
 * 发起扫描：请求标识由服务端用来复用任务，因此重发不会变成第二次扫描。
 * 结果要么是完成的快照信息，要么是受理回执（继续按任务查询）。
 */
export const triggerScan = async (
  requestId: string
): Promise<Execution<ScanTaskResult>> =>
  runExecution<ScanTaskResult>(() =>
    apiClient.startScan({ headers: taskRequestHeaders(requestId) })
  )

/** 访达定位与移到废纸篓都走任务：请求标识由服务端用来复用任务。 */
export const revealEntry = async (
  requestId: string,
  path: string
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.revealEntry({
      body: { path },
      headers: taskRequestHeaders(requestId),
    })
  )

export const trashEntry = async (
  requestId: string,
  path: string
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.trashEntry({
      query: { path },
      headers: taskRequestHeaders(requestId),
    })
  )

/** 删除快照同样是任务：请求标识由服务端用来复用，结果要么完成要么受理。 */
export const deleteScans = async (
  requestId: string,
  scanIds: number[]
): Promise<Execution<DiskSnapshotDeleteResult>> =>
  runExecution<DiskSnapshotDeleteResult>(() =>
    apiClient.deleteScans({
      query: { scanIds: scanIds.join(",") },
      headers: taskRequestHeaders(requestId),
    })
  )

export const fetchTree = async (options: {
  scanId: number
  baselineScanId?: number
  path: string
  depth: number
}): Promise<TreeResponse> =>
  unwrap<TreeResponse>(await apiClient.subtree({ query: options }))
