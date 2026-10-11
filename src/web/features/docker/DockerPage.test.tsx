// @vitest-environment jsdom

import type { DockerOverview } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DockerPage } from "./DockerPage"

const { fetchDockerOverview } = vi.hoisted(() => ({
  fetchDockerOverview: vi.fn(),
}))

vi.mock("@shared/client-api", () => ({ fetchDockerOverview }))

const overview: DockerOverview = {
  available: true,
  version: "29.5.2",
  colima: {
    installed: true,
    running: true,
    status: "colima 运行中",
    runtime: "docker",
    arch: "x86_64",
    cpus: null,
    memoryBytes: null,
    diskBytes: null,
    checkedAt: 1_790_000_000_000,
  },
  containers: { total: 4, running: 3, paused: 1, stopped: 0 },
  images: { total: 8, sizeBytes: 4_940_000_000 },
  volumes: { total: 4 },
  networks: { total: 6 },
  checkedAt: 1_790_000_000_000,
}

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DockerPage />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  fetchDockerOverview.mockReset()
})

describe("DockerPage 概览", () => {
  it("加载中显示可读状态，不留空白", async () => {
    fetchDockerOverview.mockReturnValue(new Promise<DockerOverview>(() => {}))
    renderPage()
    expect(screen.getByText("正在读取 Docker 概览…")).toBeTruthy()
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy()
  })

  it("渲染 Colima 状态与容器/镜像/卷/网络的真实计数", async () => {
    fetchDockerOverview.mockResolvedValue(overview)
    renderPage()
    // Colima
    expect(await screen.findByText("运行中")).toBeTruthy()
    expect(screen.getByText("runtime docker · 架构 x86_64")).toBeTruthy()
    // 容器
    expect(screen.getByText("共 4 个容器")).toBeTruthy()
    expect(screen.getByText("运行 3 · 暂停 1 · 停止 0")).toBeTruthy()
    // 镜像与占用
    expect(screen.getByText("共 8 个镜像")).toBeTruthy()
    expect(
      screen.getByText(`占用 ${formatBytes(overview.images.sizeBytes)}`)
    ).toBeTruthy()
    // 卷与网络
    expect(screen.getByText("共 4 个卷")).toBeTruthy()
    expect(screen.getByText("共 6 个网络")).toBeTruthy()
    // 数据时间要标出来，避免把历史快照当当前状态
    expect(screen.getByText(/数据时间/)).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("计数为 0 时给出空态文案而不是空白", async () => {
    fetchDockerOverview.mockResolvedValue({
      ...overview,
      containers: { total: 0, running: 0, paused: 0, stopped: 0 },
      images: { total: 0, sizeBytes: 0 },
      volumes: { total: 0 },
      networks: { total: 0 },
    })
    renderPage()
    expect(await screen.findByText("暂无容器")).toBeTruthy()
    expect(screen.getByText("暂无镜像")).toBeTruthy()
    expect(screen.getByText("暂无卷")).toBeTruthy()
    expect(screen.getByText("暂无网络")).toBeTruthy()
  })

  it("读取失败时在页面内持续展示错误，并且可以重试", async () => {
    fetchDockerOverview.mockRejectedValue(
      new Error("Docker 未运行，请先启动 Colima")
    )
    renderPage()
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("读取 Docker 概览失败")
    expect(alert.textContent).toContain("Docker 未运行，请先启动 Colima")
    // 错误留在页面上，不是一闪而过的提示
    expect(screen.getByRole("alert")).toBe(alert)

    fetchDockerOverview.mockResolvedValue(overview)
    screen.getByRole("button", { name: "刷新" }).click()
    expect(await screen.findByText("共 4 个容器")).toBeTruthy()
  })

  it("Docker 不可用时说明原因，但仍显示全 0 计数", async () => {
    fetchDockerOverview.mockResolvedValue({
      ...overview,
      available: false,
      version: null,
      colima: {
        ...overview.colima,
        installed: false,
        running: false,
        status: "colima 未安装",
        runtime: null,
        arch: null,
      },
      containers: { total: 0, running: 0, paused: 0, stopped: 0 },
      images: { total: 0, sizeBytes: 0 },
      volumes: { total: 0 },
      networks: { total: 0 },
    })
    renderPage()
    expect(await screen.findByText("Docker 当前不可用")).toBeTruthy()
    expect(screen.getByText("未安装")).toBeTruthy()
    expect(screen.getByText("未安装 colima，Docker 能力不可用")).toBeTruthy()
    expect(screen.getByText("暂无容器")).toBeTruthy()
  })
})
