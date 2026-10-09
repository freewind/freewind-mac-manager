import { DATABASE_FILE } from "@server/env"
import type { ScanStatus } from "@shared/api-contract"
import { describeError } from "@shared/format"
import { defaultScanConfig, scanFileSystem } from "./scanner"
import { DiskGrowthStore } from "./store"

const KEEP_SNAPSHOTS = 90
/** 每日自动扫描时刻（本地时间）。 */
export const SCHEDULED_HOUR = 6

const store = new DiskGrowthStore(DATABASE_FILE)

let state: ScanStatus = {
  running: false,
  phase: "尚未扫描",
  startedAt: null,
  finishedAt: null,
  scannedEntries: 0,
  lastError: null,
}

export const diskGrowthStore = store

export const getScanStatus = (): ScanStatus => ({ ...state })

export const startScan = (): { started: boolean; message: string } => {
  if (state.running) {
    return { started: false, message: "已有扫描正在进行中" }
  }
  state = {
    running: true,
    phase: "准备中",
    startedAt: Date.now() / 1000,
    finishedAt: null,
    scannedEntries: 0,
    lastError: null,
  }
  void runScan()
  return { started: true, message: "扫描已开始" }
}

const runScan = async (): Promise<void> => {
  const startedAt = state.startedAt ?? Date.now() / 1000
  try {
    const result = await scanFileSystem(defaultScanConfig(), (phase) => {
      state.phase = phase
    })
    state.phase = "写入快照"
    const finishedAt = Date.now() / 1000
    const scanId = store.insertSnapshot(result, {
      startedAt,
      finishedAt,
      root: "/",
    })
    store.pruneSnapshots(KEEP_SNAPSHOTS)
    state = {
      running: false,
      phase: `扫描完成，快照 #${scanId}`,
      startedAt,
      finishedAt,
      scannedEntries: result.fileCount,
      lastError: null,
    }
  } catch (error) {
    state = {
      ...state,
      running: false,
      phase: "扫描失败",
      finishedAt: Date.now() / 1000,
      lastError: describeError(error),
    }
  }
}

/** 等到下一个 6:00 执行扫描，完成后继续排下一次。 */
export const startScheduler = (): void => {
  const scheduleNext = (): void => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(SCHEDULED_HOUR, 0, 0, 0)
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1)
    }
    const delay = next.getTime() - now.getTime()
    console.log(
      `[mac-manager] 下次自动扫描：${next.toLocaleString("zh-CN")}（${Math.round(delay / 1000)} 秒后）`
    )
    setTimeout(() => {
      startScan()
      scheduleNext()
    }, delay)
  }
  scheduleNext()
}
