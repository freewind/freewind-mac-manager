import type { Server } from "node:http"
import type { DatabaseTable } from "@shared/api-contract"
import { createExpressEndpoints } from "@ts-rest/express"
import express from "express"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createDatabaseRouter,
  type DatabaseService,
  databaseContract,
} from "./handlers"
import { DatabaseMutationError } from "./mutation-protocol"
import { DatabaseQueryError } from "./query-protocol"

/**
 * database 域的 handler 单测：只挂本域契约（鉴权由 app.ts 统一负责），
 * 服务层用受控替身，覆盖状态码映射、执行状态、入参映射与契约校验。
 * 真实的子进程与临时库放在 integration.test.ts。
 */

const record = {
  key: [{ column: "id", value: { type: "integer" as const, value: "1" } }],
  values: { id: { type: "integer" as const, value: "1" } },
  signature: "sig",
}

const recordResponse = { table: "items", record }

const recordsResponse = {
  table: "items",
  records: [record],
  page: 1,
  pageSize: 50,
  total: 1,
  signature: "sig",
}

const deleteResult = { deleted: [record.key], conflicts: [], failed: [] }

const tableDetail: DatabaseTable = {
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

let server: Server
let baseUrl: string
let calls: Array<{ name: string; input: unknown }>
let nextError: unknown

const stub =
  <T>(name: string, value: T) =>
  async (input?: unknown): Promise<T> => {
    calls.push({ name, input })
    if (nextError !== null) throw nextError
    return value
  }

const service = (): DatabaseService => ({
  listTables: stub("listTables", { tables: [] }),
  getTable: stub("getTable", tableDetail),
  listRecords: stub("listRecords", recordsResponse),
  getRecord: stub("getRecord", recordResponse),
  insert: stub("insert", recordResponse),
  update: stub("update", recordResponse),
  delete: stub("delete", deleteResult),
  shutdown: () => {},
})

const send = async (
  method: string,
  url: string,
  body?: unknown
): Promise<{
  status: number
  body: { message?: string; [key: string]: unknown }
}> => {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
  }
}

