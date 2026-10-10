// @vitest-environment jsdom

import { TaskRecordSchema } from "@shared/api-contract"
import { ApiRequestError, type Execution } from "@shared/client-api"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useTaskAction } from "@web/hooks/use-task-action"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerTaskCompletion } from "./completion"
import {
  clearPendingRequests,
  listPendingRequests,
  rememberPendingRequest,
} from "./pending-requests"
import { useActiveTasks } from "./queries"
import { TaskCard } from "./TaskCard"
import { TaskCenter } from "./TaskCenter"
import { useTaskRecovery } from "./useTaskRecovery"

const { toastMock } = vi.hoisted(() => {
  const fn = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  })
  return { toastMock: fn }
})
vi.mock("sonner", () => ({ toast: toastMock }))

const taskRecord = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  requestId: "req_1",
  kind: "file_delete",
  target: "/tmp/a",
  status: "running",
  progress: {
    done: 3,
    total: null,
    bytesDone: null,
    bytesTotal: null,
    stage: "删除中",
    currentTarget: "/tmp/a/b",
  },
  message: null,
  error: null,
  result: null,
  startedAt: 1000,
  finishedAt: null,
  updatedAt: 1000,
  ...overrides,
})

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

let fetchCalls: string[] = []
let detailStatus = "running"

beforeEach(() => {
  fetchCalls = []
  detailStatus = "running"
  clearPendingRequests()
  toastMock.mockClear()
  toastMock.success.mockClear()
  toastMock.error.mockClear()
  toastMock.warning.mockClear()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      fetchCalls.push(input)
      if (input.startsWith("/api/tasks?")) {
        return json({ tasks: [taskRecord()], page: 1, pageSize: 50, total: 1 })
      }
      if (input.startsWith("/api/tasks/task-1")) {
        return json(
          detailStatus === "running"
            ? taskRecord()
            : taskRecord({
                status: "done",
                result: {
                  completed: ["/tmp/a"],
                  failed: [],
                  skipped: [],
                  bytes: null,
                },
                message: "已删除 1 项",
                finishedAt: 1010,
                updatedAt: 1010,
              })
        )
      }
      throw new Error(`未预期的请求：${input}`)
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

const wrapper =
  (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

describe("TaskCenter", () => {
  it("shows the in-progress count and the real progress numbers", async () => {
    const client = makeClient()
    render(<TaskCenter />, { wrapper: wrapper(client) })

    const trigger = await screen.findByRole("button", {
      name: /任务，进行中 1 个/,
    })
    await userEvent.click(trigger)

    expect(await screen.findByText("删除文件")).toBeTruthy()
    // 真实数字：已处理 3；总量未知时不显示百分比
    expect(screen.getByText(/已处理 3/)).toBeTruthy()
    // 已用时间是独立信息，不是进度
    expect(screen.getByText(/已运行 \d+ 秒/)).toBeTruthy()
  })

  it("closes the task sheet when browser back is pressed", async () => {
    const client = makeClient()
    render(<TaskCenter />, { wrapper: wrapper(client) })
    await userEvent.click(screen.getByRole("button", { name: /任务/ }))
    expect(await screen.findByRole("dialog")).toBeTruthy()

    window.history.replaceState({}, "", window.location.href)
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }))
    })

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("shows structured task result details", () => {
    render(
      <TaskCard
        task={TaskRecordSchema.parse(
          taskRecord({
            status: "done",
            result: {
              completed: ["/tmp/a"],
              failed: [{ path: "/tmp/b", message: "权限不足" }],
              skipped: [],
              bytes: null,
            },
            finishedAt: 1010,
          })
        )}
      />
    )
    expect(screen.getByText("已完成：/tmp/a")).toBeTruthy()
    expect(screen.getByText("失败：/tmp/b，权限不足")).toBeTruthy()
  })

  it("shows completed task results in the task center", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const activeOnly =
          new URL(input, "http://localhost").searchParams.get("status") ===
          "active"
        return json({
          tasks: activeOnly
            ? []
            : [
                taskRecord({
                  status: "partial",
                  result: {
                    completed: ["/tmp/a"],
                    failed: [{ path: "/tmp/b", message: "权限不足" }],
                    skipped: [],
                    bytes: null,
                  },
                  finishedAt: 1010,
                }),
              ],
          page: 1,
          pageSize: 50,
          total: activeOnly ? 0 : 1,
        })
      })
    )
    render(<TaskCenter />, { wrapper: wrapper(makeClient()) })
    await userEvent.click(screen.getByRole("button", { name: /任务/ }))
    expect(await screen.findByText("失败：/tmp/b，权限不足")).toBeTruthy()
  })

  it("reports an unreadable task list instead of pretending there is none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "请求失败" }, 500))
    )
    const client = makeClient()
    render(<TaskCenter />, { wrapper: wrapper(client) })

    await userEvent.click(screen.getByRole("button", { name: /任务/ }))
    expect(await screen.findByText(/读取任务失败/)).toBeTruthy()
  })
})

