import type { FileEntry } from "@shared/api-contract"

export type FileSortKey = "name" | "size" | "modified"

const SEPARATOR = "/"

export const basename = (path: string): string =>
  path.split(SEPARATOR).filter(Boolean).pop() ?? path

/** 面包屑的一段；root 段用绝对根路径显示，其余段逐级拼接。 */
export type PathCrumb = {
  name: string
  path: string
}

/** 把「根 + 当前目录」拆成可点击的面包屑。 */
export const buildCrumbs = (rootPath: string, path: string): PathCrumb[] => {
  const root: PathCrumb = { name: rootPath, path: rootPath }
  if (path === "" || path === rootPath) return [root]

  const relative = path.startsWith(rootPath)
    ? path.slice(rootPath.length)
    : path
  const crumbs: PathCrumb[] = [root]
  let cursor = rootPath
  for (const segment of relative.split(SEPARATOR).filter(Boolean)) {
    cursor = cursor.endsWith(SEPARATOR)
      ? `${cursor}${segment}`
      : `${cursor}${SEPARATOR}${segment}`
    crumbs.push({ name: segment, path: cursor })
  }
  return crumbs
}

/** path 是否等于 ancestor 或位于其之下。 */
export const isDescendantPath = (ancestor: string, path: string): boolean =>
  path === ancestor ||
  path.startsWith(
    ancestor.endsWith(SEPARATOR) ? ancestor : `${ancestor}${SEPARATOR}`
  )

/** path 的上一级；已在根上时返回自身。 */
export const parentPath = (rootPath: string, path: string): string => {
  if (path === "" || path === rootPath) return rootPath
  const index = path.lastIndexOf(SEPARATOR)
  if (index <= 0) return rootPath
  const parent = path.slice(0, index)
  return parent.length < rootPath.length ? rootPath : parent
}

/** 目录恒在前，其次按所选列排序。 */
export const sortEntries = (
  entries: FileEntry[],
  key: FileSortKey,
  descending: boolean
): FileEntry[] => {
  const factor = descending ? -1 : 1
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1
    if (key === "name") {
      return left.name.localeCompare(right.name, "zh-CN") * factor
    }
    const leftValue = key === "size" ? left.size : left.modified
    const rightValue = key === "size" ? right.size : right.modified
    if (leftValue === rightValue) {
      return left.name.localeCompare(right.name, "zh-CN")
    }
    return (leftValue - rightValue) * factor
  })
}