beforeEach(async () => {
  calls = []
  nextError = null
  const app = express()
  // 数组 query 需要 extended parser，与 app.ts 保持一致
  app.set("query parser", "extended")
  app.use(express.json({ limit: "32mb" }))
  createExpressEndpoints(
    databaseContract,
    createDatabaseRouter(service()),
    app,
    {
      logInitialization: false,
    }
  )
  server = app.listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe("database handler responses", () => {
  it("returns 201 for insert and 200 for the other writes", async () => {
    const created = await send("POST", "/api/database/tables/items/records", {
      values: { name: { type: "text", value: "apple" } },
    })
    expect(created).toEqual({ status: 201, body: recordResponse })

    const updated = await send("PATCH", "/api/database/tables/items/records", {
      key: record.key,
      expectedSignature: "sig",
      values: { note: { type: "text", value: "x" } },
    })
    expect(updated).toEqual({ status: 200, body: recordResponse })

    const deleted = await send(
      "POST",
      "/api/database/tables/items/records/delete",
      { items: [{ key: record.key, expectedSignature: "sig" }] }
    )
    expect(deleted).toEqual({ status: 200, body: deleteResult })
  })

  it.each([400, 403, 404, 409, 429, 500] as const)(
    "maps %s from the query side",
    async (status) => {
      nextError = new DatabaseQueryError(status, `查询失败 ${status}`)
      const response = await send("GET", "/api/database/tables")
      expect(response).toEqual({
        status,
        body: { message: `查询失败 ${status}` },
      })
    }
  )

  it.each([400, 403, 404, 409, 429, 500] as const)(
    "maps %s from the write side",
    async (status) => {
      nextError = new DatabaseMutationError(status, `写入失败 ${status}`)
      const response = await send(
        "POST",
        "/api/database/tables/items/records",
        { values: {} }
      )
      expect(response).toEqual({
        status,
        body: { message: `写入失败 ${status}`, executionStatus: "not_started" },
      })
    }
  )

  it("keeps an unknown execution status on write timeouts", async () => {
    nextError = new DatabaseMutationError(
      500,
      "写入超过 5000 毫秒，结果未知，请重新读取确认",
      "unknown"
    )
    const response = await send(
      "POST",
      "/api/database/tables/items/records/delete",
      { items: [{ key: record.key, expectedSignature: "sig" }] }
    )
    expect(response).toEqual({
      status: 500,
      body: {
        message: "写入超过 5000 毫秒，结果未知，请重新读取确认",
        executionStatus: "unknown",
      },
    })
  })

  it("never exposes internal errors or SQL text", async () => {
    nextError = new Error(
      "SQL: SELECT name FROM sqlite_schema WHERE type = 'table'"
    )
    const response = await send("GET", "/api/database/tables")
    expect(response).toEqual({
      status: 500,
      body: { message: "操作未能完成，请重新读取目标核实" },
    })
    expect(JSON.stringify(response.body)).not.toContain("SELECT")
  })
})

describe("database handler input mapping", () => {
  it("passes table, paging, filters and sorts to the service", async () => {
    await send("GET", "/api/database/tables/items")
    await send(
      "GET",
      `/api/database/tables/items/records?${new URLSearchParams({
        page: "2",
        pageSize: "10",
        "filters[0][column]": "qty",
        "filters[0][operator]": "gte",
        "filters[0][value][type]": "integer",
        "filters[0][value][value]": "5",
        "sorts[0][column]": "id",
        "sorts[0][direction]": "desc",
      }).toString()}`
    )
    await send(
      "GET",
      `/api/database/tables/items/record?${new URLSearchParams({
        "key[0][column]": "id",
        "key[0][value][type]": "integer",
        "key[0][value][value]": "1",
      }).toString()}`
    )
    await send("POST", "/api/database/tables/items/records", {
      values: { name: { type: "text", value: "apple" } },
    })
    await send("PATCH", "/api/database/tables/items/records", {
      key: record.key,
      expectedSignature: "sig",
      values: { note: { type: "text", value: "x" } },
    })
    await send("POST", "/api/database/tables/items/records/delete", {
      items: [{ key: record.key, expectedSignature: "sig" }],
    })

    expect(calls).toEqual([
      { name: "getTable", input: "items" },
      {
        name: "listRecords",
        input: {
          table: "items",
          page: 2,
          pageSize: 10,
          filters: [
            {
              column: "qty",
              operator: "gte",
              value: { type: "integer", value: "5" },
            },
          ],
          sorts: [{ column: "id", direction: "desc" }],
        },
      },
      { name: "getRecord", input: { table: "items", key: record.key } },
      {
        name: "insert",
        input: {
          table: "items",
          values: { name: { type: "text", value: "apple" } },
        },
      },
      {
        name: "update",
        input: {
          table: "items",
          key: record.key,
          expectedSignature: "sig",
          values: { note: { type: "text", value: "x" } },
        },
      },
      {
        name: "delete",
        input: {
          table: "items",
          items: [{ key: record.key, expectedSignature: "sig" }],
        },
      },
    ])
  })

  it("rejects invalid input before the service is called", async () => {
    const tooBig = await send(
      "GET",
      "/api/database/tables/items/records?pageSize=101"
    )
    expect(tooBig.status).toBe(400)
    const emptyPatch = await send(
      "PATCH",
      "/api/database/tables/items/records",
      { key: record.key, expectedSignature: "sig", values: {} }
    )
    expect(emptyPatch.status).toBe(400)
    const noValues = await send("POST", "/api/database/tables/items/records", {
      nope: true,
    })
    expect(noValues.status).toBe(400)
    expect(calls).toEqual([])
  })
})
