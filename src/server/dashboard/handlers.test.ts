import type { MachineOverview } from "@shared/api-contract"
import { describe, expect, it, vi } from "vitest"
import { dashboardRouter, OVERVIEW_REFRESH_INTERVAL_SECONDS } from "./handlers"

const { overview } = vi.hoisted(() => ({
  overview: {
    sampledAt: 1_700_000_000_000,
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
  } satisfies MachineOverview,
}))

// 采集要跑 system_profiler 等真实命令，测试里只替身数据采集。
vi.mock("@server/common/collect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/common/collect")>()),
  collectMachineOverview: async () => overview,
}))

describe("概览 handler", () => {
  it("响应带回自动刷新的秒数，前端不必自己写死", async () => {
    const response = await dashboardRouter.dashboardOverview()
    if (response.status !== 200) {
      throw new Error(`概览响应异常：${response.status}`)
    }

    expect(response.body.refreshIntervalSeconds).toBe(
      OVERVIEW_REFRESH_INTERVAL_SECONDS
    )
    expect(Number.isInteger(response.body.refreshIntervalSeconds)).toBe(true)
    expect(response.body.refreshIntervalSeconds).toBeGreaterThan(0)
    // 机器概览字段原样保留，不因新增配置项丢数据。
    expect(response.body.sampledAt).toBe(overview.sampledAt)
    expect(response.body.system.hostname).toBe("freewind-mbp")
  })
})
