// @vitest-environment jsdom

import type {
  DashboardOverview,
  PortInfo,
  ProcessInfo,
} from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useAiAssistantLocalStore } from "@web/features/ai-assistant/store"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { dashboardKeys } from "../queries"
import { DashboardPage } from "./DashboardPage"

/** 复现线上撑高场景：6 行进程 + 67 行监听端口。 */
const PROCESS_COUNT = 6
const PORT_COUNT = 67

const overview: DashboardOverview = {
  sampledAt: 1_700_000_000_000,
  refreshIntervalSeconds: 3,
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

const renderPage = (overviewOverride: Partial<DashboardOverview> = {}) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { enabled: false, retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(dashboardKeys.overview, {
    ...overview,
    ...overviewOverride,
  })
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
  useAiAssistantLocalStore.setState({
    open: false,
    initialContext: null,
    sessionId: null,
  })
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

  it("自动刷新的秒数取后端返回值，不写死", () => {
    renderPage({ refreshIntervalSeconds: 7 })

    expect(screen.getByText(/每 7 秒自动刷新/)).toBeTruthy()
  })

  it("端口卡在手机上给出左右滑动查看的提示", () => {
    renderPage()

    expect(screen.getByText("手机上可左右滑动查看完整的监听地址")).toBeTruthy()
  })

  it("监听端口卡的滚动收在卡片内部：表头常驻、不留第二条横向滚动条", () => {
    renderPage()

    // 表头在内部滚动时保持可见，不会被行内容盖住
    const header = document.querySelector('[data-slot="table-header"].sticky')
    expect(header).not.toBeNull()
    expect(header?.className).toContain("bg-background")

    // 滚动容器限高纵向滚动，并显式关掉横向溢出，
    // 否则 overflow-y-auto 会把横向也算成 auto，与表内的横向滚动叠成两层
    const scroller = screen
      .getByText("监听地址")
      .closest('[data-slot="card-content"]')
    expect(scroller).not.toBeNull()
    expect(scroller?.className).toContain("overflow-y-auto")
    expect(scroller?.className).toContain("overflow-x-hidden")
    expect(scroller?.className).toContain("max-h-[28rem]")
  })

  it("被截断的命令列悬停后能看到完整命令行，短标签不成为 Tooltip 触发元素", async () => {
    const user = userEvent.setup()
    renderPage()

    const full = processes[0].command
    const cell = screen.getAllByText(full)[0]
    expect(cell.closest('[data-slot="tooltip-trigger"]')).not.toBeNull()

    await user.hover(cell)
    await waitFor(() => expect(screen.getAllByText(full)).toHaveLength(2))

    // 同一行的短标签（PID）不加 Tooltip，避免噪音
    const row = cell.closest("tr") as HTMLElement
    expect(
      within(row)
        .getByText(String(processes[0].pid))
        .closest('[data-slot="tooltip-trigger"]')
    ).toBeNull()

    // 列头与列宽类不变：任务 30 的 w-full 仍在
    expect(
      screen.getByRole("columnheader", { name: "命令" }).className
    ).toContain("w-full")
  })

  it("磁盘卡里被截断的卷名也能悬停看到完整值", async () => {
    const user = userEvent.setup()
    renderPage()

    const volume = overview.disk[0]
    const name = screen.getByText(volume.name)
    expect(name.closest('[data-slot="tooltip-trigger"]')).not.toBeNull()

    await user.hover(name)
    await waitFor(() =>
      expect(screen.getAllByText(volume.name).length).toBeGreaterThan(1)
    )
  })

  it("AI 按钮带上页面上已显示的真实摘要，且只是预填不发请求", () => {
    renderPage()

    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }))

    const state = useAiAssistantLocalStore.getState()
    expect(state.open).toBe(true)
    const context = state.initialContext ?? ""
    expect(context).toContain("【AI 助手上下文 · 总览】freewind-mbp")
    expect(context).toContain("Apple M3 Max")
    expect(context).toContain(
      "CPU 负载（1/5/15 分钟）：2.50 / 2.10 / 1.90 · 8 核"
    )
    expect(context).toContain("监听端口（共 67 条，仅列前 10 条）：")
    expect(context).toContain("占用最高的进程（按 CPU）（6 条）：")
    expect(context).toContain("busy-process-1")
    expect(context).toContain("优先调用本应用 API 核实最新状态")
    // 只是打开并预填：没有会话，也没有发出任何请求。
    expect(state.sessionId).toBeNull()
  })
})
