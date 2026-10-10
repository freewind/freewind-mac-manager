import { DATABASE_FILE } from "@server/env"
import type { ScanTaskResult, TaskProgress } from "@shared/api-contract"
import { scanTaskTarget } from "@shared/task-targets"
import { z } from "zod"
import {
  defaultScanConfig,
  type ScanConfig,
  type ScanProgress,
  type ScanResult,
  scanFileSystem,
} from "./scanner"
import { DiskGrowthStore } from "./store"

export const SCAN_KIND = "disk_scan"

/** 每日自动扫描与手动扫描共用同一把锁（scanTaskTarget("/")）。 */
export { scanTaskTarget }

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
