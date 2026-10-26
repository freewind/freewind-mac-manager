import type {
  ActionResponse,
  ClashMergeConfig,
  ClashVergeConnectionsResponse,
  ClashVergeGeoip,
  ClashVergeGeosite,
  ClashVergeMmdb,
  ClashVergeProfileFile,
  ClashVergeProfilesResponse,
  ClashVergeProxiesResponse,
  ClashVergeStatus,
  MergeClashProfilesBody,
  SaveClashMergeConfigBody,
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

/** 订阅清单：只读回显 profiles.yaml 里的订阅名称与链接。 */
export const fetchClashVergeProfiles = async (options?: {
  signal?: AbortSignal
}): Promise<ClashVergeProfilesResponse> =>
  unwrap<ClashVergeProfilesResponse>(
    await apiClient.getClashVergeProfiles({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/** 单个订阅的配置文件原文：只读，用于在页面里核对订阅文件内容。 */
export const fetchClashVergeProfileFile = async (
  uid: string,
  options?: { signal?: AbortSignal }
): Promise<ClashVergeProfileFile> =>
  unwrap<ClashVergeProfileFile>(
    await apiClient.getClashVergeProfileFile({
      query: { uid },
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/** geosite 数据库概览：只读分类名与条目数。 */
export const fetchClashVergeGeosite = async (options?: {
  signal?: AbortSignal
}): Promise<ClashVergeGeosite> =>
  unwrap<ClashVergeGeosite>(
    await apiClient.getClashVergeGeosite({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/** geoip.dat 概览：只读各国网段数与预览。 */
export const fetchClashVergeGeoip = async (options?: {
  signal?: AbortSignal
}): Promise<ClashVergeGeoip> =>
  unwrap<ClashVergeGeoip>(
    await apiClient.getClashVergeGeoip({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/** Country.mmdb：按国家聚合的网段。 */
export const fetchClashVergeCountry = async (options?: {
  signal?: AbortSignal
}): Promise<ClashVergeMmdb> =>
  unwrap<ClashVergeMmdb>(
    await apiClient.getClashVergeCountry({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/** ASN.mmdb：按 ASN 聚合的网段。 */
export const fetchClashVergeAsn = async (options?: {
  signal?: AbortSignal
}): Promise<ClashVergeMmdb> =>
  unwrap<ClashVergeMmdb>(
    await apiClient.getClashVergeAsn({
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

/** 保存合并设置：规则、嗅探端口与测速参数，整份替换，不自动重试。 */
export const saveClashMergeConfig = async (
  input: SaveClashMergeConfigBody
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.saveClashMergeConfig({ body: input }))

/**
 * 生成合并配置：写操作，客户端不重试；服务端会新建/覆盖
 * freewind-merged 配置并登记到订阅清单。
 */
export const mergeClashProfiles = async (
  input: MergeClashProfilesBody
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.mergeClashProfiles({ body: input }))
