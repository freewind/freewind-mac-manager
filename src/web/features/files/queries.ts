import { useQuery } from "@tanstack/react-query"
import { fetchDirectory } from "@shared/client-api"

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
