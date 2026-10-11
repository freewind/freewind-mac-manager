// @vitest-environment jsdom

import type {
  ClashVergeConnectionsResponse,
  ClashVergeProxiesResponse,
  ClashVergeStatus,
} from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClashVergePage } from "./ClashVergePage"

const { fetchers } = vi.hoisted(() => ({
  fetchers: {
    status: vi.fn(),
    proxies: vi.fn(),
    connections: vi.fn(),
  },
}))

vi.mock("@shared/client-api", () => ({
  fetchClashVergeStatus: fetchers.status,
  fetchClashVergeProxies: fetchers.proxies,
  fetchClashVergeConnections: fetchers.connections,
}))

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
      members: ["Node A"],
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

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ClashVergePage />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  fetchers.status.mockReset()
  fetchers.proxies.mockReset()
  fetchers.connections.mockReset()
})

describe("ClashVergePage", () => {
  it("shows core status, selected nodes and connections as read-only content", async () => {
    fetchers.status.mockResolvedValue(status)
    fetchers.proxies.mockResolvedValue(proxies)
    fetchers.connections.mockResolvedValue(connections)
    renderPage()
    expect(await screen.findByText("1.2.3")).toBeTruthy()
    expect(screen.getByText("Node A · 当前")).toBeTruthy()
    expect(screen.getByText("example.com")).toBeTruthy()
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /切换|选择|测速|关闭连接/ })
    ).toBeNull()
  })

  it("distinguishes unavailable interface from empty online data", async () => {
    fetchers.status.mockResolvedValue({
      ...status,
      availability: { state: "not_configured", message: "not configured" },
      sections: {
        core: { state: "not_configured", message: "not configured" },
        config: { state: "not_configured", message: "not configured" },
        traffic: { state: "not_configured", message: "not configured" },
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
    renderPage()
    expect(await screen.findByText("尚未配置本机只读控制接口")).toBeTruthy()
    expect(screen.getByText("当前没有活动连接")).toBeTruthy()
  })
})