describe("useTaskAction", () => {
  it("persists the request before sending and clears it after completion", async () => {
    let sentRequestId = ""
    const runFn = vi.fn(async (requestId: string) => {
      sentRequestId = requestId
      expect(listPendingRequests()).toMatchObject([
        { requestId, kind: "file_delete", target: "/tmp/a", taskId: null },
      ])
      return {
        kind: "completed" as const,
        status: 200,
        body: { message: "已删除" },
      }
    })
    const client = makeClient()
    const { result } = renderHook(
      () =>
        useTaskAction<{ message: string }, undefined>({
          kind: "file_delete",
          target: "/tmp/a",
          run: runFn,
          onCompleted: vi.fn(),
        }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.run(undefined)
    })

    expect(runFn).toHaveBeenCalledTimes(1)
    expect(sentRequestId).toMatch(/^req_/)
    expect(listPendingRequests()).toEqual([])
  })

  it("does not send a write when pending recovery cannot be persisted", async () => {
    const runFn = vi.fn()
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError")
    })
    const client = makeClient()
    const { result } = renderHook(
      () =>
        useTaskAction<{ message: string }, undefined>({
          kind: "file_delete",
          target: "/tmp/a",
          run: runFn,
          onCompleted: vi.fn(),
        }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.run(undefined)
    })

    expect(runFn).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringContaining("操作未发送")
    )
  })

  it("handles a fast completion without waiting for a task", async () => {
    const onCompleted = vi.fn()
    const client = makeClient()
    const { result } = renderHook(
      () =>
        useTaskAction<{ message: string }, undefined>({
          kind: "file_delete",
          target: "/tmp/a",
          run: async (): Promise<Execution<{ message: string }>> => ({
            kind: "completed",
            status: 200,
            body: { message: "已删除" },
          }),
          onCompleted,
        }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.run(undefined)
    })

    expect(onCompleted).toHaveBeenCalledWith({ message: "已删除" }, undefined)
    expect(result.current.busy).toBe(false)
    expect(fetchCalls).toEqual([])
    expect(listPendingRequests()).toEqual([])
  })

  it("clears a persisted intent when the server rejects the write", async () => {
    const client = makeClient()
    const { result } = renderHook(
      () =>
        useTaskAction<{ message: string }, undefined>({
          kind: "file_delete",
          target: "/tmp/a",
          run: async () => {
            throw new ApiRequestError("目标冲突", 409)
          },
          onCompleted: vi.fn(),
        }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.run(undefined)
    })

    expect(listPendingRequests()).toEqual([])
  })

  it("refreshes the active list when a task is accepted", async () => {
    const client = makeClient()
    const runFn = vi.fn(async () => ({
      kind: "accepted" as const,
      body: {
        taskId: "task-1",
        kind: "file_delete",
        status: "running" as const,
        startedAt: 1000,
      },
    }))
    const { result } = renderHook(
      () => {
        useActiveTasks(true)
        return useTaskAction({
          kind: "file_delete",
          target: "/tmp/a",
          run: runFn,
          onCompleted: vi.fn(),
        })
      },
      { wrapper: wrapper(client) }
    )
    await waitFor(() =>
      expect(
        fetchCalls.filter((url) => url.startsWith("/api/tasks?")).length
      ).toBe(1)
    )
    await act(async () => {
      await result.current.run(undefined)
    })
    await waitFor(() =>
      expect(
        fetchCalls.filter((url) => url.startsWith("/api/tasks?")).length
      ).toBe(2)
    )
  })

  it("restores a pending action guard after remounting", () => {
    rememberPendingRequest({
      requestId: "req_remount",
      kind: "file_delete",
      target: "/tmp/a",
      taskId: null,
      startedAt: 1000,
    })
    const { result } = renderHook(
      () =>
        useTaskAction({
          kind: "file_delete",
          target: "/tmp/a",
          run: vi.fn(),
          onCompleted: vi.fn(),
        }),
      { wrapper: wrapper(makeClient()) }
    )
    expect(result.current.busy).toBe(true)
  })

  it("keeps busy until the accepted task really finishes", async () => {
    const completed: string[] = []
    registerTaskCompletion("file_delete", (task) => {
      completed.push(task.status)
    })
    const client = makeClient()
    const { result } = renderHook(
      () =>
        useTaskAction<{ message: string }, undefined>({
          kind: "file_delete",
          target: "/tmp/a",
          run: async (): Promise<Execution<{ message: string }>> => ({
            kind: "accepted",
            body: {
              taskId: "task-1",
              kind: "file_delete",
              status: "running",
              startedAt: 1000,
            },
          }),
          onCompleted: vi.fn(),
        }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.run(undefined)
    })

    // 受理不是成功：没有成功提示，且 busy 延续到任务终结
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(true)
    expect(result.current.watchingTaskId).toBe("task-1")
    expect(listPendingRequests()).toHaveLength(1)

    detailStatus = "done"
    // 详情轮询到终态需要等一个轮询周期
    await waitFor(() => expect(result.current.busy).toBe(false), {
      timeout: 6000,
    })
    await waitFor(() => expect(completed).toEqual(["done"]))
    expect(toastMock.success).toHaveBeenCalledTimes(1)
    // 核实完成后不再保留待核实标识
    await waitFor(() => expect(listPendingRequests()).toEqual([]))
  })

  it("retains an accepted action while its task detail is temporarily unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        fetchCalls.push(input)
        return input.startsWith("/api/tasks/task-1")
          ? json({ message: "暂时无法读取任务" }, 503)
          : json({ tasks: [], page: 1, pageSize: 50, total: 0 })
      })
    )
    const client = makeClient()
    const { result } = renderHook(
      () =>
        useTaskAction<{ message: string }, undefined>({
          kind: "file_delete",
          target: "/tmp/a",
          run: async (): Promise<Execution<{ message: string }>> => ({
            kind: "accepted",
            body: {
              taskId: "task-1",
              kind: "file_delete",
              status: "running",
              startedAt: 1000,
            },
          }),
          onCompleted: vi.fn(),
        }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.run(undefined)
    })
    expect(listPendingRequests()).toHaveLength(1)

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0))
    expect(listPendingRequests()).toHaveLength(1)
    expect(result.current.busy).toBe(true)
    await act(async () => {
      await result.current.run(undefined)
    })
    expect(listPendingRequests()).toHaveLength(1)
  })

  it("keeps the request id for verification when the result is unknown", async () => {
    const client = makeClient()
    const runFn = vi.fn(async () => {
      throw new ApiRequestError(
        "请求结果未知，请重新读取确认",
        null,
        undefined,
        undefined,
        true,
        "req_unknown"
      )
    })
    const { result } = renderHook(
      () =>
        useTaskAction<{ message: string }, undefined>({
          kind: "file_delete",
          target: "/tmp/a",
          run: runFn,
          onCompleted: vi.fn(),
        }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.run(undefined)
    })

    expect(runFn).toHaveBeenCalledTimes(1)
    expect(intents()).toHaveLength(1)
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(result.current.busy).toBe(true)
    expect(result.current.watchingTaskId).toBeNull()
    await act(async () => {
      await result.current.run(undefined)
    })
    expect(runFn).toHaveBeenCalledTimes(1)
  })
})

