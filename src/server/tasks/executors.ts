import {
  DeleteSnapshotsPayloadSchema,
  DISCARD_KIND,
  EntryPathPayloadSchema,
  REVEAL_KIND,
  runDeleteScansTask,
  runRevealEntryTask,
  runScanTask,
  runTrashEntryTask,
  SCAN_KIND,
  ScanPayloadSchema,
  TRASH_KIND,
} from "@server/disk-growth/task"
import {
  FILE_COPY_KIND,
  FILE_CREATE_KIND,
  FILE_DELETE_KIND,
  FILE_MOVE_KIND,
  FILE_RENAME_KIND,
  FILE_WRITE_KIND,
  CreatePayloadSchema as FileCreatePayloadSchema,
  DeletePayloadSchema as FileDeletePayloadSchema,
  RenamePayloadSchema as FileRenamePayloadSchema,
  TransferPayloadSchema as FileTransferPayloadSchema,
  WriteContentPayloadSchema as FileWritePayloadSchema,
  runCopyTask,
  runCreateTask,
  runDeleteTask,
  runMoveTask,
  runRenameTask,
  runWriteContentTask,
} from "@server/files/task"
import { FRP_SAVE_KIND, runSaveFrpTask } from "@server/frp/task"
import {
  runServiceActionTask,
  SERVICE_ACTION_KIND,
} from "@server/system-services/task"
import {
  runDeleteSnapshotsTask,
  runMergeSnapshotsTask,
  runSaveSnapshotTask,
  TRAFFIC_DELETE_KIND,
  TRAFFIC_MERGE_KIND,
  TRAFFIC_SAVE_KIND,
  DeletePayloadSchema as TrafficDeletePayloadSchema,
  MergePayloadSchema as TrafficMergePayloadSchema,
  SavePayloadSchema as TrafficSavePayloadSchema,
} from "@server/traffic/task"
import type { TaskProgress } from "@shared/api-contract"

export type TaskExecutorOutcome = {
  result: unknown
  message?: string | null
  status?: "done" | "partial"
}

export type TaskExecutorContext = {
  /** 上报真实进度：只统计已经确认完成的处理动作。 */
  report: (progress: TaskProgress) => void
}

/**
 * 子进程侧的任务实现。父进程只按 kind 在前述注册表里查表，
 * 载荷不能指定模块、命令或 shell 片段。
 */
export type TaskExecutor = {
  kind: string
  run: (
    payload: unknown,
    context: TaskExecutorContext
  ) => Promise<TaskExecutorOutcome>
}

/** 文件操作进度映射到任务进度；总量不预先统计，因此 total 为 null。 */
const toTaskProgressOf = (progress: {
  done: number
  total: number | null
  bytesDone: number
  stage: string
  currentTarget: string | null
}): TaskProgress => ({
  done: progress.done,
  total: progress.total,
  bytesDone: progress.bytesDone,
  bytesTotal: null,
  stage: progress.stage,
  currentTarget: progress.currentTarget,
})

export type TaskExecutorRegistry = {
  get: (kind: string) => TaskExecutor | null
  kinds: () => string[]
}

export const createExecutorRegistry = (
  executors: TaskExecutor[]
): TaskExecutorRegistry => {
  const map = new Map(executors.map((executor) => [executor.kind, executor]))
  return {
    get: (kind) => map.get(kind) ?? null,
    kinds: () => [...map.keys()],
  }
}

/**
 * 各域的实现按接入顺序登记在这里；未登记的 kind 直接报错。
 * 载荷必须先按该种类自己的 schema 校验，再交给实现。
 */
