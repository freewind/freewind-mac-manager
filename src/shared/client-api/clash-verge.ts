import type {
  ActionResponse,
  ClashMergeConfig,
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

/**
 * 切换当前订阅：写操作，客户端不自动重试；服务端会重启 Clash Verge，
 * 代理短暂中断，超时或断连时结果未知，必须重新读取清单核实。
 */
export const setClashVergeCurrentProfile = async (
  uid: string
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(
    await apiClient.setClashVergeCurrentProfile({ body: { uid } })
  )

/** 合并订阅设置：选中的订阅与分组规则，存在服务端。 */
export const fetchClashMergeConfig = async (options?: {
  signal?: AbortSignal
}): Promise<ClashMergeConfig> =>
  unwrap<ClashMergeConfig>(
    await apiClient.getClashMergeConfig({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/** 保存合并设置：只存分组规则，整份替换，不自动重试。 */
export const saveClashMergeConfig = async (input: {
  rules: { pattern: string; target: string }[]
}): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.saveClashMergeConfig({ body: input }))
