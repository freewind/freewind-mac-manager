// @vitest-environment jsdom

import type { DatabaseRecordLocatorKey } from "@shared/api-contract"
import {
  ApiRequestError,
  type DatabaseRecordsQueryInput,
} from "@shared/client-api"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DATABASE_MUTATION_OPTIONS,
  DATABASE_READ_RETRY,
  databaseKeys,
  shouldRetryDatabaseRead,
  useCreateDatabaseRecord,
  useDatabaseRecordQuery,
  useDatabaseRecordsQuery,
  useDatabaseTableQuery,
  useDatabaseTablesQuery,
  useUpdateDatabaseRecord,
} from "./queries"

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

const tablesBody = { tables: [] }

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

const recordsQuery: DatabaseRecordsQueryInput = {
  page: 1,
  pageSize: 50,
  filters: [],
  sorts: [],
}

const mount = <T,>(hook: () => T) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return {
    client,
    ...renderHook(hook, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }),
  }
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.fetchDatabaseTables.mockResolvedValue(tablesBody)
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
})

afterEach(() => {
  cleanup()
})

describe("databaseKeys", () => {
  it("keeps every parameter in the key", () => {
    const base = databaseKeys.records("items", recordsQuery)
    expect(databaseKeys.tables()).not.toEqual(databaseKeys.table("items"))
    expect(base).not.toEqual(
      databaseKeys.records("items", { ...recordsQuery, page: 2 })
    )
    expect(base).not.toEqual(
      databaseKeys.records("items", { ...recordsQuery, pageSize: 20 })
    )
    expect(base).not.toEqual(
      databaseKeys.records("items", {
        ...recordsQuery,
        filters: [
          {
            column: "qty",
            operator: "gte",
            value: { type: "integer", value: "5" },
          },
        ],
      })
    )
    expect(base).not.toEqual(
      databaseKeys.records("items", {
        ...recordsQuery,
        sorts: [{ column: "id", direction: "desc" }],
      })
    )
    expect(base).not.toEqual(databaseKeys.records("other", recordsQuery))
    expect(databaseKeys.record("items", key)).not.toEqual(
      databaseKeys.record("items", [
        { column: "id", value: { type: "integer", value: "2" } },
      ])
    )
    // 记录查询与单条记录查询不能互相命中
    expect(databaseKeys.recordsScope("items")).not.toEqual(
      databaseKeys.recordScope("items")
    )
  })
})

describe("shouldRetryDatabaseRead", () => {
  it("retries network and server failures at most twice", () => {
    expect(shouldRetryDatabaseRead(0, new ApiRequestError("失败", 500))).toBe(
      true
    )
    expect(shouldRetryDatabaseRead(1, new Error("网络中断"))).toBe(true)
    expect(
      shouldRetryDatabaseRead(DATABASE_READ_RETRY, new Error("网络中断"))
    ).toBe(false)
    // 结果已经明确的客户端错误不重试
    for (const status of [400, 401, 403, 404, 409, 429]) {
      expect(
        shouldRetryDatabaseRead(0, new ApiRequestError("失败", status))
      ).toBe(false)
    }
  })
})

describe("database read queries", () => {
  it("passes the table, the query parameters and the abort signal", async () => {
    const tables = mount(() => useDatabaseTablesQuery())
    await waitFor(() => expect(tables.result.current.isSuccess).toBe(true))
    expect(api.fetchDatabaseTables).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    })

    const detail = mount(() => useDatabaseTableQuery("items"))
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true))
    expect(api.fetchDatabaseTable).toHaveBeenCalledWith("items", {
      signal: expect.any(AbortSignal),
    })

    const records = mount(() => useDatabaseRecordsQuery("items", recordsQuery))
    await waitFor(() => expect(records.result.current.isSuccess).toBe(true))
    expect(api.fetchDatabaseRecords).toHaveBeenCalledWith(
      "items",
      recordsQuery,
      {
        signal: expect.any(AbortSignal),
      }
    )

    const record = mount(() => useDatabaseRecordQuery("items", key))
    await waitFor(() => expect(record.result.current.isSuccess).toBe(true))
    expect(api.fetchDatabaseRecord).toHaveBeenCalledWith("items", key, {
      signal: expect.any(AbortSignal),
    })
  })

  it("does not fetch records or a single record without a table", async () => {
    const records = mount(() => useDatabaseRecordsQuery(null, recordsQuery))
    const record = mount(() => useDatabaseRecordQuery("items", null))
    await Promise.resolve()
    expect(records.result.current.fetchStatus).toBe("idle")
    expect(record.result.current.fetchStatus).toBe("idle")
    expect(api.fetchDatabaseRecords).not.toHaveBeenCalled()
    expect(api.fetchDatabaseRecord).not.toHaveBeenCalled()
  })
})

describe("database write mutations", () => {
  it("declares no retry and no offline pause", () => {
    expect(DATABASE_MUTATION_OPTIONS).toEqual({
      retry: false,
      networkMode: "always",
    })
  })

  it("invalidates the table's keys after a successful write", async () => {
    const { client, result } = mount(() => useCreateDatabaseRecord())
    client.setQueryData(databaseKeys.tables(), tablesBody)
    client.setQueryData(databaseKeys.table("items"), tableDetail)
    client.setQueryData(
      databaseKeys.records("items", recordsQuery),
      recordsBody
    )
    client.setQueryData(databaseKeys.record("items", key), recordBody)

    await act(async () => {
      await result.current.mutateAsync({
        table: "items",
        body: { values: { name: { type: "text", value: "apple" } } },
      })
    })

    expect(api.createDatabaseRecord).toHaveBeenCalledTimes(1)
    for (const queryKey of [
      databaseKeys.tables(),
      databaseKeys.table("items"),
      databaseKeys.records("items", recordsQuery),
      databaseKeys.record("items", key),
    ]) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true)
    }
  })

  it("does not retry a failed write", async () => {
    api.updateDatabaseRecord.mockRejectedValue(
      new ApiRequestError("记录已变化", 409)
    )
    const { result } = mount(() => useUpdateDatabaseRecord())
    await act(async () => {
      await result.current
        .mutateAsync({
          table: "items",
          key,
          body: {
            key,
            expectedSignature: "row-sig",
            values: { note: { type: "text", value: "x" } },
          },
        })
        .catch(() => undefined)
    })
    expect(api.updateDatabaseRecord).toHaveBeenCalledTimes(1)
  })

  it("re-reads instead of resending when the result is unknown", async () => {
    api.createDatabaseRecord.mockRejectedValue(
      new ApiRequestError(
        "写入超过 5000 毫秒，结果未知，请重新读取确认",
        500,
        { message: "结果未知", executionStatus: "unknown" },
        undefined,
        true
      )
    )
    const { client, result } = mount(() => useCreateDatabaseRecord())
    client.setQueryData(databaseKeys.table("items"), tableDetail)
    await act(async () => {
      await result.current
        .mutateAsync({
          table: "items",
          body: { values: { name: { type: "text", value: "apple" } } },
        })
        .catch(() => undefined)
    })
    // 只发过一次写入，但会重新读取核实
    expect(api.createDatabaseRecord).toHaveBeenCalledTimes(1)
    expect(
      client.getQueryState(databaseKeys.table("items"))?.isInvalidated
    ).toBe(true)
  })
})