export const taskExecutors: TaskExecutor[] = [
  {
    kind: SCAN_KIND,
    run: async (payload, context) => {
      const parsed = ScanPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("扫描任务载荷非法")
      const outcome = await runScanTask({
        root: parsed.data.root,
        report: context.report,
      })
      return {
        result: outcome.result,
        message: outcome.message,
        // 有不可读项时如实报部分完成，不报成完整成功。
        status: outcome.incomplete ? "partial" : "done",
      }
    },
  },
  {
    kind: REVEAL_KIND,
    run: async (payload, context) => {
      const parsed = EntryPathPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("访达定位载荷非法")
      const outcome = await runRevealEntryTask({
        path: parsed.data.path,
        report: context.report,
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
  {
    kind: TRASH_KIND,
    run: async (payload, context) => {
      const parsed = EntryPathPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("移到废纸篓载荷非法")
      const outcome = await runTrashEntryTask({
        path: parsed.data.path,
        report: context.report,
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
  {
    kind: SERVICE_ACTION_KIND,
    run: async (payload, context) => {
      const outcome = await runServiceActionTask({
        payload,
        report: context.report,
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
  {
    kind: FILE_CREATE_KIND,
    run: async (payload, context) => {
      const parsed = FileCreatePayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("新建条目载荷非法")
      const outcome = await runCreateTask({
        kind: parsed.data.kind,
        parentPath: parsed.data.parentPath,
        name: parsed.data.name,
        report: (progress) => context.report(toTaskProgressOf(progress)),
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
  {
    kind: FILE_RENAME_KIND,
    run: async (payload, context) => {
      const parsed = FileRenamePayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("重命名载荷非法")
      const outcome = await runRenameTask({
        path: parsed.data.path,
        name: parsed.data.name,
        report: (progress) => context.report(toTaskProgressOf(progress)),
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
  {
    kind: FILE_WRITE_KIND,
    run: async (payload, context) => {
      const parsed = FileWritePayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("保存内容载荷非法")
      const outcome = await runWriteContentTask({
        path: parsed.data.path,
        content: parsed.data.content,
        report: (progress) => context.report(toTaskProgressOf(progress)),
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
  {
    kind: FRP_SAVE_KIND,
    run: async (payload, context) => {
      const outcome = await runSaveFrpTask({
        payload,
        report: context.report,
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
  {
    kind: DISCARD_KIND,
    run: async (payload, context) => {
      const parsed = DeleteSnapshotsPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("删除快照任务载荷非法")
      const outcome = await runDeleteScansTask({
        scanIds: parsed.data.scanIds,
        report: context.report,
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
  {
    kind: FILE_DELETE_KIND,
    run: async (payload, context) => {
      const parsed = FileDeletePayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("删除文件载荷非法")
      const outcome = await runDeleteTask({
        paths: parsed.data.paths,
        report: (progress) => context.report(toTaskProgressOf(progress)),
      })
      return {
        result: outcome.result,
        message: outcome.message,
        status: outcome.partial ? "partial" : "done",
      }
    },
  },
  {
    kind: FILE_COPY_KIND,
    run: async (payload, context) => {
      const parsed = FileTransferPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("复制文件载荷非法")
      const outcome = await runCopyTask({
        paths: parsed.data.paths,
        destPath: parsed.data.destPath,
        report: (progress) => context.report(toTaskProgressOf(progress)),
      })
      return {
        result: outcome.result,
        message: outcome.message,
        status: outcome.partial ? "partial" : "done",
      }
    },
  },
  {
    kind: FILE_MOVE_KIND,
    run: async (payload, context) => {
      const parsed = FileTransferPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("移动文件载荷非法")
      const outcome = await runMoveTask({
        paths: parsed.data.paths,
        destPath: parsed.data.destPath,
        report: (progress) => context.report(toTaskProgressOf(progress)),
      })
      return {
        result: outcome.result,
        message: outcome.message,
        status: outcome.partial ? "partial" : "done",
      }
    },
  },
  {
    kind: TRAFFIC_SAVE_KIND,
    run: async (payload, context) => {
      const parsed = TrafficSavePayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("保存快照载荷非法")
      const outcome = await runSaveSnapshotTask({
        savedBy: parsed.data.savedBy,
        report: context.report,
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
  {
    kind: TRAFFIC_MERGE_KIND,
    run: async (payload, context) => {
      const parsed = TrafficMergePayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("合并快照载荷非法")
      const outcome = await runMergeSnapshotsTask({
        ids: parsed.data.ids,
        report: context.report,
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
  {
    kind: TRAFFIC_DELETE_KIND,
    run: async (payload, context) => {
      const parsed = TrafficDeletePayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("删除快照载荷非法")
      const outcome = await runDeleteSnapshotsTask({
        ids: parsed.data.ids,
        report: context.report,
      })
      return { result: outcome.result, message: outcome.message }
    },
  },
]
