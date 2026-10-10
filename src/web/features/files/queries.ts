import type { FileBatchResult } from "@shared/api-contract"
import {
  copyEntries as copyEntriesApi,
  createDirectory as createDirectoryApi,
  createFile as createFileApi,
  deleteEntries as deleteEntriesApi,
  fetchDirectory,
  moveEntries as moveEntriesApi,
  renameEntry as renameEntryApi,
} from "@shared/client-api"
import type { QueryClient } from "@tanstack/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { dirnameOf, isDescendantPath } from "@web/features/files/domain"

/**
 * 远程状态统一走 TanStack Query，数据都从 `@shared/client-api` 取。
 * 组件只消费这里的 hook，不直接碰 contract / initClient。
 */
export const filesKeys = {
  all: ["files"] as const,
  directory: (path: string) => ["files", "directory", path] as const,
}

/**
 * 一个目录 = 一份 DirectoryResponse：目录树、文件表与面包屑共用同一份缓存，
 * 互不重复请求。空字符串是显式的「根目录」请求，服务端解析成真实根路径。
 */
export const useDirectoryQuery = (path: string) =>
  useQuery({
    queryKey: filesKeys.directory(path),
    queryFn: () => fetchDirectory(path),
    staleTime: 10_000,
  })

/**
 * 移出 path 及其全部后代的目录缓存（改名、删除、移动后旧路径已不存在）。
 * Query 的数组键只做逐元素相等匹配、不做字符串前缀，因此按已缓存键逐个判断。
 */
const dropDirectorySubtree = (queryClient: QueryClient, path: string): void => {
  for (const [key] of queryClient.getQueriesData({
    queryKey: ["files", "directory"],
  })) {
    const cached = key[2]
    if (typeof cached !== "string") continue
    if (cached === path || isDescendantPath(path, cached)) {
      queryClient.removeQueries({
        queryKey: filesKeys.directory(cached),
        exact: true,
      })
    }
  }
}

/** 让指定目录重新取数；未缓存的目录不产生请求。 */
const invalidateDirectories = async (
  queryClient: QueryClient,
  paths: readonly string[]
): Promise<void> => {
  await Promise.all(
    Array.from(new Set(paths)).map((path) =>
      queryClient.invalidateQueries({
        queryKey: filesKeys.directory(path),
        exact: true,
      })
    )
  )
}

export type CreateEntryInput = {
  kind: "mkdir" | "newfile"
  parent: string
  name: string
}

/** 新建目录 / 新建文件：只失效父目录。 */
export const useCreateEntryMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, parent, name }: CreateEntryInput) =>
      kind === "mkdir"
        ? createDirectoryApi(parent, name)
        : createFileApi(parent, name),
    onSuccess: async (_result, variables) => {
      await invalidateDirectories(queryClient, [variables.parent])
    },
  })
}

export type RenameEntryInput = {
  path: string
  name: string
}

/** 改名：旧路径的整棵子树缓存作废，失效所在目录。 */
export const useRenameEntryMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ path, name }: RenameEntryInput) =>
      renameEntryApi(path, name),
    onSuccess: async (_result, variables) => {
      dropDirectorySubtree(queryClient, variables.path)
      await invalidateDirectories(queryClient, [dirnameOf(variables.path)])
    },
  })
}

/**
 * 删除：受理（202）时不做任何缓存改动——那时还没有结果；
 * 真正完成后的刷新由按种类登记的完成处理负责。
 */
export const useDeleteEntriesMutation = (options: {
  onCompleted: (result: FileBatchResult, paths: string[]) => void
}) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      requestId,
      paths,
    }: {
      requestId: string
      paths: string[]
    }) => deleteEntriesApi(requestId, paths),
    onSuccess: async (execution, variables) => {
      if (execution.kind !== "completed") return
      for (const path of variables.paths) {
        if (execution.body.completed.includes(path)) {
          dropDirectorySubtree(queryClient, path)
        }
      }
      await invalidateDirectories(queryClient, variables.paths.map(dirnameOf))
      options.onCompleted(execution.body, variables.paths)
    },
  })
}

export type TransferEntriesInput = {
  mode: "copy" | "move"
  paths: string[]
  destPath: string
}

/** 复制 / 移动：同样只在真正完成时改动缓存。 */
export const useTransferEntriesMutation = (options: {
  onCompleted: (result: FileBatchResult, input: TransferEntriesInput) => void
}) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      requestId,
      mode,
      paths,
      destPath,
    }: TransferEntriesInput & { requestId: string }) =>
      mode === "copy"
        ? copyEntriesApi(requestId, paths, destPath)
        : moveEntriesApi(requestId, paths, destPath),
    onSuccess: async (execution, variables) => {
      if (execution.kind !== "completed") return
      if (variables.mode === "move") {
        for (const path of execution.body.completed) {
          dropDirectorySubtree(queryClient, path)
        }
      }
      await invalidateDirectories(queryClient, [
        ...variables.paths.map(dirnameOf),
        variables.destPath,
      ])
      options.onCompleted(execution.body, variables)
    },
  })
}
