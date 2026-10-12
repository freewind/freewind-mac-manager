// @vitest-environment jsdom
import type { DatabaseRestoreState } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  backupKeys,
  RESTORE_STATE_POLL_MS,
  restoreStatePollMs,
  useBackupRestoreState,
} from "./queries"

const api = vi.hoisted(() => ({
  fetchDatabaseRestoreState: vi.fn(),
}))

vi.mock("@shared/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/client-api")>()),
  fetchDatabaseRestoreState: api.fetchDatabaseRestoreState,
}))

const state = (over: Partial<DatabaseRestoreState>): DatabaseRestoreState => ({
  plan: null,
  verified: false,
  ...over,
})

const plan = (
  status: DatabaseRestoreState["plan"] extends null
    ? never
    : NonNullable<DatabaseRestoreState["plan"]>["status"]
) => ({
  id: "restore-plan-1",
  backupId: "snap-1",
  backupFileName: "snapshots-1791700000000-ab12cd.sqlite3",
  status,
  createdAt: 1_791_700_000_000,
  updatedAt: 1_791_700_100_000,
  message: "重启服务后生效",
  unknownReason: status === "unknown" ? "重启过程中进程被中断" : null,
})

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

const mount = (client = createClient()) =>
  renderHook(() => useBackupRestoreState(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("备份查询 key", () => {
  it("页码、页大小与来源都进 key，动作后按 listScope 统一失效", () => {
    expect(
      backupKeys.list({ page: 2, pageSize: 50, source: "import" })
    ).toEqual(["database", "backups", "list", 2, 50, "import"])
    // 不传参数时用默认值，与不筛选的列表是同一个 key
    expect(backupKeys.list({})).toEqual(backupKeys.list({ page: 1 }))
    expect(backupKeys.listScope()).toEqual(["database", "backups", "list"])
  })
})

describe("恢复状态的轮询规则", () => {
  it("还没拿到数据、没有计划、以及终态都不轮询", () => {
    expect(restoreStatePollMs(undefined)).toBe(false)
    expect(restoreStatePollMs(state({}))).toBe(false)
    expect(restoreStatePollMs(state({ plan: plan("applied") }))).toBe(false)
    expect(restoreStatePollMs(state({ plan: plan("failed") }))).toBe(false)
    expect(restoreStatePollMs(state({ plan: plan("cancelled") }))).toBe(false)
    expect(restoreStatePollMs(state({ plan: plan("unknown") }))).toBe(false)
  })

  it("等待重启生效与正在应用时按固定节奏盯着", () => {
    expect(restoreStatePollMs(state({ plan: plan("planned") }))).toBe(
      RESTORE_STATE_POLL_MS
    )
    expect(restoreStatePollMs(state({ plan: plan("applying") }))).toBe(
      RESTORE_STATE_POLL_MS
    )
  })

  it("已核实就必须停：不再让服务端反复重算整库签名", () => {
    expect(
      restoreStatePollMs(
        state({
          plan: plan("applied"),
          verified: true,
        })
      )
    ).toBe(false)
    // 即使是 planned，只要已核实也不再轮询
    expect(
      restoreStatePollMs(state({ plan: plan("planned"), verified: true }))
    ).toBe(false)
  })
})

describe("恢复状态查询", () => {
  it("计划未终结时轮询，核实之后停止请求", async () => {
    vi.useFakeTimers()
    api.fetchDatabaseRestoreState
      .mockResolvedValueOnce(state({ plan: plan("planned") }))
      .mockResolvedValue(
        state({
          plan: plan("applied"),
          verified: true,
        })
      )

    mount()
    await vi.waitFor(() =>
      expect(api.fetchDatabaseRestoreState).toHaveBeenCalledTimes(1)
    )

    // 计划还没生效：一个节奏之后继续问
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTORE_STATE_POLL_MS)
    })
    expect(api.fetchDatabaseRestoreState).toHaveBeenCalledTimes(2)

    // 已经核实：再等两个节奏也不再请求
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTORE_STATE_POLL_MS * 2)
    })
    expect(api.fetchDatabaseRestoreState).toHaveBeenCalledTimes(2)
  })

  it("读取失败时如实抛出，不伪造「已恢复」", async () => {
    api.fetchDatabaseRestoreState.mockRejectedValue(new Error("读取失败"))
    const { result } = mount()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})
