import {
  TASK_REQUEST_ID_HEADER,
  TaskRequestIdSchema,
} from "@shared/api-contract"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ApiRequestError,
  apiClient,
  newRequestId,
  taskRequestHeaders,
  unwrap,
} from "./client"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("client response handling", () => {
  it("returns successful bodies and preserves HTTP failure details", () => {
    expect(
      unwrap<{ value: number }>({ status: 200, body: { value: 1 } })
    ).toEqual({
      value: 1,
    })

    try {
      unwrap({ status: 409, body: { message: "状态冲突" } })
      throw new Error("expected unwrap to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError)
      expect(error).toMatchObject({
        status: 409,
        responseBody: { message: "状态冲突" },
      })
      expect((error as Error).message).toContain("状态冲突")
    }
  })

  it("marks write request failures as having an unknown result", () => {
    const error = new ApiRequestError(
      "请求结果未知，请重新读取确认",
      null,
      undefined,
      undefined,
      true
    )
    expect(error.resultUnknown).toBe(true)
    expect(error.status).toBeNull()
  })

  it("uses plain text when a server does not return JSON", () => {
    expect(() => unwrap({ status: 502, body: "upstream unavailable" })).toThrow(
      "upstream unavailable"
    )
  })
})

describe("request identity", () => {
  it("generates url-safe identifiers accepted by the server contract", () => {
    const ids = new Set<string>()
    for (let index = 0; index < 20; index += 1) {
      const id = newRequestId()
      expect(TaskRequestIdSchema.safeParse(id).success).toBe(true)
      ids.add(id)
    }
    expect(ids.size).toBe(20)
    expect(taskRequestHeaders("req_0123456789abcdef")).toEqual({
      [TASK_REQUEST_ID_HEADER]: "req_0123456789abcdef",
    })
  })

  it("sends the request id header on write requests", async () => {
    const captures: RequestInit[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init: RequestInit) => {
        captures.push(init)
        return new Response(
          JSON.stringify({
            taskId: "task-1",
            kind: "disk_scan",
            status: "running",
            startedAt: 1,
          }),
          { status: 202, headers: { "content-type": "application/json" } }
        )
      })
    )

    const response = await apiClient.startScan({
      headers: taskRequestHeaders("req_0123456789abcdef"),
    })

    expect(response.status).toBe(202)
    const headers = new Headers(captures[0].headers)
    expect(headers.get(TASK_REQUEST_ID_HEADER)).toBe("req_0123456789abcdef")
  })

  it("keeps the request id on a failed write so the task can be looked up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      })
    )

    try {
      await apiClient.startScan({
        headers: taskRequestHeaders("req_0123456789abcdef"),
      })
      throw new Error("expected a failure")
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError)
      expect(error).toMatchObject({
        status: null,
        resultUnknown: true,
        requestId: "req_0123456789abcdef",
      })
      expect((error as Error).message).toContain("结果未知")
    }
  })

  it("reports a timeout as unknown for writes and as a timeout for reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const error = new Error("timed out")
        error.name = "TimeoutError"
        throw error
      })
    )

    await expect(
      apiClient.startScan({
        headers: taskRequestHeaders("req_0123456789abcdef"),
      })
    ).rejects.toMatchObject({ resultUnknown: true })
    await expect(
      apiClient.startScan({
        headers: taskRequestHeaders("req_0123456789abcdef"),
      })
    ).rejects.toThrow(/超时/)

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const error = new Error("timed out")
        error.name = "TimeoutError"
        throw error
      })
    )
    await expect(apiClient.getHealth()).rejects.toMatchObject({
      resultUnknown: false,
    })
  })

  it("aborts the request when the caller aborts, and classifies a timeout as unknown", async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init: RequestInit) => {
        seen = init.signal as AbortSignal
        return new Promise<Response>((_resolve, reject) => {
          seen?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          )
        })
      })
    )

    const controller = new AbortController()
    const promise = apiClient.startScan({
      headers: taskRequestHeaders("req_0123456789abcdef"),
      fetchOptions: { signal: controller.signal },
    })
    const assertion = expect(promise).rejects.toMatchObject({
      status: null,
      resultUnknown: true,
      requestId: "req_0123456789abcdef",
    })
    // 调用方信号必须传递到实际请求上
    await vi.waitFor(() => expect(seen).toBeDefined())
    controller.abort()
    await assertion
  })

  it("surfaces HTTP failures without turning them into write results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "请求失败" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          })
      )
    )
    const response = await apiClient.startScan({
      headers: taskRequestHeaders("req_0123456789abcdef"),
    })
    expect(response.status).toBe(500)
    expect(() => unwrap(response)).toThrow(ApiRequestError)
  })
})
