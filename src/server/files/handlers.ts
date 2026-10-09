import { contract } from "@shared/api-contract"
import { ApiPath } from "@shared/api-path"
import { initServer } from "@ts-rest/express"
import type express from "express"
import {
  copyEntries,
  createDirectory,
  createFile,
  deleteEntries,
  describeFileError,
  listDirectory,
  moveEntries,
  openDownload,
  readFileContent,
  receiveUpload,
  renameEntry,
  writeFileContent,
} from "./service"

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

export const filesRouter = s.router(filesContract, {
  listDirectory: async ({ query }) => {
    try {
      return { status: 200 as const, body: await listDirectory(query.path) }
    } catch (error) {
      return toError(error)
    }
  },

  createDirectory: async ({ body }) => {
    try {
      await createDirectory(body.parentPath, body.name)
      return { status: 200 as const, body: { message: "目录已创建" } }
    } catch (error) {
      return toError(error)
    }
  },

  createFile: async ({ body }) => {
    try {
      await createFile(body.parentPath, body.name)
      return { status: 200 as const, body: { message: "文件已创建" } }
    } catch (error) {
      return toError(error)
    }
  },

  renameEntry: async ({ body }) => {
    try {
      await renameEntry(body.path, body.name)
      return { status: 200 as const, body: { message: "条目已重命名" } }
    } catch (error) {
      return toError(error)
    }
  },

  deleteEntries: async ({ query }) => {
    try {
      await deleteEntries(query.paths)
      return { status: 200 as const, body: { message: "条目已删除" } }
    } catch (error) {
      return toError(error)
    }
  },

  copyEntries: async ({ body }) => {
    try {
      await copyEntries(body.paths, body.destPath)
      return { status: 200 as const, body: { message: "条目已复制" } }
    } catch (error) {
      return toError(error)
    }
  },

  moveEntries: async ({ body }) => {
    try {
      await moveEntries(body.paths, body.destPath)
      return { status: 200 as const, body: { message: "条目已移动" } }
    } catch (error) {
      return toError(error)
    }
  },

  readFileContent: async ({ query }) => {
    try {
      return { status: 200 as const, body: await readFileContent(query.path) }
    } catch (error) {
      return toError(error)
    }
  },

  writeFileContent: async ({ body }) => {
    try {
      await writeFileContent(body.path, body.content)
      return { status: 200 as const, body: { message: "文件已保存" } }
    } catch (error) {
      return toError(error)
    }
  },

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
