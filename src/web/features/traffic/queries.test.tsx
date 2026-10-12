// @vitest-environment jsdom

import type { TrafficGroup, TrafficStatus } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FALLBACK_INTERVAL_SECONDS,
  trafficKeys,
  trafficPollMs,
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
  vi.restoreAllMocks()
  api.fetchTrafficStatus.mockReset()
  api.fetchTrafficGroups.mockReset()
})

describe("trafficPollMs", () => {
  it("跟随状态里的采样秒数，状态缺失时用兜底秒数", () => {
    expect(trafficPollMs(1)).toBe(1000)
    expect(trafficPollMs(2.5)).toBe(2500)
    expect(trafficPollMs(undefined)).toBe(FALLBACK_INTERVAL_SECONDS * 1000)
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

describe("进程明细的轮询", () => {
  it("实时态按状态里的采样间隔轮询", async () => {
    api.fetchTrafficGroups.mockResolvedValue(groupsBody)
    const client = createClient()
    client.setQueryData(trafficKeys.status, status(0.05))
    mount(() => useTrafficGroups([]), client)

    await waitFor(() => expect(api.fetchTrafficGroups).toHaveBeenCalledTimes(1))
    await waitFor(
      () =>
        expect(api.fetchTrafficGroups.mock.calls.length).toBeGreaterThanOrEqual(
          3
        ),
      { timeout: 2000 }
    )
  })

  it("还没有状态时按兜底间隔轮询", async () => {
    api.fetchTrafficGroups.mockResolvedValue(groupsBody)
    mount(() => useTrafficGroups([]))

    await waitFor(() => expect(api.fetchTrafficGroups).toHaveBeenCalledTimes(1))
    await waitFor(
      () =>
        expect(api.fetchTrafficGroups.mock.calls.length).toBeGreaterThanOrEqual(
          2
        ),
      { timeout: 3000 }
    )
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
