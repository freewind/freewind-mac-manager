// @vitest-environment jsdom

import type { ScanSnapshot, TaskRecord, TreeNode } from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@web/components/ui/tooltip"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDiskGrowthLocalStore } from "../store"
import { DiskGrowthPage } from "./DiskGrowthPage"

const { api, toastMock } = vi.hoisted(() => ({
  api: {
    fetchScans: vi.fn(),
    fetchEntries: vi.fn(),
    fetchTree: vi.fn(),
    fetchTask: vi.fn(),
    triggerScan: vi.fn(),
  },
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/client-api")>()),
  fetchScans: api.fetchScans,
  fetchEntries: api.fetchEntries,
  fetchTree: api.fetchTree,
  fetchTask: api.fetchTask,
  triggerScan: api.triggerScan,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

let desktop = true

/** 与 useIsDesktop 一致的匹配媒体查询替身：改 desktop 就切换断点。 */
const setDesktop = (value: boolean) => {
  desktop = value
}

const snapshot = (id: number): ScanSnapshot => ({
  id,
  startedAt: 1_700_000_000 + id * 86400,
  finishedAt: 1_700_000_600 + id * 86400,
  totalSize: 100_000_000,
  dirCount: 10,
  fileCount: 100,
  errorCount: 0,
  foldedCount: 0,
})

const node = (
  path: string,
  name: string,
  size: number,
  children: TreeNode[] = []
): TreeNode => ({
  path,
  name,
  kind: "dir",
  size,
  delta: 0,
  folded: false,
  children,
})

const tree: TreeNode = node("/", "/", 100_000_000, [
  node("/Library", "Library", 50_000_000),
  node("/Users", "Users", 30_000_000),
  node("/Applications", "Applications", 20_000_000),
])

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  render(<DiskGrowthPage />, {
    // 与 main.tsx 一致挂上 Provider：否则 Tooltip 走默认延时，悬停断言会变成计时竞态。
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    ),
  })
}

const blockRole = (path: string) =>
  screen.findByRole("button", { name: new RegExp(`^${path}，`) })

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
  api.fetchScans.mockResolvedValue({ snapshots: [snapshot(2), snapshot(1)] })
  api.fetchTree.mockResolvedValue({ root: tree })
  // 切到分布图视图
  useDiskGrowthLocalStore.getState().setView("icicle")
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  for (const fn of Object.values(api)) fn.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  useDiskGrowthLocalStore.setState({
    view: "growth",
    keyword: "",
    focusPath: "",
    focusStack: [],
    selection: [],
    expanded: [""],
    multiSelect: false,
    checked: [],
    anchorIndex: null,
  })
})

describe("磁盘增长标题区", () => {
  it("首屏加载时在标题旁给出加载状态，视图切换与搜索仍在原位", () => {
    // 快照列表未返回：首屏加载中
    api.fetchScans.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(
      screen.getByRole("heading", { level: 1, name: "磁盘增长" })
    ).toBeTruthy()
    expect(screen.getByRole("status", { name: "磁盘增长 加载中" })).toBeTruthy()
    // 同行的视图切换、搜索框与更多操作菜单都还在
    expect(screen.getByRole("button", { name: "看增长" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "看大小" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "分布图" })).toBeTruthy()
    expect(screen.getByPlaceholderText("搜索全库路径")).toBeTruthy()
    expect(screen.getByRole("button", { name: "更多操作" })).toBeTruthy()
  })
})

describe("明细表长文本", () => {
  it("名称与路径格悬停能看到全文，格子仍然只负责省略", async () => {
    const user = userEvent.setup()
    // 明细表在 growth 视图里，beforeEach 默认切到了分布图
    useDiskGrowthLocalStore.getState().setView("growth")
    api.fetchEntries.mockResolvedValue({
      entries: [
        {
          path: "/Library",
          name: "Library",
          kind: "dir",
          size: 50_000_000,
          delta: 0,
          folded: false,
        },
      ],
    })
    renderPage()

    // 先等到目录树查询落地，表格行才会出现
    const name = await screen.findByText("Library")
    const table = screen.getByRole("table")
    const path = within(table).getByText("/Library")
    expect(name.closest('[data-slot="tooltip-trigger"]')).not.toBeNull()
    expect(path.closest('[data-slot="tooltip-trigger"]')).not.toBeNull()
    // 列宽规范不变：格子继续 truncate，全文交给浮层
    expect(path.closest("td")?.className).toContain("truncate")

    const nameHits = screen.getAllByText("Library").length
    await user.hover(name)
    await waitFor(() =>
      expect(screen.getAllByText("Library").length).toBeGreaterThan(nameHits)
    )

    const pathHits = screen.getAllByText("/Library").length
    await user.hover(path)
    await waitFor(() =>
      expect(screen.getAllByText("/Library").length).toBeGreaterThan(pathHits)
    )
  })
})

