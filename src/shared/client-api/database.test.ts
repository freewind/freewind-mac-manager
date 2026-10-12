import { afterEach, describe, expect, it, vi } from "vitest"
import type { ApiRequestError } from "./client"
import {
  createDatabaseRecord,
  deleteDatabaseRecords,
  fetchDatabaseRecord,
  fetchDatabaseRecords,
  fetchDatabaseTable,
  fetchDatabaseTables,
  updateDatabaseRecord,
} from "./database"

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const recordsBody = {
  table: "items",
  records: [],
  page: 1,
  pageSize: 10,
  total: 0,
  signature: "sig",
}

const recordBody = {
  table: "items",
  record: {
    key: [{ column: "id", value: { type: "integer" as const, value: "1" } }],
    values: { id: { type: "integer" as const, value: "1" } },
    signature: "sig",
  },
}

const stubFetch = (response: Response | (() => Promise<Response>)) => {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) =>
    typeof response === "function" ? response() : response
  )
  vi.stubGlobal("fetch", mock)
  return mock
}

const urlOf = (mock: ReturnType<typeof stubFetch>, index = 0): string =>
  String(mock.mock.calls[index][0])

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("database read calls", () => {
  it("serialises filters and sorts in the extended query form", async () => {
    const mock = stubFetch(jsonResponse(recordsBody))
    await fetchDatabaseRecords("items", {
      page: 1,
      pageSize: 10,
      filters: [
        {
          column: "qty",
          operator: "gte",
          value: { type: "integer", value: "5" },
        },
      ],
      sorts: [{ column: "id", direction: "desc" }],
    })
    const init = mock.mock.calls[0][1]
    expect(init?.method).toBe("GET")
    const url = urlOf(mock)
    expect(url.startsWith("/api/database/tables/items/records?")).toBe(true)
    const decoded = decodeURIComponent(url)
    for (const fragment of [
      "page=1",
      "pageSize=10",
      "filters[0][column]=qty",
      "filters[0][operator]=gte",
      "filters[0][value][type]=integer",
      "filters[0][value][value]=5",
      "sorts[0][column]=id",
      "sorts[0][direction]=desc",
    ]) {
      expect(decoded).toContain(fragment)
    }
    // 真实发出的是百分号编码的方括号形式
    expect(url).toContain("filters%5B0%5D%5Bcolumn%5D=qty")
  })

  it("serialises a composite primary key in the query form", async () => {
    const mock = stubFetch(jsonResponse(recordBody))
    await fetchDatabaseRecord("composite", [
      { column: "a", value: { type: "text", value: "a1" } },
      { column: "b", value: { type: "integer", value: "2" } },
    ])
    const decoded = decodeURIComponent(urlOf(mock))
    expect(decoded).toContain("/api/database/tables/composite/record?")
    for (const fragment of [
      "key[0][column]=a",
      "key[0][value][type]=text",
      "key[0][value][value]=a1",
      "key[1][column]=b",
      "key[1][value][type]=integer",
      "key[1][value][value]=2",
    ]) {
      expect(decoded).toContain(fragment)
    }
  })

  it("passes a cancellable signal to fetch", async () => {
    const mock = stubFetch(jsonResponse({ tables: [] }))
    const controller = new AbortController()
    await fetchDatabaseTables({ signal: controller.signal })
    const signal = mock.mock.calls[0][1]?.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    controller.abort()
    // 组合信号跟着调用方取消，只读查询才能真正被中断
    expect(signal?.aborted).toBe(true)
  })

  it("unwraps successful bodies and rejects unknown tables", async () => {
    stubFetch(jsonResponse({ tables: [] }))
    await expect(fetchDatabaseTables()).resolves.toEqual({ tables: [] })

    stubFetch(jsonResponse({ message: "表或视图「nope」不存在" }, 404))
    await expect(fetchDatabaseTable("nope")).rejects.toMatchObject({
      status: 404,
      resultUnknown: false,
    })
  })
})

describe("database write calls", () => {
  it("sends insert, update and delete with the right method and body", async () => {
    const mock = stubFetch(jsonResponse(recordBody, 201))
    await createDatabaseRecord("items", {
      values: { name: { type: "text", value: "apple" } },
    })
    expect(mock.mock.calls[0][1]?.method).toBe("POST")
    expect(urlOf(mock)).toBe("/api/database/tables/items/records")
    expect(JSON.parse(String(mock.mock.calls[0][1]?.body))).toEqual({
      values: { name: { type: "text", value: "apple" } },
    })

    const patchMock = stubFetch(jsonResponse(recordBody))
    await updateDatabaseRecord("items", {
      key: recordBody.record.key,
      expectedSignature: "sig",
      values: { qty: { type: "integer", value: "5" } },
    })
    expect(patchMock.mock.calls[0][1]?.method).toBe("PATCH")
    expect(urlOf(patchMock)).toBe("/api/database/tables/items/records")

    const deleteMock = stubFetch(
      jsonResponse({ deleted: [], conflicts: [], failed: [] })
    )
    await deleteDatabaseRecords("items", {
      items: [{ key: recordBody.record.key, expectedSignature: "sig" }],
    })
    expect(deleteMock.mock.calls[0][1]?.method).toBe("POST")
    expect(urlOf(deleteMock)).toBe("/api/database/tables/items/records/delete")
  })

  it("does not send an offline write", async () => {
    vi.stubGlobal("navigator", { onLine: false })
    const mock = stubFetch(jsonResponse(recordBody, 201))
    await expect(
      createDatabaseRecord("items", {
        values: { name: { type: "text", value: "apple" } },
      })
    ).rejects.toMatchObject({ status: 0, resultUnknown: false })
    expect(mock).not.toHaveBeenCalled()
  })

  it("marks an interrupted write as unknown and does not retry", async () => {
    const mock = stubFetch(() => Promise.reject(new TypeError("fetch failed")))
    await expect(
      createDatabaseRecord("items", {
        values: { name: { type: "text", value: "apple" } },
      })
    ).rejects.toMatchObject({ status: null, resultUnknown: true })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("keeps the execution status from the server error body", async () => {
    stubFetch(
      jsonResponse(
        {
          message: "记录已变化，请重新读取后再修改",
          executionStatus: "not_started",
        },
        409
      )
    )
    const conflict = await createDatabaseRecord("items", {
      values: { name: { type: "text", value: "apple" } },
    }).catch((error: unknown) => error as ApiRequestError)
    expect(conflict).toMatchObject({
      status: 409,
      resultUnknown: false,
    })

    stubFetch(
      jsonResponse(
        {
          message: "写入超过 5000 毫秒，结果未知，请重新读取确认",
          executionStatus: "unknown",
        },
        500
      )
    )
    const unknown = await createDatabaseRecord("items", {
      values: { name: { type: "text", value: "apple" } },
    }).catch((error: unknown) => error as ApiRequestError)
    // 结果未知不能被当成普通失败，也不能自动重发
    expect(unknown).toMatchObject({ status: 500, resultUnknown: true })
  })

  it("reports a failed write once without retrying", async () => {
    const mock = stubFetch(jsonResponse({ message: "写入失败" }, 500))
    await expect(
      deleteDatabaseRecords("items", {
        items: [{ key: recordBody.record.key, expectedSignature: "sig" }],
      })
    ).rejects.toMatchObject({ status: 500 })
    expect(mock).toHaveBeenCalledTimes(1)
  })
})
