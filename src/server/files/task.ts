import { type FileBatchResult, TASK_KINDS } from "@shared/api-contract"
import { FileBatchResultSchema } from "@shared/api-contract/schemas/files"
import { fileTaskTarget } from "@shared/task-targets"
import { z } from "zod"
import {
  copyEntries,
  deleteEntries,
  type FileBatchOutcome,
  type FileOperationProgress,
  moveEntries,
} from "./service"

export const FILE_COPY_KIND = TASK_KINDS.fileCopy
export const FILE_DELETE_KIND = TASK_KINDS.fileDelete
export const FILE_MOVE_KIND = TASK_KINDS.fileMove

/** 与端点共用同一把路径锁，避免复制/删除/移动与创建改名互相踩。 */
export { fileTaskTarget }

/**
 * 执行器入参：只接受路径与目标目录，不接受模块、命令或 shell 片段。
 * 路径安全由 service 的既有校验负责（范围、符号链接、目标变化）。
 */
export const DeletePayloadSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(64),
})
export const TransferPayloadSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(64),
  destPath: z.string().min(1),
})

const toResult = (outcome: FileBatchOutcome): FileBatchResult =>
  FileBatchResultSchema.parse(outcome)

const toReport =
  (report: (progress: FileOperationProgress) => void) =>
  (progress: FileOperationProgress): void =>
    report(progress)

export const runDeleteTask = async (options: {
  paths: string[]
  report: (progress: FileOperationProgress) => void
}): Promise<{ result: FileBatchResult; message: string; partial: boolean }> => {
  const outcome = await deleteEntries(options.paths, {
    report: toReport(options.report),
  })
  return {
    result: toResult(outcome),
    message:
      outcome.failed.length === 0
        ? `已删除 ${outcome.completed.length} 项`
        : `已删除 ${outcome.completed.length} 项，${outcome.failed.length} 项失败`,
    partial: outcome.failed.length > 0,
  }
}

export const runCopyTask = async (options: {
  paths: string[]
  destPath: string
  report: (progress: FileOperationProgress) => void
}): Promise<{ result: FileBatchResult; message: string; partial: boolean }> => {
  const outcome = await copyEntries(options.paths, options.destPath, {
    report: toReport(options.report),
  })
  return {
    result: toResult(outcome),
    message:
      outcome.failed.length === 0
        ? `已复制 ${outcome.completed.length} 项`
        : `已复制 ${outcome.completed.length} 项，${outcome.failed.length} 项失败`,
    partial: outcome.failed.length > 0,
  }
}

export const runMoveTask = async (options: {
  paths: string[]
  destPath: string
  report: (progress: FileOperationProgress) => void
}): Promise<{ result: FileBatchResult; message: string; partial: boolean }> => {
  const outcome = await moveEntries(options.paths, options.destPath, {
    report: toReport(options.report),
  })
  return {
    result: toResult(outcome),
    message:
      outcome.failed.length === 0
        ? `已移动 ${outcome.completed.length} 项`
        : `已移动 ${outcome.completed.length} 项，${outcome.failed.length} 项失败`,
    partial: outcome.failed.length > 0,
  }
}
