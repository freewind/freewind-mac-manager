import type {
  ClashVergeConnectionsResponse,
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
