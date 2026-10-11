// @vitest-environment jsdom

import type {
  MachineOverview,
  PortInfo,
  ProcessInfo,
} from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { dashboardKeys } from "../queries"
import { DashboardPage } from "./DashboardPage"

/** 复现线上撑高场景：6 行进程 + 67 行监听端口。 */
const PROCESS_COUNT = 6
const PORT_COUNT = 67

const overview: MachineOverview = {
  sampledAt: 1_700_000_000_000,
  system: {
    hostname: "freewind-mbp",
    model: "MacBook Pro",
    chip: "Apple M3 Max",
    osVersion: "macOS 15.4",
    uptimeSeconds: 123_456,
    userCount: 2,
  },
  cpu: {
    loadAverage: [2.5, 2.1, 1.9],
    coreCount: 8,
    coreUsage: [10, 20, 30, 40, 50, 60, 70, 80],
  },
  memory: {
    total: 68_719_476_736,
    used: 34_359_738_368,
    wired: 8_589_934_592,
    compressed: 4_294_967_296,
    free: 21_474_836_480,
    swapTotal: 4_294_967_296,
    swapUsed: 1_073_741_824,
  },
  disk: [
    {
      name: "Macintosh HD",
      mount: "/",
      total: 994_662_584_320,
      used: 663_803_042_816,
      free: 330_859_541_504,
    },
  ],
  network: {
    interfaceName: "en0",
    address: "192.168.1.8",
    downloadRate: 125_000,
    uploadRate: 42_000,
    totalDown: 1_234_567_890,
    totalUp: 987_654_321,
  },
}

const processes: ProcessInfo[] = Array.from(
  { length: PROCESS_COUNT },
  (_, index) => ({
    pid: 1000 + index,
    name: `busy-process-${index + 1}`,
    user: "freewind",
    cpu: 40 - index * 5,
    memory: 524_288_000 - index * 52_428_800,
    command: `/usr/local/bin/busy-process-${index + 1} --serve`,
  })
)

const ports: PortInfo[] = Array.from({ length: PORT_COUNT }, (_, index) => ({
  port: 30_000 + index,
  process: `listener-${index + 1}`,
  pid: 20_000 + index,
  address: index === 0 ? "*" : `127.0.0.1:${30_000 + index}`,
}))

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { enabled: false, retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(dashboardKeys.overview, overview)
  client.setQueryData(dashboardKeys.processes, { processes })
  client.setQueryData(dashboardKeys.ports, { ports })
  render(<DashboardPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

afterEach(() => {
  cleanup()
})

describe("概览页", () => {
  it("67 行监听端口全部渲染，页面不再只显示前几行", () => {
    renderPage()

    expect(screen.getByText(`共 ${PORT_COUNT} 个端口在监听`)).toBeTruthy()
    // 67 行都在 DOM 里：限高只是把过长的列表收进内部滚动，不丢数据
    const renderedRows = ports.reduce(
      (total, item) => total + screen.getAllByText(String(item.port)).length,
      0
    )
    expect(renderedRows).toBe(PORT_COUNT)
    expect(screen.getByText(`listener-${PORT_COUNT}`)).toBeTruthy()
  })

  it("6 行占用最高进程全部渲染", () => {
    renderPage()

    expect(screen.getByText(/共 6 个/)).toBeTruthy()
    for (const item of processes) {
      expect(screen.getByText(item.name)).toBeTruthy()
    }
  })

  it("端口卡在手机上给出左右滑动查看的提示", () => {
    renderPage()

    expect(screen.getByText("手机上可左右滑动查看完整的监听地址")).toBeTruthy()
  })
})
