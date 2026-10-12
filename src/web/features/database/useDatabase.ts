import type {
  DatabaseRecordLocatorKey,
  SqliteWritableValue,
} from "@shared/api-contract"
import {
  ApiRequestError,
  type DatabaseRecordsQueryInput,
} from "@shared/client-api"
import { describeError } from "@shared/format"
import { useQueryClient } from "@tanstack/react-query"
import { usePwaStatus } from "@web/hooks/use-pwa-status"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useDatabaseNavigation } from "./navigation"
import {
  databaseKeys,
  useCreateDatabaseRecord,
  useDatabaseRecordQuery,
  useDatabaseRecordsQuery,
  useDatabaseTableQuery,
  useDatabaseTablesQuery,
  useDeleteDatabaseRecords,
  useUpdateDatabaseRecord,
} from "./queries"

/** 结果未知时的页内提示：可能已经写入，必须重新读取核实。 */
export const DATABASE_UNKNOWN_RESULT_NOTICE =
  "写入结果未知：可能已经写入，请重新读取确认后再决定下一步"
/** 离线时不提交写入。 */
export const DATABASE_OFFLINE_NOTICE = "当前离线，操作未发送"

export type DatabaseDeleteTarget = {
  key: DatabaseRecordLocatorKey
  expectedSignature: string
}

/**
 * database 页的数据与动作编排。
 *
 * - 远程状态全部归 TanStack Query（表列表、表结构、分页记录、单条记录）
 * - 导航状态放 URL（表名、筛选、排序、页码），本地选择与页内状态留在组件内
 * - 写操作是同步请求：成功即完成；结果未知只重新读取核实，绝不重发
 */
