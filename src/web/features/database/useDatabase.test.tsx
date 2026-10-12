// @vitest-environment jsdom

import type { DatabaseRecordLocatorKey } from "@shared/api-contract"
import { ApiRequestError } from "@shared/client-api"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DATABASE_OFFLINE_NOTICE,
  DATABASE_UNKNOWN_RESULT_NOTICE,
  useDatabase,
} from "./useDatabase"

const api = vi.hoisted(() => ({
  fetchDatabaseTables: vi.fn(),
  fetchDatabaseTable: vi.fn(),
  fetchDatabaseRecords: vi.fn(),
  fetchDatabaseRecord: vi.fn(),
  createDatabaseRecord: vi.fn(),
  updateDatabaseRecord: vi.fn(),
  deleteDatabaseRecords: vi.fn(),
}))

vi.mock("@shared/client-api", async (original) => ({
  ...(await original<typeof import("@shared/client-api")>()),
  ...api,
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const tableDetail = {
  name: "items",
  kind: "table",
  rowCount: null,
  capabilities: [
    { operation: "read", allowed: true },
    { operation: "insert", allowed: true },
    { operation: "update", allowed: true },
    { operation: "delete", allowed: true },
  ],
  columns: [
    {
      name: "id",
      declaredType: "INTEGER",
      affinity: "integer",
      notNull: false,
      primaryKeyPosition: 1,
      generated: false,
      hidden: false,
      write: { allowed: true },
    },
  ],
  constraints: { primaryKey: ["id"], unique: [], foreignKeys: [], checks: [] },
  signature: "sig",
  withoutRowId: false,
  triggers: [],
  referencedBy: [],
}

const key: DatabaseRecordLocatorKey = [
  { column: "id", value: { type: "integer", value: "1" } },
]
const record = {
  key,
  values: { id: { type: "integer", value: "1" } },
  signature: "row-sig",
}
const recordBody = { table: "items", record }
const recordsBody = {
  table: "items",
  records: [record],
  page: 1,
  pageSize: 50,
  total: 1,
  signature: "sig",
}

const setUrl = (search: string): void => {
  window.history.replaceState({}, "", `/${search}`)
}

const setOnline = (online: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    value: online,
    configurable: true,
  })
}

const setVisible = (state: "visible" | "hidden"): void => {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  })
}

const mountDatabase = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return {
    client,
    ...renderHook(() => useDatabase(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }),
  }
}

const deferred = () => {
  let resolve: (value: typeof recordBody) => void = () => {}
  const promise = new Promise<typeof recordBody>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.fetchDatabaseTables.mockResolvedValue({ tables: [] })
  api.fetchDatabaseTable.mockResolvedValue(tableDetail)
  api.fetchDatabaseRecords.mockResolvedValue(recordsBody)
  api.fetchDatabaseRecord.mockResolvedValue(recordBody)
  api.createDatabaseRecord.mockResolvedValue(recordBody)
  api.updateDatabaseRecord.mockResolvedValue(recordBody)
  api.deleteDatabaseRecords.mockResolvedValue({
    deleted: [key],
    conflicts: [],
    failed: [],
  })
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  setOnline(true)
  setVisible("visible")
  setUrl("")
})

afterEach(() => {
  cleanup()
})

describe("useDatabase queries", () => {
  it("reads tables, structure and records for the table in the URL", async () => {
    setUrl("?feature=database&dbTable=items")
    const { result } = mountDatabase()
    await waitFor(() => expect(result.current.records).toHaveLength(1))

    expect(result.current.table).toBe("items")
    expect(result.current.tableDetail?.name).toBe("items")
    expect(api.fetchDatabaseTable).toHaveBeenCalledWith("items", {
      signal: expect.any(AbortSignal),
    })
    expect(api.fetchDatabaseRecords).toHaveBeenCalledWith(
      "items",
      { page: 1, pageSize: 50, filters: [], sorts: [] },
      { signal: expect.any(AbortSignal) }
    )
  })

  it("does not read records before a table is selected", async () => {
    const { result } = mountDatabase()
    await waitFor(() => expect(result.current.tables).toEqual([]))
    expect(api.fetchDatabaseRecords).not.toHaveBeenCalled()
    expect(api.fetchDatabaseTable).not.toHaveBeenCalled()
  })

  it("re-reads the table list on demand so new tables appear", async () => {
    const { result } = mountDatabase()
    await waitFor(() =>
      expect(api.fetchDatabaseTables).toHaveBeenCalledTimes(1)
    )
    await act(async () => {
      await result.current.refreshTables()
    })
    expect(api.fetchDatabaseTables).toHaveBeenCalledTimes(2)
  })
})

describe("useDatabase local selection", () => {
  it("keeps the selection local and clears it when the table changes", async () => {
    setUrl("?dbTable=items")
    const { client, result } = mountDatabase()
    await waitFor(() => expect(result.current.tableDetail).not.toBeNull())

    act(() => result.current.selectRecord(key))
    expect(result.current.selectedKey).toEqual(key)
    await waitFor(() =>
      expect(api.fetchDatabaseRecord).toHaveBeenCalledWith("items", key, {
        signal: expect.any(AbortSignal),
      })
    )
    // 选择不进远程缓存：缓存里只有 database 域的查询键
    const roots = new Set(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey[0])
    )
    expect(roots).toEqual(new Set(["database"]))

    act(() => result.current.selectTable("other"))
    expect(result.current.selectedKey).toBeNull()
  })
})

