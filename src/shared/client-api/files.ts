import type {
  ActionResponse,
  DirectoryResponse,
  FileBatchResult,
  FileContentResponse,
  FileEntry,
} from "@shared/api-contract"
import { ApiPath } from "@shared/api-path"
import { apiClient, taskRequestHeaders, unwrap } from "./client"
import { type Execution, runExecution } from "./execution"

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

type UploadResponseBody = {
  message?: string
  file?: FileEntry
}

const parseUploadResponse = (text: string): UploadResponseBody | null => {
  try {
    return JSON.parse(text) as UploadResponseBody
  } catch {
    return null
  }
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
    const query = new URLSearchParams({
      targetPath,
      relativePath: options?.relativePath ?? file.name,
    })
    const request = new XMLHttpRequest()
    request.open("POST", `${ApiPath.filesUploads}?${query}`)
    request.setRequestHeader("content-type", "application/octet-stream")

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        options?.onProgress?.({ loaded: event.loaded, total: event.total })
      }
    })
    request.addEventListener("load", () => {
      const parsed = parseUploadResponse(request.responseText)
      if (request.status >= 200 && request.status < 300 && parsed?.file) {
        resolve(parsed.file)
        return
      }
      reject(new Error(parsed?.message ?? `上传失败（HTTP ${request.status}）`))
    })
    request.addEventListener("error", () => {
      reject(new Error("上传失败：网络错误"))
    })
    request.addEventListener("abort", () => {
      reject(new Error("上传已取消"))
    })
    options?.signal?.addEventListener("abort", () => request.abort())
    request.send(file)
  })