export const useDatabase = () => {
  const queryClient = useQueryClient()
  const { online } = usePwaStatus()
  const navigation = useDatabaseNavigation()
  const { table, page, pageSize, filters, sorts } = navigation.state

  const recordsQueryInput = useMemo<DatabaseRecordsQueryInput>(
    () => ({ page, pageSize, filters, sorts }),
    [page, pageSize, filters, sorts]
  )

  const tablesQuery = useDatabaseTablesQuery()
  const tableQuery = useDatabaseTableQuery(table)
  const recordsQuery = useDatabaseRecordsQuery(table, recordsQueryInput)

  /**
   * 本地选择：连同所属表一起记，切表后自然失效（纯派生，不靠 effect 清空）。
   * 记录值不进远程缓存副本，也不进 URL。
   */
  const [selection, setSelection] = useState<{
    table: string
    key: DatabaseRecordLocatorKey
  } | null>(null)
  const selectedKey =
    selection !== null && selection.table === table ? selection.key : null
  const recordQuery = useDatabaseRecordQuery(table, selectedKey)

  const createMutation = useCreateDatabaseRecord()
  const updateMutation = useUpdateDatabaseRecord()
  const deleteMutation = useDeleteDatabaseRecords()

  /** 页内持续状态：同样带上所属表，切表后不再展示。 */
  const [failure, setFailure] = useState<{
    table: string | null
    message: string
  } | null>(null)
  const [unknown, setUnknown] = useState<{ table: string | null } | null>(null)
  /** 同步锁：重复提交不会发出第二次写入。 */
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)

  // 前台恢复只重新读取当前数据；写入不会被重放（mutation 不重试、也不排队）
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== "visible") return
      void queryClient.refetchQueries({
        queryKey: databaseKeys.all,
        type: "active",
      })
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [queryClient])

  const runAction = useCallback(
    async (
      run: () => Promise<unknown>,
      successMessage: string
    ): Promise<boolean> => {
      // 同步锁：一次只允许一个写入在途
      if (submitting.current) return false
      // 离线不发送；提示由 actionFailure 派生，恢复联网后自动消失，且不补发
      if (!online) return false
      submitting.current = true
      setBusy(true)
      setFailure(null)
      try {
        await run()
        setUnknown(null)
        // 动作编排处只触发一次成功提示
        toast.success(successMessage)
        return true
      } catch (error) {
        if (error instanceof ApiRequestError && error.resultUnknown) {
          // 结果未知既不是成功也不是失败：留在页内，等重新读取核实
          setUnknown({ table })
        } else {
          setFailure({ table, message: describeError(error) })
        }
        return false
      } finally {
        submitting.current = false
        setBusy(false)
      }
    },
    [online, table]
  )

  /** 离线提示只在离线时展示；服务端错误按所属表展示。 */
  const actionFailure = !online
    ? DATABASE_OFFLINE_NOTICE
    : failure !== null && failure.table === table
      ? failure.message
      : null
  const unknownNotice =
    unknown !== null && unknown.table === table
      ? DATABASE_UNKNOWN_RESULT_NOTICE
      : null

  const selectRecord = (key: DatabaseRecordLocatorKey | null): void => {
    setSelection(key === null || table === null ? null : { table, key })
  }

  const createRecord = (
    values: Record<string, SqliteWritableValue>
  ): Promise<boolean> => {
    if (table === null) return Promise.resolve(false)
    return runAction(
      () => createMutation.mutateAsync({ table, body: { values } }),
      "已新增 1 条记录"
    )
  }

  const updateRecord = (
    key: DatabaseRecordLocatorKey,
    expectedSignature: string,
    values: Record<string, SqliteWritableValue>
  ): Promise<boolean> => {
    if (table === null) return Promise.resolve(false)
    return runAction(
      () =>
        updateMutation.mutateAsync({
          table,
          key,
          body: { key, expectedSignature, values },
        }),
      "已更新 1 条记录"
    )
  }

  /** 批量删除是原子动作：要么全删成功，要么整批回滚并报错。 */
  const deleteRecords = (items: DatabaseDeleteTarget[]): Promise<boolean> => {
    if (table === null || items.length === 0) return Promise.resolve(false)
    return runAction(
      () => deleteMutation.mutateAsync({ table, body: { items } }),
      `已删除 ${items.length} 条记录`
    )
  }

  /** 手动刷新表列表：新建的业务表刷新后即可见，不做轮询。 */
  const refreshTables = useCallback(async (): Promise<void> => {
    await queryClient.refetchQueries({ queryKey: databaseKeys.tables() })
  }, [queryClient])

  return {
    // 远程数据
    tables: tablesQuery.data?.tables ?? [],
    tablesPending: tablesQuery.isPending,
    tablesError: tablesQuery.error,
    tableDetail: tableQuery.data ?? null,
    tableError: tableQuery.error,
    records: recordsQuery.data?.records ?? [],
    total: recordsQuery.data?.total ?? null,
    recordsPending: recordsQuery.isPending,
    recordsError: recordsQuery.error,
    recordDetail: recordQuery.data?.record ?? null,
    recordPending: selectedKey !== null && recordQuery.isPending,
    recordError: recordQuery.error,
    /** 页面上数据的最后读取时间（毫秒）；没有任何数据时为 null。 */
    updatedAt:
      Math.max(
        tablesQuery.dataUpdatedAt,
        tableQuery.dataUpdatedAt,
        recordsQuery.dataUpdatedAt
      ) || null,
    // 导航状态（来自 URL）
    table,
    page,
    pageSize,
    filters,
    sorts,
    selectTable: navigation.selectTable,
    setPage: navigation.setPage,
    setPageSize: navigation.setPageSize,
    setFilters: navigation.setFilters,
    setSorts: navigation.setSorts,
    clearQuery: navigation.clearQuery,
    // 本地选择
    selectedKey,
    selectRecord,
    // 动作与页内状态
    createRecord,
    updateRecord,
    deleteRecords,
    refreshTables,
    busy,
    actionFailure,
    unknownNotice,
    online,
  }
}
