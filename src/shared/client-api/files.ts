import type {
  ActionResponse,
  DirectoryResponse,
  FileBatchResult,
  FileContentResponse,
  FileEntry,
} from "@shared/api-contract"
import { UploadResponseSchema } from "@shared/api-contract/schemas/files"
import { ApiPath } from "@shared/api-path"
import {
  ApiRequestError,
  apiClient,
  assertWriteOnline,
  taskRequestHeaders,
  unwrap,
} from "./client"
import { type Execution, runExecution } from "./execution"
import { beginWrite } from "./write-activity"

export const fetchDirectory = async (
  path: string
): Promise<DirectoryResponse> =>
  unwrap<DirectoryResponse>(await apiClient.listDirectory({ query: { path } }))

/**
 * 新建与改名也与批量任务共用同一把目标锁：请求标识由服务端用来复用任务，
 * 结果要么完成要么受理。
 */
export const createDirectory = async (
  requestId: string,
  parentPath: string,
  name: string
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.createDirectory({
      body: { parentPath, name },
      headers: taskRequestHeaders(requestId),
    })
  )

export const createFile = async (
  requestId: string,
  parentPath: string,
  name: string
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.createFile({
      body: { parentPath, name },
      headers: taskRequestHeaders(requestId),
    })
  )

export const renameEntry = async (
  requestId: string,
  path: string,
  name: string
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.renameEntry({
      body: { path, name },
      headers: taskRequestHeaders(requestId),
    })
  )

/**
 * 三个批量操作都会走任务：请求标识由服务端用来复用任务，
 * 结果要么是逐项完成结果，要么是受理回执。
 */
export const deleteEntries = async (
  requestId: string,
  paths: string[]
): Promise<Execution<FileBatchResult>> =>
  runExecution<FileBatchResult>(() =>
    apiClient.deleteEntries({
      query: { paths },
      headers: taskRequestHeaders(requestId),
    })
  )

export const copyEntries = async (
  requestId: string,
  paths: string[],
  destPath: string
): Promise<Execution<FileBatchResult>> =>
  runExecution<FileBatchResult>(() =>
    apiClient.copyEntries({
      body: { paths, destPath },
      headers: taskRequestHeaders(requestId),
    })
  )

export const moveEntries = async (
  requestId: string,
  paths: string[],
  destPath: string
): Promise<Execution<FileBatchResult>> =>
  runExecution<FileBatchResult>(() =>
    apiClient.moveEntries({
      body: { paths, destPath },
      headers: taskRequestHeaders(requestId),
    })
  )

export const fetchFileContent = async (
  path: string
): Promise<FileContentResponse> =>
  unwrap<FileContentResponse>(
    await apiClient.readFileContent({ query: { path } })
  )

export const saveFileContent = async (
  requestId: string,
  path: string,
  content: string
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.writeFileContent({
      body: { path, content },
      headers: taskRequestHeaders(requestId),
    })
  )

/** 下载走浏览器原生请求，由 <a download> 或 window.open 触发，不经过 ts-rest client。 */
export const downloadFileUrl = (path: string): string =>
  `${ApiPath.filesDownload}?path=${encodeURIComponent(path)}`

export type UploadProgress = {
  loaded: number
  total: number
}

const unresolvedUploads = new Map<string, UploadResultUnknownError>()
const activeUploads = new Set<string>()
const uploadKey = (target: string, relative: string) =>
  JSON.stringify([target.replace(/\/$/, ""), relative])

export class UploadResultUnknownError extends ApiRequestError {
  constructor(
    readonly targetPath: string,
    readonly relativePath: string,
    readonly size: number
  ) {
    super(
      "上传结果未知，请读取目标目录核实，禁止盲目重传",
      null,
      undefined,
      undefined,
      true
    )
  }
}

/** 只观察目标是否存在及大小；存在不等于已确认该上传的内容与完成状态。 */
export const inspectUploadTarget = async (
  error: UploadResultUnknownError
): Promise<FileEntry | null> => {
  const segments = error.relativePath.split("/")
  const name = segments.pop()
  const directory = [error.targetPath.replace(/\/$/, ""), ...segments].join("/")
  const listing = await fetchDirectory(directory)
  return listing.entries.find((entry) => entry.name === name) ?? null
}

/**
 * 上传单个文件：裸 octet-stream，元数据走 query。
 * 走 XMLHttpRequest 而不是 fetch，因为只有它能拿到上传进度。
 */
export const uploadFile = (
  targetPath: string,
  file: File,
  options?: {
    relativePath?: string
    signal?: AbortSignal
    onProgress?: (progress: UploadProgress) => void
  }
): Promise<FileEntry> =>
  new Promise((resolve, reject) => {
    assertWriteOnline()
    if (options?.signal?.aborted) {
      reject(new ApiRequestError("上传未发送：已取消", 0))
      return
    }
    const relativePath = options?.relativePath ?? file.name
    const key = uploadKey(targetPath, relativePath)
    const unresolved = unresolvedUploads.get(key)
    if (unresolved) {
      reject(unresolved)
      return
    }
    if (activeUploads.has(key)) {
      reject(new ApiRequestError("该目标正在上传，禁止重复提交", 0))
      return
    }
    activeUploads.add(key)
    const endWrite = beginWrite()
    const query = new URLSearchParams({
      targetPath,
      relativePath,
    })
    const request = new XMLHttpRequest()
    request.open("POST", `${ApiPath.filesUploads}?${query}`)
    request.setRequestHeader("content-type", "application/octet-stream")
    request.timeout = 10 * 60 * 1000
    const abort = () => request.abort()
    const finish = () => {
      activeUploads.delete(key)
      endWrite()
      options?.signal?.removeEventListener("abort", abort)
    }
    const unknown = () => {
      finish()
      const error = new UploadResultUnknownError(
        targetPath,
        relativePath,
        file.size
      )
      unresolvedUploads.set(key, error)
      reject(error)
    }

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        options?.onProgress?.({ loaded: event.loaded, total: event.total })
      }
    })
    request.addEventListener("load", () => {
      let body: unknown
      try {
        body = JSON.parse(request.responseText)
      } catch {
        body = null
      }
      const parsed = UploadResponseSchema.safeParse(body)
      if (request.status >= 200 && request.status < 300 && parsed.success) {
        finish()
        resolve(parsed.data.file)
        return
      }
      if (
        request.status >= 400 &&
        request.status < 500 &&
        request.status !== 408
      ) {
        finish()
        reject(
          new ApiRequestError(
            `上传被拒绝（HTTP ${request.status}）`,
            request.status,
            body
          )
        )
        return
      }
      unknown()
    })
    request.addEventListener("error", unknown)
    request.addEventListener("abort", unknown)
    request.addEventListener("timeout", unknown)
    options?.signal?.addEventListener("abort", abort, { once: true })
    try {
      request.send(file)
    } catch (error) {
      finish()
      reject(new ApiRequestError("上传未发送", 0, undefined, error))
    }
  })
