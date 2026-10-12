// @vitest-environment jsdom

import type { DashboardOverview } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FALLBACK_OVERVIEW_REFRESH_SECONDS,
  overviewPollMs,
  useMachineOverview,
} from "./queries"

const api = vi.hoisted(() => ({ fetchMachineOverview: vi.fn() }))

vi.mock("@shared/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/client-api")>()),
  fetchMachineOverview: api.fetchMachineOverview,
}))

const overview = (refreshIntervalSeconds: number): DashboardOverview => ({
  sampledAt: 1_700_000_000_000,
  refreshIntervalSeconds,
  system: {
    hostname: "freewind-mbp",
    model: "MacBook Pro",
    chip: "Apple M3 Max",
    osVersion: "macOS 15.4",
    uptimeSeconds: 123_456,
    userCount: 2,
  },
  cpu: { loadAverage: [1, 1, 1], coreCount: 8, coreUsage: [10] },
  memory: {
    total: 8,
    used: 4,
    wired: 1,
    compressed: 1,
    free: 2,
    swapTotal: 0,
    swapUsed: 0,
  },
  disk: [],
  network: {
    interfaceName: "en0",
    address: "192.168.1.8",
    downloadRate: 0,
    uploadRate: 0,
    totalDown: 0,
    totalUp: 0,
  },
})

const mount = () =>
  renderHook(() => useMachineOverview(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {children}
      </QueryClientProvider>
    ),
  })

/** 让真实定时器走一段，避免 React 更新警告。 */
const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

afterEach(() => {
  cleanup()
  api.fetchMachineOverview.mockReset()
})

describe("概览刷新间隔的来源", () => {
  it("轮询间隔跟随后端返回的秒数，缺失时才用兜底值", () => {
    expect(overviewPollMs(3)).toBe(3000)
    expect(overviewPollMs(1)).toBe(1000)
    expect(overviewPollMs(undefined)).toBe(
      FALLBACK_OVERVIEW_REFRESH_SECONDS * 1000
    )
  })
})

describe("概览的轮询节奏", () => {
  it("按响应里的秒数轮询，而不是写死的 3 秒", async () => {
    api.fetchMachineOverview.mockResolvedValue(overview(0.05))
    mount()

    await waitFor(() =>
      expect(api.fetchMachineOverview).toHaveBeenCalledTimes(1)
    )
    // 0.05 秒远小于原来写死的 3 秒：证明间隔来自响应数据
    await waitFor(
      () =>
        expect(
          api.fetchMachineOverview.mock.calls.length
        ).toBeGreaterThanOrEqual(3),
      { timeout: 2000 }
    )
  })

  it("后端给的秒数较大时不会提前轮询", async () => {
    api.fetchMachineOverview.mockResolvedValue(overview(5))
    mount()

    await waitFor(() =>
      expect(api.fetchMachineOverview).toHaveBeenCalledTimes(1)
    )
    await sleep(300)
    expect(api.fetchMachineOverview).toHaveBeenCalledTimes(1)
  })

  it("还没拿到数据时按兜底间隔继续取，直到拿到响应", async () => {
    api.fetchMachineOverview.mockRejectedValueOnce(new Error("网络中断"))
    api.fetchMachineOverview.mockResolvedValue(overview(0.05))
    mount()

    await waitFor(
      () => expect(api.fetchMachineOverview).toHaveBeenCalledTimes(2),
      // 兜底间隔是 3 秒：第一次失败后要等满这一轮才会重取。
      { timeout: 6000 }
    )
  })
})