describe("分布图搜索", () => {
  it("有匹配关键字时全部块仍渲染，顶部给出匹配数量", async () => {
    useDiskGrowthLocalStore.getState().setKeyword("library")
    renderPage()

    expect(await screen.findByText("匹配 1 个路径")).toBeTruthy()
    // 所有块仍在（不过滤、不破坏层级）
    expect(await blockRole("/Library")).toBeTruthy()
    expect(await blockRole("/Users")).toBeTruthy()
    expect(await blockRole("/Applications")).toBeTruthy()
  })

  it("关键字无匹配时给出「没有匹配的路径」", async () => {
    useDiskGrowthLocalStore.getState().setKeyword("zzz")
    renderPage()

    expect(await screen.findByText("没有匹配的路径")).toBeTruthy()
    // 无匹配时块也不被过滤
    expect(await blockRole("/Library")).toBeTruthy()
  })

  it("清空关键字后不出现匹配计数", async () => {
    renderPage()

    expect(await blockRole("/Library")).toBeTruthy()
    expect(screen.queryByText(/匹配 \d+ 个路径/)).toBeNull()
    expect(screen.queryByText("没有匹配的路径")).toBeNull()
  })
})

const scanTask: TaskRecord = {
  id: "task-1",
  requestId: "req-1",
  target: "scan:/",
  kind: "disk_scan",
  status: "running",
  progress: {
    done: 0,
    total: null,
    bytesDone: 1_073_741_824,
    bytesTotal: null,
    stage: "统计文件",
    currentTarget: null,
  },
  message: null,
  error: null,
  startedAt: 1_700_000_000,
  finishedAt: null,
  updatedAt: 1_700_000_001,
  result: null,
}

describe("工作区布局", () => {
  it("桌面把快照侧栏与结果区分开：侧栏在左，结果区自带局部滚动", async () => {
    renderPage()

    const panel = (await screen.findByText("快照")).closest("aside")
    expect(panel).toBeTruthy()
    // 结果区（分布图）与侧栏并列，且保留自己的局部滚动区域，不强行拉伸
    expect(panel?.parentElement?.querySelector(".overflow-auto")).toBeTruthy()
    // 手机上才用的抽屉入口不在：不做两套同时挂载
    expect(screen.queryByRole("button", { name: "快照" })).toBeNull()
  })

  it("手机上不渲染侧栏，快照与区间选择在抽屉里", async () => {
    const user = userEvent.setup()
    setDesktop(false)
    renderPage()
    await screen.findByText("快照")

    expect(document.querySelector("aside")).toBeNull()
    expect(screen.getByRole("button", { name: "更多操作" })).toBeTruthy()
    expect(screen.queryByText("快照与区间")).toBeNull()

    await user.click(screen.getByRole("button", { name: "快照" }))

    expect(await screen.findByText("快照与区间")).toBeTruthy()
    // 抽屉里保留快照选择：仍能看到快照行
    expect(
      screen.getByText(formatTimestamp(snapshot(2).startedAt))
    ).toBeTruthy()
  })

  it("次要操作进菜单：全部收起不在外面，菜单里能收起", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("快照")

    useDiskGrowthLocalStore.getState().toggleExpanded("/Library")
    expect(screen.queryByRole("button", { name: "全部收起" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "更多操作" }))
    await user.click(await screen.findByRole("menuitem", { name: "全部收起" }))

    expect(useDiskGrowthLocalStore.getState().expanded).toEqual([""])
  })

  it("扫描进度只报一句话，完整任务卡片留在任务中心", async () => {
    const user = userEvent.setup()
    api.triggerScan.mockResolvedValue({
      kind: "accepted",
      body: {
        taskId: "task-1",
        kind: "disk_scan",
        status: "running",
        startedAt: 1_700_000_000,
      },
    })
    api.fetchTask.mockResolvedValue(scanTask)
    renderPage()
    await screen.findByText("快照")

    await user.click(screen.getByRole("button", { name: /立即扫描/ }))

    expect(await screen.findByText(/统计文件：已统计/)).toBeTruthy()
    expect(screen.getByText("详细进度与结果见任务中心")).toBeTruthy()
    // 完整任务卡片不在本页
    expect(document.querySelector('[data-slot="task-card"]')).toBeNull()
  })
})
