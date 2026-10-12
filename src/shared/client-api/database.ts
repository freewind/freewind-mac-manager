import type {
  DatabaseDeleteBody,
  DatabaseDeleteResult,
  DatabaseFilter,
  DatabaseInsertBody,
  DatabaseRecordLocatorKey,
  DatabaseRecordResponse,
  DatabaseRecordsResponse,
  DatabaseSort,
  DatabaseTable,
  DatabaseTablesResponse,
  DatabaseUpdateBody,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

/**
 * database 域的具名调用：只经 apiClient 走契约，不直接拼路径，
 * 也不在这里另写请求链或错误处理。
 */

/** 筛选、排序与分页的入参；数组会按 extended query 形式序列化。 */
export type DatabaseRecordsQueryInput = {
  page: number
  pageSize: number
  filters: DatabaseFilter[]
  sorts: DatabaseSort[]
}

// ---- 只读查询：支持取消（AbortSignal 透传到 fetch） ----

export const fetchDatabaseTables = async (options?: {
  signal?: AbortSignal
}): Promise<DatabaseTablesResponse> =>
  unwrap<DatabaseTablesResponse>(
    await apiClient.listDatabaseTables({
      fetchOptions: { signal: options?.signal },
    })
  )

export const fetchDatabaseTable = async (
  table: string,
  options?: { signal?: AbortSignal }
): Promise<DatabaseTable> =>
  unwrap<DatabaseTable>(
    await apiClient.getDatabaseTable({
      params: { table },
      fetchOptions: { signal: options?.signal },
    })
  )

export const fetchDatabaseRecords = async (
  table: string,
  query: DatabaseRecordsQueryInput,
  options?: { signal?: AbortSignal }
): Promise<DatabaseRecordsResponse> =>
  unwrap<DatabaseRecordsResponse>(
    await apiClient.listDatabaseRecords({
      params: { table },
      query,
      fetchOptions: { signal: options?.signal },
    })
  )

/** 单条记录：复合主键整体放进 query，数组会序列化成 key[0][column] 形式。 */
export const fetchDatabaseRecord = async (
  table: string,
  key: DatabaseRecordLocatorKey,
  options?: { signal?: AbortSignal }
): Promise<DatabaseRecordResponse> =>
  unwrap<DatabaseRecordResponse>(
    await apiClient.getDatabaseRecord({
      params: { table },
      query: { key },
      fetchOptions: { signal: options?.signal },
    })
  )

// ---- 写操作：不走 202 受理、不自动重试 ----
//
// 成功即 200/201 的完成结果。结果无法确认时（网络中断、响应丢失，或服务端
// executionStatus=unknown）传输层抛出的 ApiRequestError.resultUnknown 为 true，
// 调用方必须重新读取目标核实，不能当成失败，也不能自动重发。

export const createDatabaseRecord = async (
  table: string,
  body: DatabaseInsertBody
): Promise<DatabaseRecordResponse> =>
  unwrap<DatabaseRecordResponse>(
    await apiClient.createDatabaseRecord({ params: { table }, body })
  )

export const updateDatabaseRecord = async (
  table: string,
  body: DatabaseUpdateBody
): Promise<DatabaseRecordResponse> =>
  unwrap<DatabaseRecordResponse>(
    await apiClient.updateDatabaseRecord({ params: { table }, body })
  )

/** 批量删除是原子动作：要么全删成功，要么整批回滚并以 409/404 报错。 */
export const deleteDatabaseRecords = async (
  table: string,
  body: DatabaseDeleteBody
): Promise<DatabaseDeleteResult> =>
  unwrap<DatabaseDeleteResult>(
    await apiClient.deleteDatabaseRecords({ params: { table }, body })
  )