describe("useDatabase actions", () => {
  it("does not send a write while offline, and does not replay it when back online", async () => {
    setOnline(false)
    setUrl("?dbTable=items")
    const { result } = mountDatabase()
    await waitFor(() => expect(result.current.table).toBe("items"))

    let sent: boolean | undefined
    await act(async () => {
      sent = await result.current.createRecord({
        name: { type: "text", value: "apple" },
      })
    })
    expect(sent).toBe(false)
    expect(api.createDatabaseRecord).not.toHaveBeenCalled()
    expect(result.current.actionFailure).toBe(DATABASE_OFFLINE_NOTICE)

    act(() => {
      setOnline(true)
      window.dispatchEvent(new Event("online"))
    })
    await waitFor(() => expect(result.current.online).toBe(true))
    expect(result.current.actionFailure).toBeNull()
    // 恢复联网不会补发离线时被拒绝的写入
    expect(api.createDatabaseRecord).not.toHaveBeenCalled()
  })

  it("sends a repeated action only once", async () => {
    setUrl("?dbTable=items")
    const pending = deferred()
    api.createDatabaseRecord.mockReturnValueOnce(pending.promise)
    const { result } = mountDatabase()
    await waitFor(() => expect(result.current.table).toBe("items"))

    let first: Promise<boolean> | undefined
    let second: Promise<boolean> | undefined
    act(() => {
      first = result.current.createRecord({
        name: { type: "text", value: "apple" },
      })
      second = result.current.createRecord({
        name: { type: "text", value: "apple" },
      })
    })
    // 同步锁：第二次调用立即被挡住
    await expect(second).resolves.toBe(false)

    await act(async () => {
      pending.resolve(recordBody)
      await first
    })
    await expect(first).resolves.toBe(true)
    // 只发出过一次写入
    expect(api.createDatabaseRecord).toHaveBeenCalledTimes(1)
  })

  it("toasts once on success and re-reads the table's data", async () => {
    setUrl("?dbTable=items")
    const { result } = mountDatabase()
    await waitFor(() => expect(result.current.tableDetail).not.toBeNull())
    const readsBefore = api.fetchDatabaseRecords.mock.calls.length

    let sent: boolean | undefined
    await act(async () => {
      sent = await result.current.createRecord({
        name: { type: "text", value: "apple" },
      })
    })
    expect(sent).toBe(true)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(api.createDatabaseRecord).toHaveBeenCalledTimes(1)
    // 写成功后失效本域相关 key，会真的重新读取
    await waitFor(() =>
      expect(api.fetchDatabaseRecords.mock.calls.length).toBeGreaterThan(
        readsBefore
      )
    )
  })

  it("keeps a persistent failure in the page instead of a toast", async () => {
    setUrl("?dbTable=items")
    api.createDatabaseRecord.mockRejectedValue(
      new ApiRequestError("请求失败（HTTP 409）：违反唯一约束", 409)
    )
    const { result } = mountDatabase()
    await waitFor(() => expect(result.current.table).toBe("items"))

    await act(async () => {
      await result.current.createRecord({
        name: { type: "text", value: "apple" },
      })
    })
    expect(result.current.actionFailure).toContain("违反唯一约束")
    expect(result.current.unknownNotice).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("keeps an unknown result in the page and re-reads instead of resending", async () => {
    setUrl("?dbTable=items")
    api.createDatabaseRecord.mockRejectedValue(
      new ApiRequestError(
        "写入超过 5000 毫秒，结果未知，请重新读取确认",
        500,
        { message: "结果未知", executionStatus: "unknown" },
        undefined,
        true
      )
    )
    const { result } = mountDatabase()
    await waitFor(() => expect(result.current.table).toBe("items"))

    await act(async () => {
      await result.current.createRecord({
        name: { type: "text", value: "apple" },
      })
    })
    expect(result.current.unknownNotice).toBe(DATABASE_UNKNOWN_RESULT_NOTICE)
    expect(result.current.actionFailure).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
    expect(api.createDatabaseRecord).toHaveBeenCalledTimes(1)
  })

  it("deletes through the batch endpoint with the expected signatures", async () => {
    setUrl("?dbTable=items")
    const { result } = mountDatabase()
    await waitFor(() => expect(result.current.table).toBe("items"))

    await act(async () => {
      await result.current.deleteRecords([
        { key, expectedSignature: "row-sig" },
      ])
    })
    expect(api.deleteDatabaseRecords).toHaveBeenCalledWith("items", {
      items: [{ key, expectedSignature: "row-sig" }],
    })
    expect(toast.success).toHaveBeenCalledTimes(1)
  })
})

describe("useDatabase foreground resume", () => {
  it("re-reads on resume without replaying any action", async () => {
    setUrl("?dbTable=items")
    const { result } = mountDatabase()
    await waitFor(() => expect(result.current.tableDetail).not.toBeNull())
    const readsBefore = api.fetchDatabaseRecords.mock.calls.length

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() =>
      expect(api.fetchDatabaseRecords.mock.calls.length).toBeGreaterThan(
        readsBefore
      )
    )
    expect(api.createDatabaseRecord).not.toHaveBeenCalled()
    expect(api.updateDatabaseRecord).not.toHaveBeenCalled()
    expect(api.deleteDatabaseRecords).not.toHaveBeenCalled()
  })
})
