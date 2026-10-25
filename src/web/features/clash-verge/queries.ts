import type {
  MergeClashProfilesBody,
  SaveClashMergeConfigBody,
} from "@shared/api-contract"
import {
  fetchClashMergeConfig,
  fetchClashVergeConnections,
  fetchClashVergeGeosite,
  fetchClashVergeProfileFile,
  fetchClashVergeProfiles,
  fetchClashVergeProxies,
  fetchClashVergeStatus,
  mergeClashProfiles,
  saveClashMergeConfig,
  setClashVergeCurrentProfile,
} from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

export const clashVergeKeys = {
  status: ["clash-verge", "status"] as const,
  proxies: ["clash-verge", "proxies"] as const,
  connections: ["clash-verge", "connections"] as const,
  profiles: ["clash-verge", "profiles"] as const,
  profileFile: (uid: string) => ["clash-verge", "profile-file", uid] as const,
  geosite: ["clash-verge", "geosite"] as const,
  mergeConfig: ["clash-verge", "merge-config"] as const,
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

/** 订阅清单：本地静态配置，随面板挂载读取，不轮询。 */
export const useClashVergeProfilesQuery = () =>
  useQuery({
    queryKey: clashVergeKeys.profiles,
    queryFn: ({ signal }) => fetchClashVergeProfiles({ signal }),
    retry: false,
  })

/** 单个订阅的配置文件：只在弹窗打开时读一次，不轮询。 */
export const useClashVergeProfileFileQuery = (uid: string | null) =>
  useQuery({
    queryKey: clashVergeKeys.profileFile(uid ?? ""),
    queryFn: ({ signal }) => fetchClashVergeProfileFile(uid ?? "", { signal }),
    enabled: uid !== null,
    retry: false,
  })

/** geosite 数据库概览：本地文件，进面板读一次，不轮询。 */
export const useClashVergeGeositeQuery = () =>
  useQuery({
    queryKey: clashVergeKeys.geosite,
    queryFn: ({ signal }) => fetchClashVergeGeosite({ signal }),
    retry: false,
  })

/**
 * 切换当前订阅：写操作不重试、不排队。服务端会重启 Clash Verge，
 * 超时或断连时结果未知，成功后刷新清单让「当前启用」跟着变。
 */
export const useSetClashVergeCurrentProfile = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (uid: string) => setClashVergeCurrentProfile(uid),
    retry: false,
    networkMode: "always",
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clashVergeKeys.profiles })
    },
  })
}

/** 合并订阅设置：进面板读一次，不轮询。 */
export const useClashMergeConfigQuery = () =>
  useQuery({
    queryKey: clashVergeKeys.mergeConfig,
    queryFn: ({ signal }) => fetchClashMergeConfig({ signal }),
    retry: false,
  })

/** 保存合并设置：写操作不重试、不排队，成功后把服务端副本拉回来。 */
export const useSaveClashMergeConfig = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveClashMergeConfigBody) =>
      saveClashMergeConfig(input),
    retry: false,
    networkMode: "always",
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: clashVergeKeys.mergeConfig,
      })
    },
  })
}

/**
 * 生成合并配置：写操作不重试；成功后刷新订阅清单，
 * 让新生成的 freewind-merged 出现在列表里。
 */
export const useMergeClashProfiles = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: MergeClashProfilesBody) => mergeClashProfiles(input),
    retry: false,
    networkMode: "always",
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clashVergeKeys.profiles })
    },
  })
}
