// @vitest-environment jsdom

import type { TrafficGroup, TrafficStatus } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FALLBACK_INTERVAL_SECONDS,
  REALTIME_DETAILS_REFRESH_MS,
  statusPollMs,
  trafficKeys,
  useTrafficGroups,
  useTrafficStatus,
} from "./queries"

const api = vi.hoisted(() => ({
  fetchTrafficStatus: vi.fn(),
  fetchTrafficGroups: vi.fn(),
}))

vi.mock("@shared/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/client-api")>()),
  fetchTrafficStatus: api.fetchTrafficStatus,
  fetchTrafficGroups: api.fetchTrafficGroups,
}))

const status = (intervalSeconds: number): TrafficStatus => ({
  running: true,
  intervalSeconds,
  sampledAt: 1_791_700_000,
  downloadRate: 0,
  uploadRate: 0,
})

const groupsBody = { scope: "实时", groups: [] as TrafficGroup[] }

const createClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

const mount = <T,>(hook: () => T, client = createClient()) =>
  renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })

/** 让真实定时器走一段，用 act 包住避免 React 的更新警告。 */
const sleep = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  api.fetchTrafficStatus.mockReset()
  api.fetchTrafficGroups.mockReset()
})

describe("轮询间隔的来源", () => {
  it("状态间隔跟随后端采样秒数，明细间隔是独立的慢节奏", () => {
    expect(statusPollMs(1)).toBe(1000)
    expect(statusPollMs(2.5)).toBe(2500)
    expect(statusPollMs(undefined)).toBe(FALLBACK_INTERVAL_SECONDS * 1000)
    // 明细含 ps+lsof，固定慢节奏，不随采样间隔变化
    expect(REALTIME_DETAILS_REFRESH_MS).toBe(5000)
    expect(REALTIME_DETAILS_REFRESH_MS).toBeGreaterThan(statusPollMs(1))
  })
})

describe("状态的轮询间隔", () => {
  it("按状态返回的秒数轮询，而不是写死的间隔", async () => {
    api.fetchTrafficStatus.mockResolvedValue(status(0.05))
    mount(() => useTrafficStatus())

    await waitFor(() => expect(api.fetchTrafficStatus).toHaveBeenCalledTimes(1))
    // 0.05 秒远小于原来的 5 秒：证明间隔来自状态数据
    await waitFor(
      () =>
        expect(api.fetchTrafficStatus.mock.calls.length).toBeGreaterThanOrEqual(
          3
        ),
      { timeout: 2000 }
    )
  })

  it("状态给的间隔较大时不会提前轮询", async () => {
    api.fetchTrafficStatus.mockResolvedValue(status(5))
    mount(() => useTrafficStatus())

    await waitFor(() => expect(api.fetchTrafficStatus).toHaveBeenCalledTimes(1))
    await sleep(300)
    expect(api.fetchTrafficStatus).toHaveBeenCalledTimes(1)
  })

  it("首次取不到状态时按兜底间隔继续取，直到拿到状态", async () => {
    api.fetchTrafficStatus.mockRejectedValueOnce(new Error("网络中断"))
    api.fetchTrafficStatus.mockResolvedValue(status(0.05))
    mount(() => useTrafficStatus())

    // 第一次失败后没有数据，仍按兜底间隔重新取数
    await waitFor(
      () => expect(api.fetchTrafficStatus).toHaveBeenCalledTimes(2),
      { timeout: 3000 }
    )
  })

  it("页面不可见时暂停轮询，恢复可见后继续", async () => {
    api.fetchTrafficStatus.mockResolvedValue(status(0.05))
    const visibility = vi.spyOn(document, "visibilityState", "get")
    mount(() => useTrafficStatus())

    await waitFor(() => expect(api.fetchTrafficStatus).toHaveBeenCalledTimes(1))

    act(() => {
      visibility.mockReturnValue("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    const paused = api.fetchTrafficStatus.mock.calls.length
    await sleep(300)
    expect(api.fetchTrafficStatus.mock.calls.length).toBe(paused)

    act(() => {
      visibility.mockReturnValue("visible")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(
      () =>
        expect(api.fetchTrafficStatus.mock.calls.length).toBeGreaterThan(
          paused
        ),
      { timeout: 2000 }
    )
  })
})

describe("实时进程明细的刷新节奏", () => {
  it("按自己的固定节奏刷新，采样间隔再小也不跟着跑", async () => {
    vi.useFakeTimers()
    api.fetchTrafficGroups.mockResolvedValue(groupsBody)
    const client = createClient()
    // 采样间隔 0.05 秒；若明细跟着采样走，1 秒内会打好几次 lsof
    client.setQueryData(trafficKeys.status, status(0.05))
    mount(() => useTrafficGroups([]), client)

    await vi.waitFor(() =>
      expect(api.fetchTrafficGroups).toHaveBeenCalledTimes(1)
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(api.fetchTrafficGroups).toHaveBeenCalledTimes(1)

    // 走完自己的 5 秒节奏才刷新
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REALTIME_DETAILS_REFRESH_MS - 1000)
    })
    await vi.waitFor(() =>
      expect(api.fetchTrafficGroups.mock.calls.length).toBeGreaterThanOrEqual(2)
    )
  })

  it("还没有状态数据时也按自己的节奏，不按状态的兜底间隔抢跑", async () => {
    vi.useFakeTimers()
    api.fetchTrafficGroups.mockResolvedValue(groupsBody)
    mount(() => useTrafficGroups([]))

    await vi.waitFor(() =>
      expect(api.fetchTrafficGroups).toHaveBeenCalledTimes(1)
    )
    // 兜底间隔是 1 秒，明细不受它影响
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(api.fetchTrafficGroups).toHaveBeenCalledTimes(1)
  })

  it("页面不可见时明细也暂停，恢复可见后继续", async () => {
    vi.useFakeTimers()
    api.fetchTrafficGroups.mockResolvedValue(groupsBody)
    const visibility = vi.spyOn(document, "visibilityState", "get")
    mount(() => useTrafficGroups([]))

    await vi.waitFor(() =>
      expect(api.fetchTrafficGroups).toHaveBeenCalledTimes(1)
    )

    act(() => {
      visibility.mockReturnValue("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REALTIME_DETAILS_REFRESH_MS * 3)
    })
    expect(api.fetchTrafficGroups).toHaveBeenCalledTimes(1)

    act(() => {
      visibility.mockReturnValue("visible")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    // 恢复可见后重新排上自己的节奏，走完一轮即刷新
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REALTIME_DETAILS_REFRESH_MS + 100)
    })
    expect(api.fetchTrafficGroups.mock.calls.length).toBeGreaterThan(1)
  })

  it("非实时态（快照）不轮询", async () => {
    api.fetchTrafficGroups.mockResolvedValue(groupsBody)
    const client = createClient()
    client.setQueryData(trafficKeys.status, status(0.05))
    mount(() => useTrafficGroups(["snapshot-1"]), client)

    await waitFor(() => expect(api.fetchTrafficGroups).toHaveBeenCalledTimes(1))
    await sleep(300)
    expect(api.fetchTrafficGroups).toHaveBeenCalledTimes(1)
  })
})
