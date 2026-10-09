import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { formatBytes } from "@shared/format"

export type ScanConfig = {
  /** 扫描根，默认整个磁盘。 */
  roots: string[]
  /** 只统计总大小、不下钻、不产生内部明细的目录名。 */
  foldedNames: Set<string>
  /** 完全不纳入统计的路径。 */
  prunePaths: Set<string>
  /** 低于该大小的文件只计入所在目录，不单独记录。 */
  minFileSize: number
  /** stat 并行进程数，传给 xargs -P。 */
  statWorkers: number
}

export type ScanEntryRow = {
  path: string
  parent: string
  kind: "dir" | "file"
  size: number
  folded: boolean
}

export type ScanResult = {
  entries: ScanEntryRow[]
  dirCount: number
  fileCount: number
  foldedCount: number
  totalSize: number
}

export const defaultScanConfig = (): ScanConfig => ({
  roots: ["/"],
  foldedNames: new Set([
    "node_modules",
    ".git",
    ".venv",
    "venv",
    ".build",
    "DerivedData",
    "Pods",
    ".cache",
    "__pycache__",
    ".next",
    ".nuxt",
    ".gradle",
    ".cargo",
    ".npm",
    ".pnpm-store",
  ]),
  prunePaths: new Set([
    "/System",
    "/Volumes",
    "/dev",
    "/net",
    "/home",
    "/cores",
    "/.vol",
    "/private/var/vm",
  ]),
  minFileSize: 1_048_576,
  statWorkers: 8,
})

const FD_CANDIDATES = [
  "/usr/local/bin/fd",
  "/opt/homebrew/bin/fd",
  "/usr/bin/fd",
]

