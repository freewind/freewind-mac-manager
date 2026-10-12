// @vitest-environment jsdom
import type { MachineOverview, ProcessEntry } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useAiAssistantLocalStore } from "@web/features/ai-assistant/store"
import { useProcessesLocalStore } from "@web/features/processes/store"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProcessesPage } from "./ProcessesPage"

const { fetchProcessList, killProcesses, toastMock } = vi.hoisted(() => ({
  fetchProcessList: vi.fn(),
  killProcesses: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// 只替身进程列表的远程读取；页面其余能力保持真实。
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchProcessList,
  killProcesses,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

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
  cpu: { loadAverage: [1.5, 1.2, 1.0], coreCount: 8, coreUsage: [10, 20] },
  memory: {
    total: 8_589_934_592,
    used: 4_294_967_296,
    wired: 1_073_741_824,
    compressed: 536_870_912,
    free: 4_294_967_296,
    swapTotal: 1_073_741_824,
    swapUsed: 0,
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
    downloadRate: 1_000,
    uploadRate: 500,
    totalDown: 1,
    totalUp: 2,
  },
}

const process = (overrides: Partial<ProcessEntry>): ProcessEntry => ({
  pid: 100,
  ppid: 1,
  name: "worker",
  command: "/usr/local/bin/worker --secret-token tk_live_should_not_leak",
  path: "/usr/local/bin/worker",
  user: "peng",
  state: "running",
  kind: "app",
  cpu: 1,
  memoryBytes: 10_485_760,
  threads: 2,
  ports: [8080],
  startedAt: 1_700_000_000,
  ...overrides,
})

const processes: ProcessEntry[] = [
  process({ pid: 4242, name: "node", cpu: 31.2, memoryBytes: 536_870_912 }),
  process({ pid: 77, name: "Docker", cpu: 4.5, memoryBytes: 268_435_456 }),
]

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ProcessesPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  fetchProcessList
    .mockReset()
    .mockResolvedValue({ processes, overview, currentUser: "peng" })
})

afterEach(() => {
  cleanup()
  // 详情抽屉会留下选中的进程，不清掉会污染后续用例的文本查询
  useProcessesLocalStore.setState({ selectedPid: null })
  useAiAssistantLocalStore.setState({
    open: false,
    initialContext: null,
    sessionId: null,
  })
})

describe("进程页的标题区", () => {
  it("首屏读取期间在标题旁显示加载指示", async () => {
    fetchProcessList.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByRole("status", { name: "进程管理 加载中" })).toBeTruthy()
  })
})

describe("进程页的紧凑工作区", () => {
  it("顶部只留一行资源摘要，完整资源卡片默认收起、可在列表区展开", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("node")

    // 摘要常驻固定区：只报关键数字
    expect(screen.getByText(/CPU 15\.0%/)).toBeTruthy()
    expect(screen.getByText(/内存 4\.0 GB/)).toBeTruthy()

    // 完整卡片默认收起，不占列表高度
    const trigger = screen.getByRole("button", { name: /资源详情/ })
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText(/负载/)).toBeNull()

    await user.click(trigger)

    expect(await screen.findByText(/负载/)).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: /收起资源详情/ })
        .getAttribute("aria-expanded")
    ).toBe("true")
  })

  it("列表是页面唯一的主体滚动区，底部不再重复系统信息", async () => {
    renderPage()
    await screen.findByText("node")

    const header = screen.getByRole("columnheader", { name: "进程名称" })
    expect(header.closest(".overflow-auto")).toBeTruthy()

    // OS 版本与运行时长移进资源详情，不再堆在底部
    expect(screen.queryByText(/已运行/)).toBeNull()
    expect(screen.queryByText(/个线程/)).toBeNull()
  })

  it("批量操作只在选中进程后出现", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("node")

    expect(screen.queryByText(/^已选/)).toBeNull()

    await user.click(screen.getByRole("checkbox", { name: "选择 node" }))

    expect(await screen.findByText(/已选 1 个进程/)).toBeTruthy()
  })
})

describe("进程详情", () => {
  it("进程详情标题完整可见：长名字换行而不是截断", async () => {
    const user = userEvent.setup()
    const longName =
      "com.apple.WebKit.WebContent.Networking.Helper.very-long-service-name"
    fetchProcessList.mockResolvedValue({
      processes: [process({ pid: 4242, name: longName })],
      overview,
      currentUser: "peng",
    })
    renderPage()

    // 详情是手机上唯一能看到完整进程名的地方，不能靠 hover
    await user.click(await screen.findByText(longName))
    const titles = screen
      .getAllByText(longName)
      .map((node) => node.closest('[data-slot="sheet-title"]'))
      .filter((node) => node !== null)
    expect(titles).toHaveLength(1)
    expect(titles[0]?.className).toContain("break-all")
    expect(titles[0]?.className).not.toContain("truncate")
  })
})

describe("进程页的 AI 入口", () => {
  it("AI 按钮带上有限进程摘要且不含命令行，点击只预填不发送", async () => {
    renderPage()
    await screen.findByText("node")

    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }))

    const state = useAiAssistantLocalStore.getState()
    expect(state.open).toBe(true)
    const context = state.initialContext ?? ""
    expect(context).toContain("【AI 助手上下文 · 进程管理】")
    expect(context).toContain("freewind-mbp · Apple M3 Max")
    expect(context).toContain("进程：共 2 个，当前筛选后显示 2 个")
    expect(context).toContain("占用 CPU 最高的进程（2 条）：")
    // 按 CPU 排序：node 在前。
    expect(context).toContain(
      "PID 4242 node · CPU 31.2% · 内存 512 MB · 用户 peng"
    )
    expect(context).toContain("PID 77 Docker · CPU 4.5%")
    // 只列 PID/名称/资源占用：命令行与路径不进上下文。
    expect(context).not.toContain("--secret-token")
    expect(context).not.toContain("/usr/local/bin/worker")
    expect(context).toContain("优先调用本应用 API 核实最新状态")
    expect(state.sessionId).toBeNull()
  })

  it("进程列表读取失败时如实说明，不把空列表写成 0 个进程", async () => {
    fetchProcessList.mockRejectedValue(new Error("读取失败"))
    renderPage()
    await screen.findByText("读取失败")

    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }))

    const context = useAiAssistantLocalStore.getState().initialContext ?? ""
    expect(context).toContain("数据状态：读取失败（读取失败）")
    expect(context).toContain("页面尚未展示条目")
    expect(context).not.toContain("共 0 个")
  })
})
