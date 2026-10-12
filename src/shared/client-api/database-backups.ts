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

/** 原始文件名只作展示：编码进请求头，服务端会再净化并拒绝路径成分。 */
const originalFileNameHeaders = (
  originalFileName?: string
): Record<string, string> =>
  originalFileName
    ? { "x-file-name": encodeURIComponent(originalFileName) }
    : {}

/**
 * 上传导入一个 SQLite 备份（传输例外，raw body 流式）：
 * 上限 8 GiB，超限 413；内容不合格 400（unsupported_format）。
 * 201 只代表文件已纳入备份列表（不改当前应用数据库）。
 * 不自动重试：上传中断结果未知，重新读取列表核实是否已导入。
 */
export const uploadDatabaseBackup = async (
  file: Blob,
  options?: { signal?: AbortSignal; originalFileName?: string }
): Promise<DatabaseBackupCreated> => {
  const response = await fetch(ApiPath.databaseBackupUpload, {
    method: "POST",
    headers: {
      ...buildAuthorizationHeader(),
      ...originalFileNameHeaders(options?.originalFileName),
    },
    body: file,
    signal: options?.signal,
  })
  return unwrap<DatabaseBackupCreated>({
    status: response.status,
    body: await response.json(),
  })
}

/** 解析服务端附件名：Content-Disposition 里的 filename 参数。 */
const fileNameFromDisposition = (value: string | null): string | null => {
  if (value === null) return null
  const matched = /filename="([^"]+)"/.exec(value)
  return matched === null ? null : matched[1]
}

/**
 * 下载备份（传输例外）：返回文件字节与服务端附件名。
 * 只读操作；中断只需中止 signal，服务端会随流关闭句柄。
 */
export const downloadDatabaseBackup = async (
  backupId: string,
  options?: { signal?: AbortSignal }
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
  return {
    blob: await response.blob(),
    fileName: fileNameFromDisposition(
      response.headers.get("content-disposition")
    ),
    sizeBytes: Number(response.headers.get("content-length") ?? 0),
  }
}
