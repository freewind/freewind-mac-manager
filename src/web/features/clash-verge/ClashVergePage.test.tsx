// @vitest-environment jsdom

import type {
  ClashVergeConnectionsResponse,
  ClashVergeProxiesResponse,
  ClashVergeStatus,
} from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClashVergePage } from "./ClashVergePage"

const { fetchers } = vi.hoisted(() => ({
  fetchers: {
    status: vi.fn(),
    proxies: vi.fn(),
    connections: vi.fn(),
    mergeFile: vi.fn(),
    saveMergeFile: vi.fn(),
  },
}))

vi.mock("@shared/client-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/client-api")>()
  return {
    ...actual,
    fetchClashVergeStatus: fetchers.status,
    fetchClashVergeProxies: fetchers.proxies,
    fetchClashVergeConnections: fetchers.connections,
    fetchClashVergeMergeFile: fetchers.mergeFile,
    saveClashVergeMergeFile: fetchers.saveMergeFile,
  }
})

const availability = { state: "available", message: null } as const
const status: ClashVergeStatus = {
  sampledAt: 1000,
  availability,
  core: { version: "1.2.3", meta: true },
  config: { mode: "rule", tunEnabled: false },
  traffic: {
    uploadRate: 100,
    downloadRate: 200,
    uploadTotal: 1000,
    downloadTotal: 2000,
  },
  sections: { core: availability, config: availability, traffic: availability },
}
const proxies: ClashVergeProxiesResponse = {
  sampledAt: 1000,
  availability,
  proxies: [
    {
      name: "Proxy",
      type: "Selector",
      alive: true,
      selected: "Node A",
      members: ["Node A", "Node B"],
      delays: [],
    },
  ],
}
const connections: ClashVergeConnectionsResponse = {
  sampledAt: 1000,
  availability,
  total: 1,
  truncated: false,
  connections: [
    {
      id: "connection-1",
      source: "127.0.0.1",
      destination: "example.com",
      network: "tcp",
      process: "Browser",
      upload: 10,
      download: 20,
      startedAt: "2026-01-01T00:00:00Z",
      chains: ["Node A"],
      rule: "DOMAIN",
      rulePayload: "example.com",
    },
  ],
}
const mergeFile = {
  path: "/tmp/profiles/Merge.yaml",
  content: "prepend-rules:\n  - MATCH,DIRECT\n",
  size: 40,
  modified: 1_700_000_000,
}

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ClashVergePage />
    </QueryClientProvider>
  )
}

/** 三个数据块与 Merge 文件都给成功响应，页面进入稳定态。 */
const mockAllOk = () => {
  fetchers.status.mockResolvedValue(status)
  fetchers.proxies.mockResolvedValue(proxies)
  fetchers.connections.mockResolvedValue(connections)
  fetchers.mergeFile.mockResolvedValue(mergeFile)
}

/** 主体按标签分区：先等标签出现，再切到目标分区断言内容。 */
const openTab = async (label: string): Promise<void> => {
  await userEvent.click(await screen.findByRole("button", { name: label }))
}

afterEach(() => {
  cleanup()
  window.history.replaceState({}, "", "/")
  for (const fn of Object.values(fetchers)) fn.mockReset()
})

describe("ClashVergePage", () => {
  it("状态、代理组、活动连接三个分区标签齐全", async () => {
    mockAllOk()
    renderPage()
    expect(await screen.findByRole("button", { name: "状态" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "代理组" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "活动连接" })).toBeTruthy()
    // 默认分区：状态卡与核心版本直接可见
    expect(await screen.findByText("1.2.3")).toBeTruthy()
  })

  it("只读监控定位不变：没有任何切换、测速或关闭连接入口", async () => {
    mockAllOk()
    renderPage()
    await screen.findByText("1.2.3")
    expect(
      screen.queryByRole("button", { name: /切换|测速|关闭连接/ })
    ).toBeNull()
  })

  it("代理组默认摘要展示当前节点与数量，完整成员按需展开", async () => {
    mockAllOk()
    renderPage()
    await openTab("代理组")
    // 摘要：类型 + 当前节点 + 数量，都在 DOM 里直接可读
    expect(await screen.findByText(/Selector/)).toBeTruthy()
    expect(screen.getByText(/当前节点：Node A/)).toBeTruthy()
    expect(screen.getByText(/共 2 个节点/)).toBeTruthy()
    // 成员默认收起：未展开时另一节点不在 DOM
    expect(screen.queryByText("Node B")).toBeNull()

    await userEvent.click(screen.getByRole("button", { name: "展开全部节点" }))
    expect(await screen.findByText("Node B")).toBeTruthy()
    expect(screen.getByText("Node A · 当前")).toBeTruthy()
  })

  it("活动连接默认简短列表，完整信息按需展开", async () => {
    mockAllOk()
    renderPage()
    await openTab("活动连接")
    expect(await screen.findByText("example.com")).toBeTruthy()
    expect(screen.getByText("DOMAIN")).toBeTruthy()
    // 详情字段默认收起
    expect(screen.queryByText(/代理链/)).toBeNull()
    expect(screen.queryByText(/开始时间/)).toBeNull()

    await userEvent.click(screen.getByRole("button", { name: /example\.com/ }))
    expect(await screen.findByText(/代理链/)).toBeTruthy()
    expect(screen.getByText(/开始时间/)).toBeTruthy()
    expect(screen.getByText(/来源：127\.0\.0\.1/)).toBeTruthy()
  })

  it("过期与不可用提示常驻顶部，并如实展示 404/429 的不同文案", async () => {
    fetchers.status.mockResolvedValue({
      ...status,
      availability: {
        state: "unavailable",
        // 任务 26 后端 not_found（404）携带的具体文案
        message: "Clash Verge 控制接口没有这个路径（内核版本可能不支持）",
      },
      sections: {
        core: {
          state: "unavailable",
          message: "Clash Verge 控制接口没有这个路径（内核版本可能不支持）",
        },
        config: availability,
        traffic: availability,
      },
    })
    fetchers.proxies.mockResolvedValue({
      ...proxies,
      availability: {
        state: "unavailable",
        // 任务 26 后端 rate_limited（429）携带的具体文案
        message: "Clash Verge 控制接口请求过于频繁，请稍后重试",
      },
    })
    fetchers.connections.mockResolvedValue(connections)
    fetchers.mergeFile.mockResolvedValue(mergeFile)
    renderPage()
    const notice = await screen.findByRole("status")
    expect(notice.textContent).toContain(
      "Clash Verge 控制接口没有这个路径（内核版本可能不支持）"
    )
    expect(notice.textContent).toContain(
      "Clash Verge 控制接口请求过于频繁，请稍后重试"
    )
    // 提示在顶部，切到其他分区仍然常驻
    await openTab("活动连接")
    expect(screen.getByRole("status").textContent).toContain("请求过于频繁")
  })

  it("未配置时按状态兜底文案提示，与空数据区分开", async () => {
    fetchers.status.mockResolvedValue({
      ...status,
      availability: { state: "not_configured", message: null },
      sections: {
        core: { state: "not_configured", message: null },
        config: { state: "not_configured", message: null },
        traffic: { state: "not_configured", message: null },
      },
    })
    fetchers.proxies.mockResolvedValue({
      ...proxies,
      availability: { state: "not_configured", message: null },
      proxies: [],
    })
    fetchers.connections.mockResolvedValue({
      ...connections,
      availability: { state: "not_configured", message: null },
      total: 0,
      connections: [],
    })
    fetchers.mergeFile.mockResolvedValue(mergeFile)
    renderPage()
    expect(await screen.findByText(/尚未配置本机只读控制接口/)).toBeTruthy()
    await openTab("活动连接")
    expect(await screen.findByText("当前没有活动连接")).toBeTruthy()
  })

  it("Merge 面板在默认分区可达，危险提示可见", async () => {
    mockAllOk()
    renderPage()
    expect(await screen.findByText("保存前必读")).toBeTruthy()
    expect(screen.getByText(/需在 Clash Verge 内重载配置才生效/)).toBeTruthy()
    expect(screen.getByText(/不修改订阅专属 merge/)).toBeTruthy()
    expect(await screen.findByText(mergeFile.path)).toBeTruthy()
    // 切走分区后 Merge 面板随分区卸载，不与其他监控区混排
    await openTab("代理组")
    expect(screen.queryByText("保存前必读")).toBeNull()
  })

  it("分区选择写进 clashTab 参数，默认分区不写", async () => {
    mockAllOk()
    renderPage()
    await screen.findByText("1.2.3")
    expect(
      new URL(window.location.href).searchParams.get("clashTab")
    ).toBeNull()

    await openTab("代理组")
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get("clashTab")).toBe(
        "proxies"
      )
    )
  })

  it("URL 带 clashTab 时直接进入该分区（刷新可恢复），未知值回落状态", async () => {
    window.history.replaceState(
      {},
      "",
      "/?feature=clash-verge&clashTab=connections"
    )
    mockAllOk()
    renderPage()
    expect(await screen.findByText("example.com")).toBeTruthy()
    await cleanup()

    window.history.replaceState({}, "", "/?feature=clash-verge&clashTab=nope")
    renderPage()
    expect(await screen.findByText("1.2.3")).toBeTruthy()
  })
})
