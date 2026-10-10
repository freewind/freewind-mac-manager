import {
  type SnapshotMutationResult,
  type SnapshotSaveResult,
  TASK_KINDS,
} from "@shared/api-contract"
import { trafficSnapshotTaskTarget } from "@shared/task-targets"
import { z } from "zod"
import {
  captureSnapshot,
  deleteSnapshots,
  mergeSnapshots,
  type TrafficReport,
} from "./service"
import type { TrafficStore } from "./store"

export const TRAFFIC_SAVE_KIND = TASK_KINDS.trafficSnapshotSave
export const TRAFFIC_MERGE_KIND = TASK_KINDS.trafficSnapshotMerge
export const TRAFFIC_DELETE_KIND = TASK_KINDS.trafficSnapshotDelete

/**
 * 三种写操作共用一把域级锁：它们互相依赖同一份增量链，
 * 同时执行会让区间与明细互相覆盖。
 */
export const trafficTaskTarget = trafficSnapshotTaskTarget

/** 执行器入参：只接受标识与开关，不接受模块、命令或 shell 片段。 */
export const SavePayloadSchema = z.object({
  savedBy: z.enum(["manual", "scheduled"]),
})
export const MergePayloadSchema = z.object({ ids: z.array(z.string()).min(2) })
export const DeletePayloadSchema = z.object({ ids: z.array(z.string()).min(1) })

export const runSaveSnapshotTask = async (options: {
  savedBy: "manual" | "scheduled"
  report: TrafficReport
  /** 依赖注入点：默认用真实库，测试用临时库。 */
  store?: TrafficStore
}): Promise<{ result: SnapshotSaveResult; message: string }> => {
  const outcome = await captureSnapshot(options.savedBy, {
    report: options.report,
    store: options.store,
  })
  return {
    result: outcome,
    message: `已保存快照 ${outcome.rangeText}`,
  }
}

export const runMergeSnapshotsTask = async (options: {
  ids: string[]
  report: TrafficReport
  store?: TrafficStore
}): Promise<{ result: SnapshotMutationResult; message: string }> => {
  const snapshotIds = await mergeSnapshots(options.ids, {
    report: options.report,
    store: options.store,
  })
  return {
    result: { snapshotIds },
    message: `已把 ${options.ids.length} 份快照合并成一份`,
  }
}

export const runDeleteSnapshotsTask = async (options: {
  ids: string[]
  report: TrafficReport
  store?: TrafficStore
}): Promise<{ result: SnapshotMutationResult; message: string }> => {
  const snapshotIds = await deleteSnapshots(options.ids, {
    report: options.report,
    store: options.store,
  })
  return {
    result: { snapshotIds },
    message: `已删除 ${options.ids.length} 份快照，受影响的后继快照已重新计算`,
  }
}
