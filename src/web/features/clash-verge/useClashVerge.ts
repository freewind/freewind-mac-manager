import {
  useClashVergeConnectionsQuery,
  useClashVergeProxiesQuery,
  useClashVergeStatusQuery,
} from "./queries"

export const useClashVerge = () => {
  const status = useClashVergeStatusQuery()
  const proxies = useClashVergeProxiesQuery()
  const connections = useClashVergeConnectionsQuery()

  const refresh = () => {
    void status.refetch()
    void proxies.refetch()
    void connections.refetch()
  }

  return {
    status: status.data,
    proxies: proxies.data,
    connections: connections.data,
    isLoading: status.isLoading || proxies.isLoading || connections.isLoading,
    isFetching:
      status.isFetching || proxies.isFetching || connections.isFetching,
    statusQueryIsError: status.isError,
    refresh,
  }
}
