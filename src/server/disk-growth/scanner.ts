import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import readline from "node:readline"

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
  /**
   * 遍历与批量 stat 的可执行文件。默认用 fd 与 /usr/bin/xargs；
   * 测试注入受控替身，便可以在不扫描真实磁盘的情况下验证解析与进度。
   */
  fdBinary?: string
  xargsBinary?: string
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
  /** 本次扫描遇到过不可读项：结果因此可能不完整，不能报成完整的全盘结果。 */
  incomplete: boolean
}

/** 扫描进度：全部是已经确认处理的真实数量，不是估算。 */
export type ScanProgress = {
  files: number
  dirs: number
  bytes: number
  stage: string
  currentTarget: string | null
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

/** 进度上报的最小间隔：真实数字只在确实处理完一项时增长，这里只限制频率。 */
const PROGRESS_INTERVAL_MS = 1000

/** 全盘遍历的硬上限：fd 卡死时不能永远挂着。 */
const SCAN_TIMEOUT_MS = 30 * 60 * 1000

const createProgressReporter = (
  onProgress: (progress: ScanProgress) => void
) => {
  let lastAt = 0
  let lastStage = ""
  return (progress: ScanProgress, force = false): void => {
    const now = Date.now()
    if (
      !force &&
      progress.stage === lastStage &&
      now - lastAt < PROGRESS_INTERVAL_MS
    ) {
      return
    }
    lastAt = now
    lastStage = progress.stage
    onProgress(progress)
  }
}

/**
 * 用 `fd` 遍历、`xargs -P` 并行 stat 取大小，流式解析输出。
 *
 * 只保留每目录的聚合大小与大于阈值的大文件明细，因此内存与文件总数无关。
 * 每条记录要等下一个有效记录开始（或流结束）才计入统计：文件名里带换行时
 * stat 的输出会被拆成多行，先暂存再提交才能把续行接回同一个条目，不漏不重复。
 */
export const scanFileSystem = async (
  config: ScanConfig,
  onProgress: (progress: ScanProgress) => void
): Promise<ScanResult> => {
  const fdBinary = config.fdBinary ?? resolveFdBinary()
  if (!fdBinary) {
    throw new Error("未找到 fd 可执行文件，请先安装 fd（brew install fd）")
  }

  const roots = new Set(config.roots)
  const searchTargets = expandRoots(config)

  const ownBytes = new Map<string, number>()
  const dirs = new Set<string>(config.roots)
  for (const root of config.roots) {
    if (root === "/") dirs.add("/")
  }
  const fileRows: ScanEntryRow[] = []
  let fileCount = 0
  let totalSeen = 0
  let incomplete = false

  const report = createProgressReporter(onProgress)
  report(
    {
      files: 0,
      dirs: dirs.size,
      bytes: 0,
      stage: `准备中（${searchTargets.length} 个目标目录）`,
      currentTarget: null,
    },
    true
  )

  const fdProcess = spawn(fdBinary, ["-u", "-0", ".", ...searchTargets], {
    stdio: ["ignore", "pipe", "ignore"],
  })
  const xargsProcess = spawn(
    config.xargsBinary ?? "/usr/bin/xargs",
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
  const fdClosed = new Promise<number | null>((resolve) => {
    fdProcess.on("close", (code) => resolve(code))
  })
  const xargsClosed = new Promise<number | null>((resolve) => {
    xargsProcess.on("close", (code) => resolve(code))
  })

  let failure: Error | null = null
  const fail = (error: Error): void => {
    failure ??= error
    fdProcess.kill("SIGTERM")
    xargsProcess.kill("SIGTERM")
  }
  fdProcess.on("error", (error) =>
    fail(new Error(`无法启动 fd：${error.message}`))
  )
  xargsProcess.on("error", (error) =>
    fail(new Error(`无法启动 xargs：${error.message}`))
  )

  const timeout = setTimeout(() => {
    fail(
      new Error(
        `扫描超过 ${Math.round(SCAN_TIMEOUT_MS / 60000)} 分钟仍未结束，已中止`
      )
    )
  }, SCAN_TIMEOUT_MS)
  // 这个计时器不能把进程钉住；真正让事件循环活着的是两个子进程。
  timeout.unref?.()

  type Pending = { size: number; type: string; path: string }
  let pending: Pending | null = null

  /** 只有提交时才增长数字：进度因此不会虚增。 */
  const commit = (row: Pending): void => {
    if (row.type === "Directory") {
      dirs.add(row.path)
      return
    }
    // 只统计普通文件：符号链接、设备节点等不计入大小，避免重复计算。
    if (row.type !== "Regular File") return

    const parent = parentOf(row.path, roots)
    fileCount += 1
    totalSeen += row.size
    ownBytes.set(parent, (ownBytes.get(parent) ?? 0) + row.size)
    if (row.size >= config.minFileSize) {
      fileRows.push({
        path: row.path,
        parent,
        kind: "file",
        size: row.size,
        folded: false,
      })
    }
    report({
      files: fileCount,
      dirs: dirs.size,
      bytes: totalSeen,
      stage: "统计文件",
      currentTarget: row.path,
    })
  }

  const reader = readline.createInterface({
    input: xargsProcess.stdout,
    crlfDelay: Infinity,
  })

  for await (const line of reader) {
    const firstTab = line.indexOf("\t")
    const secondTab = firstTab < 0 ? -1 : line.indexOf("\t", firstTab + 1)
    const size = firstTab < 0 ? Number.NaN : Number(line.slice(0, firstTab))

    if (firstTab < 0 || secondTab < 0 || !Number.isFinite(size)) {
      // 文件名里带换行时这行是上一条记录的续行；没有上一条就当场丢掉。
      if (pending) pending.path += `\n${line}`
      continue
    }
    if (pending) commit(pending)
    pending = {
      size,
      type: line.slice(firstTab + 1, secondTab),
      path: line.slice(secondTab + 1),
    }
  }
  if (pending) commit(pending)

  const [fdCode, xargsCode] = await Promise.all([fdClosed, xargsClosed])
  clearTimeout(timeout)

  if (failure) throw failure
  if (fdCode !== 0) {
    throw new Error(`文件遍历失败（fd 退出码 ${fdCode}），结果不完整`)
  }
  // xargs 在单个 stat 失败（权限不足、文件刚被移走）时返回非零，遍历本身没有失败：
  // 如实标记为不完整，不假装这是一份完整的全盘结果。
  if (xargsCode !== 0) incomplete = true
  if (fileCount === 0) {
    throw new Error("没有统计到任何文件，结果不可信")
  }

  report(
    {
      files: fileCount,
      dirs: dirs.size,
      bytes: totalSeen,
      stage: "汇总目录",
      currentTarget: null,
    },
    true
  )

  const subtree = accumulateSubtree(dirs, ownBytes)
  const result = buildEntries(config, dirs, subtree, fileRows)
  result.fileCount = fileCount
  result.incomplete = incomplete
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
      if (target === prunePath || target.startsWith(`${prunePath}/`))
        return true
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
    incomplete: false,
  }
}
