import {
  fetchClashVergeConnections,
  fetchClashVergeProxies,
  fetchClashVergeStatus,
} from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"

export const clashVergeKeys = {
  status: ["clash-verge", "status"] as const,
  proxies: ["clash-verge", "proxies"] as const,
  connections: ["clash-verge", "connections"] as const,
}

const isPageVisible = () =>
  typeof document === "undefined" || document.visibilityState === "visible"

export const useClashVergeStatusQuery = () =>
  useQuery({
    queryKey: clashVergeKeys.status,
    queryFn: ({ signal }) => fetchClashVergeStatus({ signal }),
    refetchInterval: () => (isPageVisible() ? 5000 : false),
    retry: false,
  })

export const useClashVergeProxiesQuery = () =>
  useQuery({
    queryKey: clashVergeKeys.proxies,
    queryFn: ({ signal }) => fetchClashVergeProxies({ signal }),
    refetchInterval: () => (isPageVisible() ? 30000 : false),
    retry: false,
  })

export const useClashVergeConnectionsQuery = () =>
  useQuery({
    queryKey: clashVergeKeys.connections,
    queryFn: ({ signal }) => fetchClashVergeConnections({ signal }),
    refetchInterval: () => (isPageVisible() ? 5000 : false),
    retry: false,
  })
