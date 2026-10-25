import {
  useClashVergeConnectionsQuery,
  useClashVergeProfilesQuery,
  useClashVergeProxiesQuery,
  useClashVergeStatusQuery,
} from "./queries"

export const useClashVerge = () => {
  const status = useClashVergeStatusQuery()
  const proxies = useClashVergeProxiesQuery()
  const connections = useClashVergeConnectionsQuery()
  const profiles = useClashVergeProfilesQuery()

  const refresh = () => {
    void status.refetch()
    void proxies.refetch()
    void connections.refetch()
    // 订阅清单是本地静态配置，不轮询，只跟随手动刷新。
    void profiles.refetch()
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
