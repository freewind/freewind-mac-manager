// @vitest-environment jsdom

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
import { clearPendingRequests, listPendingRequests } from "./pending-requests"
import { TaskCenter } from "./TaskCenter"

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
    render(<TaskCenter authenticated />, { wrapper: wrapper(client) })

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

  it("reports an unreadable task list instead of pretending there is none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "需要登录" }, 401))
    )
    const client = makeClient()
    render(<TaskCenter authenticated />, { wrapper: wrapper(client) })

    await userEvent.click(screen.getByRole("button", { name: /任务/ }))
    expect(await screen.findByText(/读取任务失败/)).toBeTruthy()
  })
})

describe("useTaskAction", () => {
  it("handles a fast completion without waiting for a task", async () => {
    const onCompleted = vi.fn()
    const client = makeClient()
    const { result } = renderHook(
      () =>
        useTaskAction<{ message: string }>({
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
      await result.current.run()
    })

    expect(onCompleted).toHaveBeenCalledWith({ message: "已删除" })
    expect(result.current.busy).toBe(false)
    expect(fetchCalls).toEqual([])
    expect(listPendingRequests()).toEqual([])
  })

  it("keeps busy until the accepted task really finishes", async () => {
    const completed: string[] = []
    registerTaskCompletion("file_delete", (task) => {
      completed.push(task.status)
    })
    const client = makeClient()
    const { result } = renderHook(
      () =>
        useTaskAction<{ message: string }>({
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
      await result.current.run()
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
        useTaskAction<{ message: string }>({
          kind: "file_delete",
          target: "/tmp/a",
          run: runFn,
          onCompleted: vi.fn(),
        }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.run()
    })

    expect(runFn).toHaveBeenCalledTimes(1)
    expect(intents()).toHaveLength(1)
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(result.current.busy).toBe(false)
    expect(result.current.watchingTaskId).toBeNull()
  })
})

const intents = (): { requestId: string; kind: string; target: string }[] =>
  listPendingRequests().map(({ requestId, kind, target }) => ({
    requestId,
    kind,
    target,
  }))
