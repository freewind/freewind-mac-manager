import type {
  DatabaseDeleteBody,
  DatabaseFilter,
  DatabaseInsertBody,
  DatabaseRecordLocatorKey,
  DatabaseScope,
  DatabaseSort,
  DatabaseUpdateBody,
} from "@shared/api-contract"
import {
  ApiRequestError,
  createDatabaseRecord,
  type DatabaseRecordsQueryInput,
  deleteDatabaseRecords,
  fetchDatabaseRecord,
  fetchDatabaseRecords,
  fetchDatabaseTable,
  fetchDatabaseTables,
  updateDatabaseRecord,
} from "@shared/client-api"
import type { QueryClient } from "@tanstack/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

/**
 * database 页的远程状态：全部走 TanStack Query，数据只从 `@shared/client-api`
 * 的具名函数取，组件不直接碰 contract 与传输层。
 */
const ALL = ["database"] as const

/** 查询 key 按域导出：表名、页码、页大小、筛选、排序全部进 key。 */
export const databaseKeys = {
  all: ALL,
  tables: (database: DatabaseScope) => [...ALL, "tables", database] as const,
  table: (database: DatabaseScope, table: string) =>
    [...ALL, "table", database, table] as const,
  /** 某张表的全部记录查询（用于失效，不限页码与筛选）。 */
  recordsScope: (database: DatabaseScope, table: string) =>
    [...ALL, "records", database, table] as const,
  records: (
    database: DatabaseScope,
    table: string,
    query: DatabaseRecordsQueryInput
  ) =>
    [
      ...ALL,
      "records",
      database,
      table,
      query.page,
      query.pageSize,
      query.filters,
      query.sorts,
    ] as const,
  /** 某张表的全部单条记录查询（用于失效）。 */
  recordScope: (database: DatabaseScope, table: string) =>
    [...ALL, "record", database, table] as const,
  record: (
    database: DatabaseScope,
    table: string,
    key: DatabaseRecordLocatorKey
  ) => [...ALL, "record", database, table, key] as const,
}

/** 只读查询的有界重试次数。 */
export const DATABASE_READ_RETRY = 2

/**
 * 只读查询重试有界：最多两次，且只重试网络错误与服务端故障；
 * 400/401/403/404/409/429 这类结果已经明确的错误不重试。
 */
export const shouldRetryDatabaseRead = (
  failureCount: number,
  error: unknown
): boolean =>
  failureCount < DATABASE_READ_RETRY &&
  !(
    error instanceof ApiRequestError &&
    error.status !== null &&
    error.status < 500
  )

/** 表列表：手动刷新即可看到新建的业务表，不做轮询。 */
export const useDatabaseTablesQuery = (database: DatabaseScope) =>
  useQuery({
    queryKey: databaseKeys.tables(database),
    // signal 由 TanStack Query 提供：查询被取消时真正中断请求
    queryFn: ({ signal }) => fetchDatabaseTables(database, { signal }),
    retry: shouldRetryDatabaseRead,
  })

export const useDatabaseTableQuery = (
  database: DatabaseScope,
  table: string | null
) =>
  useQuery({
    queryKey: databaseKeys.table(database, table ?? ""),
    queryFn: ({ signal }) =>
      fetchDatabaseTable(table ?? "", database, { signal }),
    enabled: table !== null,
    retry: shouldRetryDatabaseRead,
  })

export const useDatabaseRecordsQuery = (
  database: DatabaseScope,
  table: string | null,
  query: DatabaseRecordsQueryInput
) =>
  useQuery({
    queryKey: databaseKeys.records(database, table ?? "", query),
    queryFn: ({ signal }) =>
      fetchDatabaseRecords(table ?? "", { ...query, database }, { signal }),
    enabled: table !== null,
    retry: shouldRetryDatabaseRead,
  })

export const useDatabaseRecordQuery = (
  database: DatabaseScope,
  table: string | null,
  key: DatabaseRecordLocatorKey | null
) =>
  useQuery({
    queryKey: databaseKeys.record(database, table ?? "", key ?? []),
    queryFn: ({ signal }) =>
      fetchDatabaseRecord(table ?? "", key ?? [], database, { signal }),
    enabled: table !== null && key !== null,
    retry: shouldRetryDatabaseRead,
  })

/** 写成功后失效本域相关 key：表列表、表结构、该表的记录与单条记录。 */
export const invalidateDatabaseTable = async (
  queryClient: QueryClient,
  database: DatabaseScope,
  table: string
): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: databaseKeys.tables(database) }),
    queryClient.invalidateQueries({
      queryKey: databaseKeys.table(database, table),
    }),
    queryClient.invalidateQueries({
      queryKey: databaseKeys.recordsScope(database, table),
    }),
    queryClient.invalidateQueries({
      queryKey: databaseKeys.recordScope(database, table),
    }),
  ])
}

/**
 * 结果未知（网络中断、响应丢失或服务端 executionStatus=unknown）时，
 * 只重新读取核实，绝不重发写入。
 */
const rereadAfterUnknownResult = async (
  queryClient: QueryClient,
  database: DatabaseScope,
  table: string,
  error: unknown
): Promise<void> => {
  if (error instanceof ApiRequestError && error.resultUnknown) {
    await invalidateDatabaseTable(queryClient, database, table)
  }
}

/**
 * 写 mutation 的公共选项：不自动重试，离线也不暂停（networkMode=always），
 * 由公共传输层直接拒绝离线请求，避免联网后被恢复重放。
 */
export const DATABASE_MUTATION_OPTIONS = {
  retry: false,
  networkMode: "always",
} as const

export type CreateDatabaseRecordInput = {
  database: DatabaseScope
  table: string
  body: Omit<DatabaseInsertBody, "database">
}

export const useCreateDatabaseRecord = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateDatabaseRecordInput) =>
      createDatabaseRecord(input.table, input.body, input.database),
    ...DATABASE_MUTATION_OPTIONS,
    onSuccess: (_result, input) =>
      invalidateDatabaseTable(queryClient, input.database, input.table),
    onError: (error, input) =>
      rereadAfterUnknownResult(queryClient, input.database, input.table, error),
  })
}

export type UpdateDatabaseRecordInput = {
  database: DatabaseScope
  table: string
  key: DatabaseRecordLocatorKey
  body: Omit<DatabaseUpdateBody, "database">
}

export const useUpdateDatabaseRecord = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateDatabaseRecordInput) =>
      updateDatabaseRecord(input.table, input.body, input.database),
    ...DATABASE_MUTATION_OPTIONS,
    onSuccess: (_result, input) =>
      invalidateDatabaseTable(queryClient, input.database, input.table),
    onError: (error, input) =>
      rereadAfterUnknownResult(queryClient, input.database, input.table, error),
  })
}

export type DeleteDatabaseRecordsInput = {
  database: DatabaseScope
  table: string
  body: Omit<DatabaseDeleteBody, "database">
}

export const useDeleteDatabaseRecords = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DeleteDatabaseRecordsInput) =>
      deleteDatabaseRecords(input.table, input.body, input.database),
    ...DATABASE_MUTATION_OPTIONS,
    onSuccess: (_result, input) =>
      invalidateDatabaseTable(queryClient, input.database, input.table),
    onError: (error, input) =>
      rereadAfterUnknownResult(queryClient, input.database, input.table, error),
  })
}

/** 筛选/排序的当前取值类型，供页面与导航共用。 */
export type DatabaseQueryFilters = DatabaseFilter[]
export type DatabaseQuerySorts = DatabaseSort[]
