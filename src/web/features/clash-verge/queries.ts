import {
  fetchClashVergeConnections,
  fetchClashVergeMergeFile,
  fetchClashVergeProfiles,
  fetchClashVergeProxies,
  fetchClashVergeStatus,
  saveClashVergeMergeFile,
  setClashVergeCurrentProfile,
} from "@shared/client-api"
import { describeError } from "@shared/format"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

export const clashVergeKeys = {
  status: ["clash-verge", "status"] as const,
  proxies: ["clash-verge", "proxies"] as const,
  connections: ["clash-verge", "connections"] as const,
  mergeFile: ["clash-verge", "merge-file"] as const,
  profiles: ["clash-verge", "profiles"] as const,
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

/** 全局 Merge 文件：随面板挂载读取，不轮询（外部修改由保存前预检与窗口聚焦重取发现）。 */
export const useClashVergeMergeFileQuery = () =>
  useQuery({
    queryKey: clashVergeKeys.mergeFile,
    queryFn: ({ signal }) => fetchClashVergeMergeFile({ signal }),
    retry: false,
  })

/** 保存结果判别：冲突不是错误，预检发现外部修改时交回用户显式决定。 */
export type MergeSaveResult =
  | { kind: "saved"; message: string }
  | { kind: "conflict"; remoteModified: number }

/**
 * 保存全局 Merge：写操作不自动重试、不排队；预检读到的 modified 与
 * 进入编辑时的基线不一致就不写入，把冲突交回用户显式决定。
 * 预检是读请求，失败发生在写之前、没有副作用，按已知失败上报。
 */
export const useSaveClashVergeMerge = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      content: string
      baselineModified: number
      /** 用户已确认覆盖时跳过预检（知情后的显式选择，不是重试）。 */
      overwrite: boolean
    }): Promise<MergeSaveResult> => {
      if (!input.overwrite) {
        let latest: Awaited<ReturnType<typeof fetchClashVergeMergeFile>>
        try {
          latest = await fetchClashVergeMergeFile()
        } catch (error) {
          throw new Error(`保存前读取最新文件失败：${describeError(error)}`)
        }
        if (latest.modified !== input.baselineModified) {
          return { kind: "conflict", remoteModified: latest.modified }
        }
      }
      const result = await saveClashVergeMergeFile(input.content)
      return { kind: "saved", message: result.message }
    },
    // 写操作约束：不自动重试；离线由传输层直接拒绝，不排队重放。
    retry: false,
    networkMode: "always",
    onSuccess: (result) => {
      // 冲突没有产生写入，不刷新；保存成功才把新 modified 拉回来。
      if (result.kind === "saved") {
        void queryClient.invalidateQueries({
          queryKey: clashVergeKeys.mergeFile,
        })
      }
    },
  })
}

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
