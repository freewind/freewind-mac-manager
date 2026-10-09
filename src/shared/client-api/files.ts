import type {
  DirectoryResponse,
  FileContentResponse,
  FileEntry,
  OkResponse,
} from "@shared/api-contract"
import { API_BASE, ApiPath } from "@shared/api-path"
import { apiClient } from "./client"

const unwrap = <T>(result: { status: number; body: unknown }): T => {
  if (result.status >= 200 && result.status < 300) return result.body as T
  const body = result.body as { message?: string } | undefined
  throw new Error(body?.message ?? `请求失败（HTTP ${result.status}）`)
}

export const fetchDirectory = async (
  path: string
): Promise<DirectoryResponse> =>
  unwrap<DirectoryResponse>(await apiClient.listDirectory({ query: { path } }))

export const createDirectory = async (
  parentPath: string,
  name: string
): Promise<OkResponse> =>
  unwrap<OkResponse>(
    await apiClient.createDirectory({ body: { parentPath, name } })
  )

export const createFile = async (
  parentPath: string,
  name: string
): Promise<OkResponse> =>
  unwrap<OkResponse>(await apiClient.createFile({ body: { parentPath, name } }))

export const renameEntry = async (
  path: string,
  name: string
): Promise<OkResponse> =>
  unwrap<OkResponse>(await apiClient.renameEntry({ body: { path, name } }))

export const deleteEntries = async (paths: string[]): Promise<OkResponse> =>
  unwrap<OkResponse>(await apiClient.deleteEntries({ query: { paths } }))

export const copyEntries = async (
  paths: string[],
  destPath: string
): Promise<OkResponse> =>
  unwrap<OkResponse>(await apiClient.copyEntries({ body: { paths, destPath } }))

export const moveEntries = async (
  paths: string[],
  destPath: string
): Promise<OkResponse> =>
  unwrap<OkResponse>(await apiClient.moveEntries({ body: { paths, destPath } }))

export const fetchFileContent = async (
  path: string
): Promise<FileContentResponse> =>
  unwrap<FileContentResponse>(
    await apiClient.readFileContent({ query: { path } })
  )

export const saveFileContent = async (
  path: string,
  content: string
): Promise<OkResponse> =>
  unwrap<OkResponse>(
    await apiClient.writeFileContent({ body: { path, content } })
  )

/** 下载走浏览器原生请求，由 <a download> 或 window.open 触发，不经过 ts-rest client。 */
export const downloadFileUrl = (path: string): string =>
  `${ApiPath[`${API_BASE}/files/download`]}?path=${encodeURIComponent(path)}`

export type UploadProgress = {
  loaded: number
  total: number
}

type UploadResponseBody = {
  message?: string
  file?: FileEntry
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
    request.open("POST", `${ApiPath[`${API_BASE}/files/uploads`]}?${query}`)
    request.setRequestHeader("content-type", "application/octet-stream")

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        options?.onProgress?.({ loaded: event.loaded, total: event.total })
      }
    })
    request.addEventListener("load", () => {
      let parsed: UploadResponseBody | null = null
      try {
        parsed = JSON.parse(request.responseText) as UploadResponseBody
      } catch {
        parsed = null
      }
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
