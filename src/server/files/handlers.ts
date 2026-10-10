import path from "node:path"
import { toTaskHttpResponse } from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import type { ActionResponse, FileBatchResult } from "@shared/api-contract"
import { contract, TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import { ActionResponseSchema } from "@shared/api-contract/schemas/common"
import { FileBatchResultSchema } from "@shared/api-contract/schemas/files"
import { ApiPath } from "@shared/api-path"
import { initServer } from "@ts-rest/express"
import type express from "express"
import { z } from "zod"
import {
  describeFileError,
  listDirectory,
  openDownload,
  readFileContent,
  receiveUpload,
} from "./service"

/** 与批量任务一致的目录作用域：取条目所在目录。 */
const dirnameOf = (target: string): string => path.dirname(target)

import {
  FILE_COPY_KIND,
  FILE_CREATE_KIND,
  FILE_DELETE_KIND,
  FILE_MOVE_KIND,
  FILE_RENAME_KIND,
  FILE_WRITE_KIND,
  fileDirectoryTarget,
  fileMutationLockTarget,
  fileTaskTarget,
} from "./task"

const s = initServer()

/** 只挑本功能的路由注册；app.ts 负责与其它功能合并。 */
export const filesContract = {
  listDirectory: contract.listDirectory,
  createDirectory: contract.createDirectory,
  createFile: contract.createFile,
  renameEntry: contract.renameEntry,
  deleteEntries: contract.deleteEntries,
  copyEntries: contract.copyEntries,
  moveEntries: contract.moveEntries,
  readFileContent: contract.readFileContent,
  writeFileContent: contract.writeFileContent,
  downloadFile: contract.downloadFile,
}

const toError = (error: unknown) => ({
  status: 400 as const,
  body: { message: describeFileError(error) },
})

/**
 * 批量操作统一提交任务：完成结果必须通过契约校验才能作为 200 返回，
 * 未完成返回 202，冲突 409，真实失败 500。
 */
const submitFileTask = async (
  runtime: TaskRuntime,
  options: {
    kind: string
    payload: unknown
    requestId: string
  }
) => {
  try {
    const outcome = await runtime.runner.submit<FileBatchResult>({
      kind: options.kind,
      target: fileTaskTarget(pathsOfPayload(options.payload)),
      lockTarget: fileMutationLockTarget(),
      payload: options.payload,
      requestId: options.requestId,
      toCompletedResponse: (result) => {
        const parsed = FileBatchResultSchema.safeParse(result.result)
        if (!parsed.success) {
          throw new Error("文件操作结果不符合契约，无法作为完成结果返回")
        }
        return { status: 200, body: parsed.data }
      },
    })
    return toTaskHttpResponse(outcome, 200)
  } catch (error) {
    return toError(error)
  }
}

/**
 * 单个条目的写操作（新建、改名、保存内容）也走任务：
 * 展示目标保留所在目录，互斥使用文件域共享的锁键。
 */
const submitEntryTask = async (
  runtime: TaskRuntime,
  options: {
    kind: string
    payload: unknown
    target: string
    requestId: string
  }
) => {
  try {
    const outcome = await runtime.runner.submit<ActionResponse>({
      kind: options.kind,
      target: options.target,
      lockTarget: fileMutationLockTarget(),
      payload: options.payload,
      requestId: options.requestId,
      toCompletedResponse: (result) => {
        const parsed = ActionResponseSchema.safeParse(result.result)
        if (!parsed.success) {
          throw new Error("操作结果不符合契约，无法作为完成结果返回")
        }
        return { status: 200, body: parsed.data }
      },
    })
    return toTaskHttpResponse(outcome, 200)
  } catch (error) {
    return toError(error)
  }
}

/** 展示目标来自载荷里的路径集合，键序无关；冲突由独立 lock target 判定。 */
const pathsOfPayload = (payload: unknown): string[] => {
  const parsed = z
    .object({
      paths: z.array(z.string()).optional(),
      destPath: z.string().optional(),
    })
    .safeParse(payload)
  if (!parsed.success) return ["unknown"]
  return [...(parsed.data.paths ?? []), parsed.data.destPath ?? ""].filter(
    Boolean
  )
}

export const createFilesRouter = (runtime: TaskRuntime) =>
  s.router(filesContract, {
    listDirectory: async ({ query }) => {
      try {
        return { status: 200 as const, body: await listDirectory(query.path) }
      } catch (error) {
        return toError(error)
      }
    },

    createDirectory: async ({ headers, body }) =>
      submitEntryTask(runtime, {
        kind: FILE_CREATE_KIND,
        payload: { kind: "dir", parentPath: body.parentPath, name: body.name },
        target: fileDirectoryTarget(body.parentPath),
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    createFile: async ({ headers, body }) =>
      submitEntryTask(runtime, {
        kind: FILE_CREATE_KIND,
        payload: { kind: "file", parentPath: body.parentPath, name: body.name },
        target: fileDirectoryTarget(body.parentPath),
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    renameEntry: async ({ headers, body }) =>
      submitEntryTask(runtime, {
        kind: FILE_RENAME_KIND,
        payload: { path: body.path, name: body.name },
        target: fileDirectoryTarget(dirnameOf(body.path)),
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    deleteEntries: async ({ headers, query }) =>
      submitFileTask(runtime, {
        kind: FILE_DELETE_KIND,
        payload: { paths: query.paths },
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    copyEntries: async ({ headers, body }) =>
      submitFileTask(runtime, {
        kind: FILE_COPY_KIND,
        payload: { paths: body.paths, destPath: body.destPath },
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    moveEntries: async ({ headers, body }) =>
      submitFileTask(runtime, {
        kind: FILE_MOVE_KIND,
        payload: { paths: body.paths, destPath: body.destPath },
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    readFileContent: async ({ query }) => {
      try {
        return { status: 200 as const, body: await readFileContent(query.path) }
      } catch (error) {
        return toError(error)
      }
    },

    writeFileContent: async ({ headers, body }) =>
      submitEntryTask(runtime, {
        kind: FILE_WRITE_KIND,
        payload: { path: body.path, content: body.content },
        target: fileDirectoryTarget(dirnameOf(body.path)),
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    downloadFile: async ({ query, res }) => {
      try {
        const { stream, size, name } = await openDownload(query.path)
        res.setHeader("content-type", "application/octet-stream")
        res.setHeader("content-length", String(size))
        res.setHeader(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
        )
        return { status: 200 as const, body: stream }
      } catch (error) {
        return toError(error)
      }
    },
  })

/**
 * 上传有意不进 ts-rest 契约：ts-rest 的请求 contentType 只支持 json / multipart / urlencoded，
 * 而这里用裸 octet-stream，元数据走 query，便于流式写入与前端进度统计。
 */
export const registerUploadEndpoint = (app: express.Express): void => {
  app.post(ApiPath.filesUploads, async (request, response) => {
    const targetPath =
      typeof request.query.targetPath === "string"
        ? request.query.targetPath
        : ""
    const relativePath =
      typeof request.query.relativePath === "string"
        ? request.query.relativePath
        : ""
    if (!targetPath) {
      response.status(400).json({ message: "缺少 targetPath 参数" })
      return
    }
    const contentLength = Number(request.get("content-length") ?? 0)
    if (contentLength > 512 * 1024 * 1024) {
      response.status(413).json({ message: "上传文件超过 512 MB 限制" })
      return
    }
    request.setTimeout(10 * 60 * 1000, () => request.destroy())
    try {
      const file = await receiveUpload(targetPath, relativePath, request)
      response.status(200).json({ message: "文件已上传", file })
    } catch (error) {
      response.status(400).json({ message: describeFileError(error) })
    }
  })
}
