import { type FileBatchResult, TASK_KINDS } from "@shared/api-contract"
import { FileBatchResultSchema } from "@shared/api-contract/schemas/files"
import {
  fileDirectoryTarget,
  fileMutationLockTarget,
  fileTaskTarget,
} from "@shared/task-targets"
import { z } from "zod"
import {
  copyEntries,
  createDirectory,
  createFile,
  deleteEntries,
  type FileBatchOutcome,
  type FileOperationProgress,
  moveEntries,
  renameEntry,
  writeFileContent,
} from "./service"

export const FILE_COPY_KIND = TASK_KINDS.fileCopy
export const FILE_DELETE_KIND = TASK_KINDS.fileDelete
export const FILE_MOVE_KIND = TASK_KINDS.fileMove
export const FILE_CREATE_KIND = TASK_KINDS.fileCreate
export const FILE_RENAME_KIND = TASK_KINDS.fileRename
export const FILE_WRITE_KIND = TASK_KINDS.fileWriteContent

/** 文件写操作共用域级互斥键，覆盖不同路径表示的重叠目标。 */
export { fileDirectoryTarget, fileMutationLockTarget, fileTaskTarget }

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

/** 新建（目录或文件）执行器载荷。 */
export const CreatePayloadSchema = z.object({
  kind: z.enum(["dir", "file"]),
  parentPath: z.string(),
  name: z.string().min(1),
})

export const RenamePayloadSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
})

export const WriteContentPayloadSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(2 * 1024 * 1024),
})

export const runCreateTask = async (options: {
  kind: "dir" | "file"
  parentPath: string
  name: string
  report: (progress: FileOperationProgress) => void
}): Promise<{ result: { message: string }; message: string }> => {
  options.report({
    done: 0,
    total: 1,
    bytesDone: 0,
    stage: options.kind === "dir" ? "新建文件夹" : "新建文件",
    currentTarget: null,
  })
  if (options.kind === "dir") {
    await createDirectory(options.parentPath, options.name)
  } else {
    await createFile(options.parentPath, options.name)
  }
  options.report({
    done: 1,
    total: 1,
    bytesDone: 0,
    stage: "完成",
    currentTarget: null,
  })
  const message =
    options.kind === "dir"
      ? `已新建文件夹：${options.name}`
      : `已新建文件：${options.name}`
  return { result: { message }, message }
}

export const runRenameTask = async (options: {
  path: string
  name: string
  report: (progress: FileOperationProgress) => void
}): Promise<{ result: { message: string }; message: string }> => {
  options.report({
    done: 0,
    total: 1,
    bytesDone: 0,
    stage: "重命名",
    currentTarget: options.path,
  })
  await renameEntry(options.path, options.name)
  options.report({
    done: 1,
    total: 1,
    bytesDone: 0,
    stage: "完成",
    currentTarget: null,
  })
  return {
    result: { message: `已重命名为：${options.name}` },
    message: `已重命名为：${options.name}`,
  }
}

export const runWriteContentTask = async (options: {
  path: string
  content: string
  report: (progress: FileOperationProgress) => void
}): Promise<{ result: { message: string }; message: string }> => {
  const bytes = Buffer.byteLength(options.content, "utf8")
  options.report({
    done: 0,
    total: 1,
    bytesDone: 0,
    stage: "保存内容",
    currentTarget: options.path,
  })
  await writeFileContent(options.path, options.content)
  options.report({
    done: 1,
    total: 1,
    bytesDone: bytes,
    stage: "完成",
    currentTarget: null,
  })
  return { result: { message: "文件已保存" }, message: "文件已保存" }
}

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
      outcome.failed.length === 0 && (outcome.partial?.length ?? 0) === 0
        ? `已删除 ${outcome.completed.length} 项`
        : `已删除 ${outcome.completed.length} 项，${outcome.failed.length + (outcome.partial?.length ?? 0)} 项需要核实`,
    partial: outcome.failed.length > 0 || (outcome.partial?.length ?? 0) > 0,
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
      outcome.failed.length === 0 && (outcome.partial?.length ?? 0) === 0
        ? `已复制 ${outcome.completed.length} 项`
        : `已复制 ${outcome.completed.length} 项，${outcome.failed.length + (outcome.partial?.length ?? 0)} 项需要核实`,
    partial: outcome.failed.length > 0 || (outcome.partial?.length ?? 0) > 0,
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
      outcome.failed.length === 0 && (outcome.partial?.length ?? 0) === 0
        ? `已移动 ${outcome.completed.length} 项`
        : `已移动 ${outcome.completed.length} 项，${outcome.failed.length + (outcome.partial?.length ?? 0)} 项需要核实`,
    partial: outcome.failed.length > 0 || (outcome.partial?.length ?? 0) > 0,
  }
}
