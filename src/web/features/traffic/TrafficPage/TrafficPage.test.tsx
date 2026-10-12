// @vitest-environment jsdom

import type { TrafficGroup, TrafficStatus } from "@shared/api-contract"
import { ApiRequestError } from "@shared/client-api"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useAiAssistantLocalStore } from "@web/features/ai-assistant/store"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TrafficPage } from "./TrafficPage"

const { api, toastMock } = vi.hoisted(() => ({
  api: {
    fetchTrafficStatus: vi.fn(),
    fetchTrafficSnapshots: vi.fn(),
    fetchTrafficGroups: vi.fn(),
  },
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/client-api")>()),
  fetchTrafficStatus: api.fetchTrafficStatus,
  fetchTrafficSnapshots: api.fetchTrafficSnapshots,
  fetchTrafficGroups: api.fetchTrafficGroups,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

const status: TrafficStatus = {
  running: true,
  intervalSeconds: 1,
  sampledAt: 1_791_700_000,
  downloadRate: 1_048_576,
  uploadRate: 1_024,
}

const group = (overrides: Partial<TrafficGroup> = {}): TrafficGroup => ({
  name: "vite-dev",
  bytesIn: 2_048,
  bytesOut: 4_096,
  children: [
    {
      label: "vite",
      scriptName: "vite",
      parent: "pnpm",
      pids: [4821],
      ports: [51509],
      running: true,
      bytesIn: 2_048,
      bytesOut: 4_096,
      command: "node node_modules/.bin/vite",
    },
  ],
  ...overrides,
})

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  render(<TrafficPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

beforeEach(() => {
  // 默认走「实时」视图（store 默认选中 realtime）
  api.fetchTrafficStatus.mockResolvedValue(status)
  api.fetchTrafficSnapshots.mockResolvedValue({ snapshots: [] })
  api.fetchTrafficGroups.mockResolvedValue({
    scope: "实时（最近 1 秒）",
    groups: [group(), group({ name: "webkit", bytesIn: 1_024, bytesOut: 0 })],
  })
})

afterEach(() => {
  cleanup()
  useAiAssistantLocalStore.setState({
    open: false,
    initialContext: null,
    sessionId: null,
  })
  vi.unstubAllGlobals()
  for (const fn of Object.values(api)) fn.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe("流量页", () => {
  it("进程级明细读取失败时不把缺失显示成确定的 0，系统速率照常显示", async () => {
    api.fetchTrafficGroups.mockRejectedValue(
      new ApiRequestError("请求失败（HTTP 500）：操作未能完成", 500)
    )
    renderPage()

    // 系统级速率正常展示
    expect(await screen.findByText("1.0 MB/s")).toBeTruthy()

    // 累计卡与页脚都不再给出确定数值
    expect(await screen.findByText("读取失败")).toBeTruthy()
    expect(screen.getByText("进程级数据不可用，不代表流量为 0")).toBeTruthy()
    expect(
      screen.getByText(/进程明细读取失败，累计与进程数不可用/)
    ).toBeTruthy()
    // 明细区不是「没有流量记录」的空态，而是失败态
    expect(screen.getByText("进程明细读取失败")).toBeTruthy()
    expect(screen.queryByText("这个区间没有流量记录")).toBeNull()
    expect(screen.queryByText(/共 0 个进程/)).toBeNull()
  })

  it("正常数据下累计与进程数如实显示，采样间隔文案跟随状态", async () => {
    renderPage()

    // 采样间隔来自状态，不再硬编码 5 秒（下载、上传两张卡片各一处）
    const intervalLabels = await screen.findAllByText("每 1 秒采样一次")
    expect(intervalLabels.length).toBe(2)

    // 两个分组合计 7168 B（vite-dev 2048入/4096出 + webkit 1024入）
    expect(await screen.findByText("7.0 KB")).toBeTruthy()
    expect(screen.getByText(/共 2 个进程/)).toBeTruthy()
    expect(screen.getByText("vite-dev")).toBeTruthy()
    expect(screen.getByText("webkit")).toBeTruthy()
  })

  it("AI 按钮带上本页真实流量摘要与进程分组", async () => {
    renderPage()
    // 等进程分组的真实数据上来再取上下文。
    await screen.findByText("webkit")

    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }))

    const context = useAiAssistantLocalStore.getState().initialContext ?? ""
    expect(context).toContain("【AI 助手上下文 · 流量监控】实时视图")
    expect(context).toContain("实时速率：下载")
    expect(context).toContain("累计：7.0 KB（入 3.0 KB / 出 4.0 KB）· 2 个进程")
    expect(context).toContain("按流量的进程分组（2 条）：")
    expect(context).toContain("webkit：入 1.0 KB / 出 0")
    expect(context).toContain("优先调用本应用 API 核实最新状态")
  })
})
