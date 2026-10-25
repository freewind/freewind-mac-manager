import type {
  ActionResponse,
  ClashVergeConnectionsResponse,
  ClashVergeMergeFile,
  ClashVergeProfilesResponse,
  ClashVergeProxiesResponse,
  ClashVergeStatus,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

export const fetchClashVergeStatus = async (options?: {
  signal?: AbortSignal
}): Promise<ClashVergeStatus> =>
  unwrap<ClashVergeStatus>(
    await apiClient.getClashVergeStatus({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

export const fetchClashVergeProxies = async (options?: {
  signal?: AbortSignal
}): Promise<ClashVergeProxiesResponse> =>
  unwrap<ClashVergeProxiesResponse>(
    await apiClient.getClashVergeProxies({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

export const fetchClashVergeConnections = async (options?: {
  signal?: AbortSignal
}): Promise<ClashVergeConnectionsResponse> =>
  unwrap<ClashVergeConnectionsResponse>(
    await apiClient.getClashVergeConnections({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

export const fetchClashVergeMergeFile = async (options?: {
  signal?: AbortSignal
}): Promise<ClashVergeMergeFile> =>
  unwrap<ClashVergeMergeFile>(
    await apiClient.getClashVergeMergeFile({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/**
 * 保存全局 Merge：写操作，客户端不自动重试；超时或断连时结果未知，
 * 必须重新读取文件核实，不能直接报失败或重发。
 */
export const saveClashVergeMergeFile = async (
  content: string
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(
    await apiClient.saveClashVergeMergeFile({ body: { content } })
  )

/** 订阅清单：只读回显 profiles.yaml 里的订阅名称与链接。 */
export const fetchClashVergeProfiles = async (options?: {
  signal?: AbortSignal
}): Promise<ClashVergeProfilesResponse> =>
  unwrap<ClashVergeProfilesResponse>(
    await apiClient.getClashVergeProfiles({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )
