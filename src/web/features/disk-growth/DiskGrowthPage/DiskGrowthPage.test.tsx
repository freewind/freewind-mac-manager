// @vitest-environment jsdom

import type { ScanSnapshot, TreeNode } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDiskGrowthLocalStore } from "../store"
import { DiskGrowthPage } from "./DiskGrowthPage"

const { api, toastMock } = vi.hoisted(() => ({
  api: {
    fetchScans: vi.fn(),
    fetchTree: vi.fn(),
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
  fetchTree: api.fetchTree,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

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
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

const blockRole = (path: string) =>
  screen.findByRole("button", { name: new RegExp(`^${path}，`) })

beforeEach(() => {
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
