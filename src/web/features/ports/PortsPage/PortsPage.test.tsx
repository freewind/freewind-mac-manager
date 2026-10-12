// @vitest-environment jsdom
import type { PortBinding } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { usePortsLocalStore } from "@web/features/ports/store"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PortsPage } from "./PortsPage"

const { fetchPortBindings, killPortProcesses, toastMock } = vi.hoisted(() => ({
  fetchPortBindings: vi.fn(),
  killPortProcesses: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// 只替身端口列表的远程读取；页面其余能力保持真实。
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchPortBindings,
  killPortProcesses,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

let desktop = true

/** 与 useIsDesktop 一致的匹配媒体查询替身：改 desktop 就切换断点。 */
const setDesktop = (value: boolean) => {
  desktop = value
}

const binding = (port: number, state: PortBinding["state"]): PortBinding => ({
  key: `tcp4-${port}-0`,
  port,
  protocol: "TCP",
  family: "IPv4",
  address: state === "LISTEN" ? "127.0.0.1" : "127.0.0.1:54321",
  peer: null,
  state,
  pid: 100 + port,
  processName: "node",
  user: "peng",
  startedBy: "launchd",
  command: "/usr/local/bin/node server.js",
  cwd: "/Users/peng/workspace/demo",
  startedAt: 1_700_000_000,
})

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PortsPage />
    </QueryClientProvider>
  )
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
  usePortsLocalStore.setState({
    view: "all",
    search: "",
    protocol: "all",
    scope: "all",
    exposure: "all",
    expandedPorts: [],
    selectedPort: null,
    autoRefresh: false,
  })
  fetchPortBindings.mockReset().mockResolvedValue({
    bindings: [binding(8080, "LISTEN"), binding(443, "ESTABLISHED")],
  })
  killPortProcesses.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("端口页的紧凑工作区", () => {
  it("桌面保留左侧快捷视图，顶部只留紧凑统计摘要与一行状态", async () => {
    renderPage()
    await screen.findByRole("button", { name: "8080" })

    // 桌面用左侧面板，不再渲染选择控件
    expect(screen.getByText("快捷视图")).toBeTruthy()
    expect(screen.queryByRole("combobox")).toBeNull()

    // 统计只报数字，旧卡片里的说明文字不再常驻顶部
    expect(screen.getByText("监听端口").parentElement?.textContent).toContain(
      "1"
    )
    expect(screen.queryByText(/个套接字绑定/)).toBeNull()
    expect(screen.queryByText(/局域网可访问/)).toBeNull()

    // 状态行合并当前视图、结果数量与更新时间
    expect(screen.getByText(/全部端口 · 2 个端口 \/ 2 个套接字/)).toBeTruthy()
    expect(screen.getByText(/上次更新/)).toBeTruthy()
  })

  it("手机把快捷视图换成选择控件，详细筛选按需展开", async () => {
    const user = userEvent.setup()
    setDesktop(false)
    renderPage()
    await screen.findByRole("button", { name: "8080" })

    // 不再渲染整块左侧面板
    expect(screen.queryByText("快捷视图")).toBeNull()
    expect(screen.getByRole("combobox", { name: "快捷视图" })).toBeTruthy()

    // 详细筛选默认收起，展开后才出现三组筛选
    expect(screen.queryByText("全部协议")).toBeNull()
    expect(screen.getByText("未设置筛选条件")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: /详细筛选/ }))

    expect(await screen.findByText("全部协议")).toBeTruthy()
    expect(screen.getByText("全部状态")).toBeTruthy()
    expect(screen.getByText("全部范围")).toBeTruthy()
  })

  it("手机搜索与结果数量仍可见，且统计摘要不占卡片高度", async () => {
    setDesktop(false)
    renderPage()
    await screen.findByRole("button", { name: "8080" })

    expect(
      screen.getByPlaceholderText("搜索端口 / 进程 / 命令 / 项目")
    ).toBeTruthy()
    expect(screen.getByText(/全部端口 · 2 个端口 \/ 2 个套接字/)).toBeTruthy()
    expect(screen.getByText("涉及进程").parentElement?.textContent).toContain(
      "2"
    )
  })
})
