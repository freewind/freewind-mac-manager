import type {
  DatabaseBackup,
  DatabaseBackupCreated,
  DatabaseBackupDeleteBody,
  DatabaseBackupDeleteResult,
  DatabaseBackupsQueryInput,
  DatabaseBackupsResponse,
  DatabaseRestorePlan,
  DatabaseRestorePlanBody,
  DatabaseRestoreState,
} from "@shared/api-contract"
import { ApiPath } from "@shared/api-path"
import { buildAuthorizationHeader } from "./access-password"
import {
  ApiRequestError,
  apiClient,
  newRequestId,
  taskRequestHeaders,
  unwrap,
} from "./client"
import { type Execution, runExecution } from "./execution"

/**
 * 备份域的具名调用：只经 apiClient 走契约，不直接拼 JSON 路径，
 * 也不在这里另写请求链或错误处理。
 *
 * 写操作一律不自动重试；超时或断连表示结果未知，必须重新读取列表、详情或
 * 恢复状态核实，不能直接重发（可能造成重复备份或重复计划）。
 */

// ---- 只读：支持取消（AbortSignal 透传到 fetch） ----

/** 备份列表：按创建时间倒序，支持来源过滤与分页。 */
export const fetchDatabaseBackups = async (
  query?: DatabaseBackupsQueryInput,
  options?: { signal?: AbortSignal }
): Promise<DatabaseBackupsResponse> =>
  unwrap<DatabaseBackupsResponse>(
    await apiClient.listDatabaseBackups({
      query,
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/** 单份备份详情：提交恢复计划前用它核对内容签名。 */
export const fetchDatabaseBackup = async (
  backupId: string,
  options?: { signal?: AbortSignal }
): Promise<DatabaseBackup> =>
  unwrap<DatabaseBackup>(
    await apiClient.getDatabaseBackup({
      params: { backupId },
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/** 恢复状态：计划状态与当前库是否已核实是这份备份，分开返回。 */
export const fetchDatabaseRestoreState = async (options?: {
  signal?: AbortSignal
}): Promise<DatabaseRestoreState> =>
  unwrap<DatabaseRestoreState>(
    await apiClient.getDatabaseRestoreState({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

// ---- 写操作：不自动重试；结果未知时重新读取核实 ----

/**
 * 创建备份（长任务）：
 * - completed（201）：备份已完整发布，body 是备份本身；
 * - accepted（202）：任务已受理，必须按 taskId 到任务中心查进度；
 * - 冲突（409）：同目标任务已在执行。
 * 不自动重试；响应丢失时用同一 requestId 查任务记录。
 */
export const createDatabaseBackup = async (options?: {
  requestId?: string
}): Promise<Execution<DatabaseBackupCreated>> =>
  runExecution<DatabaseBackupCreated>(() =>
    apiClient.createDatabaseBackup({
      headers: taskRequestHeaders(options?.requestId ?? newRequestId()),
    })
  )

/**
 * 删除备份：逐项结果（真正删除/缺失/失败分开返回），不做整批回滚。
 * 危险动作：服务端按签名与状态逐个复核。不自动重试；结果未知时重新读取
 * 列表核实，不能假设删除成功。
 */
export const deleteDatabaseBackups = async (
  body: DatabaseBackupDeleteBody
): Promise<DatabaseBackupDeleteResult> =>
  unwrap<DatabaseBackupDeleteResult>(
    await apiClient.deleteDatabaseBackups({ body })
  )

/**
 * 提交恢复计划：201 只代表计划已创建并等待重启生效，**绝不表示数据库已恢复**。
 * 危险动作：服务端重新核验来源身份、签名、完整性与应用兼容性；
 * 冲突（409）表示已有活动计划或签名不匹配。不自动重试；结果未知时查询
 * 恢复状态核实，不能凭超时判断计划是否已建立。
 */
export const planDatabaseRestore = async (
  body: DatabaseRestorePlanBody
): Promise<DatabaseRestorePlan> =>
  unwrap<DatabaseRestorePlan>(await apiClient.planDatabaseRestore({ body }))

/**
 * 取消尚未执行的恢复计划：已开始应用或已终态的计划会被拒绝（409）。
 * 不自动重试；结果未知时重新查询恢复状态。
 */
export const cancelDatabaseRestore = async (): Promise<DatabaseRestorePlan> =>
  unwrap<DatabaseRestorePlan>(await apiClient.cancelDatabaseRestore({}))

// ---- 传输例外：上传与下载不进 JSON 契约，按 ApiPath 直连 ----

/**
 * 传输进度。
 *
 * `totalBytes` 只有在拿得到长度时才有值（上传是文件大小，下载是
 * Content-Length）；拿不到时前端只显示已传字节数，不编造百分比。
 */
export type TransferProgressHandler = (
  loadedBytes: number,
  totalBytes?: number
) => void

/** 原始文件名只作展示：编码进请求头，服务端会再净化并拒绝路径成分。 */
const originalFileNameHeaders = (
  originalFileName?: string
): Record<string, string> =>
  originalFileName
    ? { "x-file-name": encodeURIComponent(originalFileName) }
    : {}

/** 解析响应体：服务端错误体是 JSON，解析不了就当没有内容。 */
const parseJsonBody = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/**
 * 上传走 XMLHttpRequest 而不是 fetch：只有它能拿到真实的上传进度。
 *
 * fetch 要观察上传进度只能把请求体换成 ReadableStream（还要 duplex: "half"），
 * 而 Safari 不支持 duplex，手机上的导入会整个坏掉；XHR 的 upload.onprogress
 * 在包括 iOS Safari 在内的浏览器上都可用。这与 files.ts 的上传是同一套做法。
 *
 * 刻意不设 request.timeout：与改动前一致，长导入由服务端 60 分钟总时限
 * （BACKUP_UPLOAD_TIMEOUT_MS）兜住，客户端取消仍走 signal。
 */
const sendUpload = (
  file: Blob,
  options?: {
    signal?: AbortSignal
    originalFileName?: string
    onProgress?: TransferProgressHandler
  }
): Promise<{ status: number; body: unknown }> =>
  new Promise((resolve, reject) => {
    const signal = options?.signal
    if (signal?.aborted === true) {
      reject(new ApiRequestError("上传未发送：已取消", 0))
      return
    }
    const request = new XMLHttpRequest()
    request.open("POST", ApiPath.databaseBackupUpload)
    for (const [key, value] of Object.entries({
      ...buildAuthorizationHeader(),
      ...originalFileNameHeaders(options?.originalFileName),
    })) {
      request.setRequestHeader(key, value)
    }

    const abort = (): void => request.abort()
    const finish = (): void => signal?.removeEventListener("abort", abort)
    signal?.addEventListener("abort", abort, { once: true })

    // 只报浏览器给的字节数：lengthComputable 为假时没有 total
    request.upload.addEventListener("progress", (event) => {
      if (signal?.aborted === true) return
      options?.onProgress?.(
        event.loaded,
        event.lengthComputable ? event.total : undefined
      )
    })
    request.addEventListener("load", () => {
      finish()
      resolve({
        status: request.status,
        body: parseJsonBody(request.responseText),
      })
    })
    request.addEventListener("abort", () => {
      finish()
      reject(new ApiRequestError("上传已取消", null))
    })
    request.addEventListener("error", () => {
      finish()
      // 连接中断无法确认服务端是否收下文件：按结果未知处理，禁止自动重传
      reject(
        new ApiRequestError(
          "上传中断，结果未知，请重新读取列表确认",
          null,
          undefined,
          undefined,
          true
        )
      )
    })

    request.send(file)
  })

/**
 * 上传导入一个 SQLite 备份（传输例外，raw body 流式）：
 * 上限 8 GiB，超限 413；内容不合格 400（unsupported_format）。
 * 201 只代表文件已纳入备份列表（不改当前应用数据库）。
 * 不自动重试：上传中断结果未知，重新读取列表核实是否已导入。
 */
export const uploadDatabaseBackup = async (
  file: Blob,
  options?: {
    signal?: AbortSignal
    originalFileName?: string
    onProgress?: TransferProgressHandler
  }
): Promise<DatabaseBackupCreated> =>
  unwrap<DatabaseBackupCreated>(await sendUpload(file, options))

/** 解析服务端附件名：Content-Disposition 里的 filename 参数。 */
const fileNameFromDisposition = (value: string | null): string | null => {
  if (value === null) return null
  const matched = /filename="([^"]+)"/.exec(value)
  return matched === null ? null : matched[1]
}

/**
 * 按块读取响应体并累计字节：读多少报多少，读完的字节数就是真实大小。
 *
 * 没有进度回调、或环境不提供响应流（response.body 为空）时退回 response.blob()，
 * 行为与改动前一致。
 */
const readResponseBody = async (
  response: Response,
  onProgress?: TransferProgressHandler
): Promise<{ blob: Blob; sizeBytes: number }> => {
  const declared = Number(response.headers.get("content-length") ?? "")
  const totalBytes =
    Number.isFinite(declared) && declared > 0 ? declared : undefined
  const body = response.body
  if (body === null || onProgress === undefined) {
    return { blob: await response.blob(), sizeBytes: totalBytes ?? 0 }
  }

  const reader = body.getReader()
  const chunks: BlobPart[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress(loaded, totalBytes)
  }
  return {
    blob: new Blob(chunks, {
      type: response.headers.get("content-type") ?? "",
    }),
    sizeBytes: loaded,
  }
}

/**
 * 下载备份（传输例外）：返回文件字节与服务端附件名。
 * 只读操作；中断只需中止 signal，服务端会随流关闭句柄。
 */
export const downloadDatabaseBackup = async (
  backupId: string,
  options?: { signal?: AbortSignal; onProgress?: TransferProgressHandler }
): Promise<{ blob: Blob; fileName: string | null; sizeBytes: number }> => {
  const response = await fetch(
    ApiPath.databaseBackupDownload.replace(
      ":backupId",
      encodeURIComponent(backupId)
    ),
    {
      headers: buildAuthorizationHeader(),
      signal: options?.signal,
    }
  )
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const detail =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : ""
    throw new ApiRequestError(
      detail
        ? `下载失败（HTTP ${response.status}）：${detail}`
        : `下载失败（HTTP ${response.status}）`,
      response.status,
      body
    )
  }
  const { blob, sizeBytes } = await readResponseBody(
    response,
    options?.onProgress
  )
  return {
    blob,
    fileName: fileNameFromDisposition(
      response.headers.get("content-disposition")
    ),
    sizeBytes,
  }
}
