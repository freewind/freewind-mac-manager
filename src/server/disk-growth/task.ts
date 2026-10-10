import { DATABASE_FILE } from "@server/env"
import {
  type ScanTaskResult,
  TASK_KINDS,
  type TaskProgress,
} from "@shared/api-contract"
import {
  fileRevealTaskTarget,
  fileTaskTarget,
  scanTaskTarget,
} from "@shared/task-targets"
import { z } from "zod"
import { moveToTrash, revealInFinder } from "./file-actions.ts"
import {
  defaultScanConfig,
  type ScanConfig,
  type ScanProgress,
  type ScanResult,
  scanFileSystem,
} from "./scanner"
import { DiskGrowthStore } from "./store"

export const SCAN_KIND = TASK_KINDS.diskScan

/** 每日自动扫描与手动扫描共用同一把锁（scanTaskTarget("/")）。 */
export { scanTaskTarget }

export const DISCARD_KIND = TASK_KINDS.diskSnapshotDelete
export const REVEAL_KIND = TASK_KINDS.diskEntryReveal
export const TRASH_KIND = TASK_KINDS.diskEntryTrash

/** 访达与废纸篓只接受一个绝对路径，不接受命令或参数。 */
export const EntryPathPayloadSchema = z.object({
  path: z.string().min(1),
})

/** 文件改动操作共用互斥键；仅访达定位使用独立、只读的目标键。 */
export {
  fileRevealTaskTarget as revealEntryTarget,
  fileTaskTarget as entryTaskTarget,
}

export const runRevealEntryTask = async (options: {
  path: string
  report: (progress: TaskProgress) => void
}): Promise<{ result: { message: string }; message: string }> => {
  options.report({
    done: 0,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: "在访达中显示",
    currentTarget: options.path,
  })
  const message = await revealInFinder(options.path)
  options.report({
    done: 1,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: "完成",
    currentTarget: null,
  })
  return { result: { message }, message }
}

export const runTrashEntryTask = async (options: {
  path: string
  report: (progress: TaskProgress) => void
}): Promise<{ result: { message: string }; message: string }> => {
  options.report({
    done: 0,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: "移到废纸篓",
    currentTarget: options.path,
  })
  const message = await moveToTrash(options.path)
  options.report({
    done: 1,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: "完成",
    currentTarget: null,
  })
  return { result: { message }, message }
}

export const DeleteSnapshotsPayloadSchema = z.object({
  scanIds: z.array(z.number().int().positive()).min(1).max(200),
})

/**
 * 删除若干份快照：明细与快照在同一事务里删掉，避免留下孤儿明细。
 * 进度按真实处理的份数上报。
 */
export const runDeleteScansTask = async (options: {
  scanIds: number[]
  report: (progress: TaskProgress) => void
  databaseFile?: string
}): Promise<{ result: { removed: number }; message: string }> => {
  const store = new DiskGrowthStore(options.databaseFile ?? DATABASE_FILE)
  try {
    options.report({
      done: 0,
      total: options.scanIds.length,
      bytesDone: null,
      bytesTotal: null,
      stage: "删除快照",
      currentTarget: null,
    })
    const removed = store.deleteSnapshots(options.scanIds)
    options.report({
      done: options.scanIds.length,
      total: options.scanIds.length,
      bytesDone: null,
      bytesTotal: null,
      stage: "完成",
      currentTarget: null,
    })
    return {
      result: { removed },
      message:
        removed === 0
          ? "指定的快照已不存在"
          : `已删除 ${removed} 份快照，相邻快照的差值已自动跨过被删区间`,
    }
  } finally {
    store.close()
  }
}

const toTaskProgress = (progress: ScanProgress): TaskProgress => ({
  done: progress.files,
  // 全盘文件总数无法预先得知，因此总量为 null；不伪造百分比。
  total: null,
  bytesDone: progress.bytes,
  bytesTotal: null,
  stage: `${progress.stage}（${progress.dirs} 个目录）`,
  currentTarget: progress.currentTarget,
})

/** 执行器入参：只接受扫描根，不接受任何模块、命令或 shell 片段。 */
export const ScanPayloadSchema = z.object({ root: z.string().min(1) })

export type ScanOutcome = {
  result: ScanTaskResult
  message: string
  /** 有不可读项：扫描做完了，但结果可能不完整。 */
  incomplete: boolean
}

/**
 * 在后台执行器里跑一次全盘扫描并落库。
 *
 * 进度只来自扫描器已确认处理的数量；写库在同一个执行器里完成，父进程不会被
 * 同步 sqlite 阻塞。只有快照写入成功后才返回结果，失败则整体报错。
 */
export const runScanTask = async (options: {
  root: string
  report: (progress: TaskProgress) => void
  /**
   * 依赖注入点：默认是真实全盘扫描与真实数据库。
   * 测试据此使用受控扫描结果与临时库，不触碰真实磁盘与真实记录。
   */
  scan?: (
    config: ScanConfig,
    onProgress: (progress: ScanProgress) => void
  ) => Promise<ScanResult>
  config?: ScanConfig
  databaseFile?: string
}): Promise<ScanOutcome> => {
  const store = new DiskGrowthStore(options.databaseFile ?? DATABASE_FILE)
  const scan = options.scan ?? scanFileSystem
  const startedAt = Date.now() / 1000
  try {
    const result = await scan(
      options.config ?? defaultScanConfig(),
      (progress) => {
        options.report(toTaskProgress(progress))
      }
    )

    options.report({
      done: result.fileCount,
      total: null,
      bytesDone: result.totalSize,
      bytesTotal: null,
      stage: "写入快照",
      currentTarget: null,
    })

    const snapshotId = store.insertSnapshot(result, {
      startedAt,
      finishedAt: Date.now() / 1000,
      root: options.root,
    })
    store.pruneSnapshots(KEEP_SNAPSHOTS)

    const scope = `${result.dirCount} 个目录、${result.fileCount} 个文件`
    return {
      result: {
        snapshotId,
        fileCount: result.fileCount,
        dirCount: result.dirCount,
        totalSize: result.totalSize,
      },
      message: result.incomplete
        ? `已生成快照 #${snapshotId}（${scope}）；部分内容无法读取，结果可能不完整`
        : `已生成快照 #${snapshotId}（${scope}）`,
      incomplete: result.incomplete,
    }
  } finally {
    store.close()
  }
}

/** 与 service 保持同一份保留策略，避免两处数字漂移。 */
export const KEEP_SNAPSHOTS = 90