describe("useTaskRecovery", () => {
  const seedPending = (taskId: string | null): void => {
    rememberPendingRequest({
      requestId: "req_recovery0000000001",
      kind: "file_delete",
      target: "/tmp/a",
      startedAt: 1000,
      taskId,
    })
  }

  it("verifies a pending operation by task id and clears it once terminal", async () => {
    const completed: string[] = []
    registerTaskCompletion("file_delete", (task) => {
      completed.push(task.status)
    })
    seedPending("task-1")
    detailStatus = "done"
    const client = makeClient()
    const { result } = renderHook(() => useTaskRecovery(true), {
      wrapper: wrapper(client),
    })

    await waitFor(() => expect(completed).toEqual(["done"]))
    await waitFor(() => expect(listPendingRequests()).toEqual([]))
    // 只读核实：不会因为恢复而重发任何写请求
    expect(fetchCalls.every((url) => url.startsWith("/api/tasks"))).toBe(true)
    expect(result.current.unresolved).toBe(0)
  })

  it("keeps a pending operation while the task is still running", async () => {
    seedPending("task-1")
    const client = makeClient()
    const { result } = renderHook(() => useTaskRecovery(true), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.verifying).toBe(false))
    expect(listPendingRequests()).toHaveLength(1)
    expect(result.current.unresolved).toBe(0)
  })

  it("rechecks a restored running operation until it reaches a terminal state", async () => {
    seedPending("task-1")
    const client = makeClient()
    renderHook(() => useTaskRecovery(true), { wrapper: wrapper(client) })
    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThanOrEqual(2), {
      timeout: 5000,
    })

    detailStatus = "done"
    await waitFor(() => expect(listPendingRequests()).toEqual([]), {
      timeout: 5000,
    })
  })

  it("rechecks a temporarily unavailable task and keeps its pending record", async () => {
    seedPending("task-1")
    let unavailable = true
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        fetchCalls.push(input)
        if (input.startsWith("/api/tasks/task-1")) {
          return unavailable
            ? json({ message: "暂时无法查询" }, 503)
            : json(
                taskRecord({
                  status: "done",
                  result: { completed: ["/tmp/a"] },
                  message: "已删除 1 项",
                  finishedAt: 1010,
                  updatedAt: 1010,
                })
              )
        }
        throw new Error(`未预期的请求：${input}`)
      })
    )
    const client = makeClient()
    const { result } = renderHook(() => useTaskRecovery(true), {
      wrapper: wrapper(client),
    })

    await waitFor(() => expect(result.current.unresolved).toBe(1))
    expect(listPendingRequests()).toHaveLength(1)

    unavailable = false
    await act(async () => {
      await result.current.verify()
    })
    await waitFor(() => expect(listPendingRequests()).toEqual([]))
    expect(result.current.unresolved).toBe(0)
  })

  it("reports an unverifiable operation instead of guessing or retrying", async () => {
    seedPending("task-missing")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        fetchCalls.push(input)
        if (input.startsWith("/api/tasks?")) {
          // 按请求标识也找不到任何记录
          return json({ tasks: [], page: 1, pageSize: 1, total: 0 })
        }
        return json({ message: "没有找到该任务记录" }, 404)
      })
    )
    const client = makeClient()
    const { result } = renderHook(() => useTaskRecovery(true), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.unresolved).toBe(1))
    // 查不到不能当成没执行，也不能自动重做：只读了两次（任务标识与请求标识）
    expect(listPendingRequests()).toHaveLength(1)
    expect(fetchCalls).toHaveLength(2)
  })

  it("finds a pending operation by request id when the task id is unknown", async () => {
    seedPending(null)
    detailStatus = "done"
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        fetchCalls.push(input)
        if (input.startsWith("/api/tasks?")) {
          return json({
            tasks: [taskRecord({ status: "done", finishedAt: 1010 })],
            page: 1,
            pageSize: 1,
            total: 1,
          })
        }
        throw new Error(`未预期的请求：${input}`)
      })
    )
    const client = makeClient()
    const { result } = renderHook(() => useTaskRecovery(true), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(listPendingRequests()).toEqual([]))
    expect(result.current.unresolved).toBe(0)
  })

  it("preserves an unknown terminal result and its action guard", async () => {
    seedPending("task-unknown")
    const run = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          taskRecord({
            id: "task-unknown",
            status: "unknown",
            error: "服务中断，结果未知",
            finishedAt: 1010,
          })
        )
      )
    )
    const { result } = renderHook(
      () => ({
        recovery: useTaskRecovery(true),
        action: useTaskAction({
          kind: "file_delete",
          target: "/tmp/a",
          run,
          onCompleted: vi.fn(),
        }),
      }),
      { wrapper: wrapper(makeClient()) }
    )
    await waitFor(() => expect(result.current.recovery.unresolved).toBe(1))
    expect(listPendingRequests()).toHaveLength(1)
    expect(result.current.action.busy).toBe(true)
    await act(async () => {
      await result.current.action.run(undefined)
    })
    expect(run).not.toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
    await act(async () => {
      await result.current.recovery.verify()
    })
    expect(listPendingRequests()).toHaveLength(1)
    expect(toastMock.error).toHaveBeenCalledTimes(1)
  })

  it("does not verify anything while offline", async () => {
    seedPending("task-1")
    const client = makeClient()
    renderHook(() => useTaskRecovery(false), { wrapper: wrapper(client) })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchCalls).toEqual([])
    expect(listPendingRequests()).toHaveLength(1)
  })
})

const intents = (): { requestId: string; kind: string; target: string }[] =>
  listPendingRequests().map(({ requestId, kind, target }) => ({
    requestId,
    kind,
    target,
  }))