/** fd 是实测最快的遍历器；找不到则报错，由调用方决定回退策略。 */
export const resolveFdBinary = (): string | null => {
  for (const candidate of FD_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  const fromPath = (process.env.PATH ?? "")
    .split(":")
    .map((dir) => path.join(dir, "fd"))
    .find((candidate) => existsSync(candidate))
  return fromPath ?? null
}

const parentOf = (target: string, roots: Set<string>): string => {
  if (roots.has(target)) return ""
  if (target === "/") return ""
  const parent = path.dirname(target)
  return parent
}

const depthOf = (target: string): number => {
  let depth = 1
  for (const char of target) if (char === "/") depth += 1
  return depth
}

/**
 * 用 `fd` 遍历、`xargs -P` 并行 stat 取大小，流式解析输出。
 * 只保留每目录的聚合大小与大于阈值的大文件明细，因此内存与文件总数无关。
 */
export const scanFileSystem = async (
  config: ScanConfig,
  onProgress: (message: string) => void
): Promise<ScanResult> => {
  const fdBinary = resolveFdBinary()
  if (!fdBinary) {
    throw new Error("未找到 fd 可执行文件，请先安装 fd（brew install fd）")
  }

  const roots = new Set(config.roots)
  const searchTargets = expandRoots(config)
  onProgress(`开始扫描 ${searchTargets.length} 个目标目录`)

  const fdProcess = spawn(fdBinary, ["-u", "-0", ".", ...searchTargets], {
    stdio: ["ignore", "pipe", "ignore"],
  })
  const xargsProcess = spawn(
    "/usr/bin/xargs",
    [
      "-0",
      "-P",
      String(config.statWorkers),
      "-n",
      "2000",
      "/usr/bin/stat",
      "-f",
      "%z\t%HT\t%N",
    ],
    { stdio: ["pipe", "pipe", "ignore"] }
  )
  fdProcess.stdout.pipe(xargsProcess.stdin)

  // 必须先挂监听再消费流：等流读完了才挂，close 事件早已错过，await 永远不会返回。
  const fdClosed = new Promise<void>((resolve) => {
    fdProcess.on("close", () => resolve())
  })
  const xargsClosed = new Promise<void>((resolve) => {
    xargsProcess.on("close", () => resolve())
  })

  const ownBytes = new Map<string, number>()
  const dirs = new Set<string>(config.roots)
  for (const root of config.roots) {
    if (root === "/") dirs.add("/")
  }
  const fileRows: ScanEntryRow[] = []
  let fileCount = 0
  let scanned = 0

  const reader = readline.createInterface({
    input: xargsProcess.stdout,
    crlfDelay: Infinity,
  })

  for await (const line of reader) {
    const firstTab = line.indexOf("\t")
    if (firstTab < 0) continue
    const secondTab = line.indexOf("\t", firstTab + 1)
    if (secondTab < 0) continue
    const size = Number(line.slice(0, firstTab))
    const type = line.slice(firstTab + 1, secondTab)
    const target = line.slice(secondTab + 1)
    if (!Number.isFinite(size)) continue

    if (type === "Directory") {
      dirs.add(target)
      continue
    }
    if (type !== "Regular File") continue

    fileCount += 1
    scanned += 1
    if (scanned % 200_000 === 0) onProgress(`已统计 ${scanned} 个文件`)
    const parent = parentOf(target, roots)
    ownBytes.set(parent, (ownBytes.get(parent) ?? 0) + size)
    if (size >= config.minFileSize) {
      fileRows.push({ path: target, parent, kind: "file", size, folded: false })
    }
  }

  await Promise.all([fdClosed, xargsClosed])

  const subtree = accumulateSubtree(dirs, ownBytes)
  const result = buildEntries(config, dirs, subtree, fileRows)
  result.fileCount = fileCount
  onProgress(
    `扫描完成：${result.dirCount} 个目录、${fileCount} 个文件，合计 ${formatBytes(result.totalSize)}`
  )
  return result
}

/** 把根展开为其直接子目录，跳过 prune 路径，避免无谓遍历。 */
const expandRoots = (config: ScanConfig): string[] => {
  const targets: string[] = []
  for (const root of config.roots) {
    let children: string[]
    try {
      children = readdirSync(root)
    } catch {
      targets.push(root)
      continue
    }
    let added = 0
    for (const name of children) {
      const full = path.join(root, name)
      if (config.prunePaths.has(full)) continue
      targets.push(full)
      added += 1
    }
    if (added === 0) targets.push(root)
  }
  return targets
}

const accumulateSubtree = (
  dirs: Set<string>,
  ownBytes: Map<string, number>
): Map<string, number> => {
  const subtree = new Map<string, number>()
  const sorted = [...dirs].sort((left, right) => depthOf(right) - depthOf(left))
  for (const dir of sorted) {
    const total = (subtree.get(dir) ?? 0) + (ownBytes.get(dir) ?? 0)
    subtree.set(dir, total)
    const parent = dir === "/" ? "" : path.dirname(dir)
    if (parent) subtree.set(parent, (subtree.get(parent) ?? 0) + total)
  }
  return subtree
}

const buildEntries = (
  config: ScanConfig,
  dirs: Set<string>,
  subtree: Map<string, number>,
  fileRows: ScanEntryRow[]
): ScanResult => {
  const roots = new Set(config.roots)
  const foldedDirs = new Set<string>()
  for (const dir of dirs) {
    const name = path.basename(dir)
    if (config.foldedNames.has(name)) foldedDirs.add(dir)
  }
  const insideFolded = (target: string): boolean => {
    let current = path.dirname(target)
    while (current !== "/" && current !== ".") {
      if (foldedDirs.has(current)) return true
      current = path.dirname(current)
    }
    return false
  }
  const pruned = (target: string): boolean => {
    for (const prunePath of config.prunePaths) {
      if (target === prunePath || target.startsWith(`${prunePath}/`)) return true
    }
    return false
  }

  const entries: ScanEntryRow[] = []
  let foldedCount = 0
  for (const dir of dirs) {
    if (pruned(dir)) continue
    const folded = foldedDirs.has(dir)
    if (folded) {
      if (insideFolded(dir)) continue
      foldedCount += 1
    } else if (insideFolded(dir)) {
      continue
    }
    entries.push({
      path: dir,
      parent: parentOf(dir, roots),
      kind: "dir",
      size: subtree.get(dir) ?? 0,
      folded,
    })
  }
  for (const row of fileRows) {
    if (pruned(row.path) || insideFolded(row.path)) continue
    entries.push(row)
  }

  let totalSize = 0
  for (const root of config.roots) {
    totalSize += subtree.get(root) ?? 0
  }
  return {
    entries,
    dirCount: entries.filter((entry) => entry.kind === "dir").length,
    fileCount: 0,
    foldedCount,
    totalSize,
  }
}
