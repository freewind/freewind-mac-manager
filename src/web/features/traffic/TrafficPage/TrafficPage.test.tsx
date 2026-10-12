// @vitest-environment jsdom

import type {
  TrafficGroup,
  TrafficSnapshot,
  TrafficStatus,
} from "@shared/api-contract"
import { ApiRequestError } from "@shared/client-api"
import { formatTimestamp } from "@shared/format"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useAiAssistantLocalStore } from "@web/features/ai-assistant/store"
import {
  REALTIME_SNAPSHOT_ID,
  useTrafficLocalStore,
} from "@web/features/traffic/store"
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

let desktop = true

/** 与 useIsDesktop 一致的匹配媒体查询替身：改 desktop 就切换断点。 */
const setDesktop = (value: boolean) => {
  desktop = value
}

const status: TrafficStatus = {
  running: true,
  intervalSeconds: 1,
  sampledAt: 1_791_700_000,
  downloadRate: 1_048_576,
  uploadRate: 1_024,
}

const SNAPSHOT_SAVED_AT = 1_791_700_000

const snapshot = (id: string, savedAt: number): TrafficSnapshot => ({
  id,
  savedAt,
  fromAt: savedAt - 3600,
  toAt: savedAt,
  rangeText: "12:00–13:00",
  savedBy: "manual",
  bytesIn: 1_024,
  bytesOut: 2_048,
  groups: [],
})

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
  desktop = true
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
  // 默认走「实时」视图（store 默认选中 realtime）
  useTrafficLocalStore.setState({ selectedIds: [REALTIME_SNAPSHOT_ID] })
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

    // 摘要与页脚都不再给出确定数值
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

  it("正常数据下累计与进程数如实显示，采样与明细两个频率都跟随状态", async () => {
    renderPage()

    // 采样与明细是两个频率：口径保持「采样每 N 秒 · 明细每 M 秒」，不回退成单一频率
    expect(
      await screen.findByText(/实时视图（采样每 1 秒 · 明细每 5 秒）/)
    ).toBeTruthy()

    // 两个分组合计 7168 B（vite-dev 2048入/4096出 + webkit 1024入）
    expect(await screen.findByText("7.0 KB")).toBeTruthy()
    expect(screen.getByText(/共 2 个进程/)).toBeTruthy()
    expect(screen.getByText("vite-dev")).toBeTruthy()
    expect(screen.getByText("webkit")).toBeTruthy()
  })

  it("顶部换成一行紧凑摘要，不再固定三张统计卡片", async () => {
    renderPage()
    await screen.findByText("vite-dev")

    // 实时速率与当前累计分开标识
    expect(screen.getByText("实时下载")).toBeTruthy()
    expect(screen.getByText("实时上传")).toBeTruthy()
    expect(screen.getByText("当前累计")).toBeTruthy()
    // 旧卡片里的说明文案不再常驻顶部
    expect(screen.queryByText("每 1 秒采样一次")).toBeNull()
  })

  it("桌面把快照列表与明细并列，两侧各自有滚动容器", async () => {
    renderPage()
    await screen.findByText("vite-dev")

    const panel = screen.getByText("快照（增量）").closest("aside")
    expect(panel).toBeTruthy()
    // 明细表与左侧面板在同一行容器里并列
    expect(panel?.parentElement?.querySelector("table")).toBeTruthy()
    // 两侧各自有滚动视口，滚动互不带动
    expect(
      document.querySelectorAll('[data-slot="scroll-area-viewport"]').length
    ).toBe(2)
    // 手机上才用的抽屉入口不存在：不做两套同时挂载
    expect(screen.queryByRole("button", { name: "快照" })).toBeNull()
  })

  it("手机上默认显示明细，快照收进抽屉且保留选择与删除入口", async () => {
    const user = userEvent.setup()
    setDesktop(false)
    api.fetchTrafficSnapshots.mockResolvedValue({
      snapshots: [snapshot("s1", SNAPSHOT_SAVED_AT)],
    })
    renderPage()
    await screen.findByText("vite-dev")

    // 侧栏不常驻，只有抽屉入口
    expect(screen.queryByText("快照（增量）")).toBeNull()
    await user.click(screen.getByRole("button", { name: "快照" }))

    expect(await screen.findByText("选择快照")).toBeTruthy()
    expect(screen.getByText("快照（增量）")).toBeTruthy()
    expect(
      screen.getByText(formatTimestamp(Math.floor(SNAPSHOT_SAVED_AT / 1000)))
    ).toBeTruthy()

    // 多选与删除能力随抽屉一起保留
    await user.click(screen.getByRole("button", { name: "快照操作" }))
    expect(await screen.findByRole("menuitem", { name: "多选…" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "删除快照" })).toBeTruthy()
  })

  it("切换快照后明细回顶部，左侧列表不被带动", async () => {
    const user = userEvent.setup()
    api.fetchTrafficSnapshots.mockResolvedValue({
      snapshots: [snapshot("s1", SNAPSHOT_SAVED_AT)],
    })
    renderPage()
    await screen.findByText("vite-dev")

    const detailViewport = () =>
      screen.getByRole("table").closest('[data-slot="scroll-area-viewport"]')
    const before = detailViewport()
    expect(before).toBeTruthy()

    await user.click(
      screen.getByText(formatTimestamp(Math.floor(SNAPSHOT_SAVED_AT / 1000)))
    )

    // 查看对象变了：明细的滚动容器被重建，因此从顶部看起
    expect(detailViewport()).not.toBe(before)
    expect(detailViewport()?.scrollTop ?? 0).toBe(0)
    // 左侧快照列表仍在原处，没有被一起重置
    expect(screen.getByText("快照（增量）")).toBeTruthy()
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
