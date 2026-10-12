// @vitest-environment jsdom

import type { DockerOverview } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { useAiAssistantLocalStore } from "@web/features/ai-assistant/store"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DockerPage } from "./DockerPage"

const {
  fetchDockerOverview,
  fetchDockerContainers,
  fetchDockerImages,
  fetchDockerVolumes,
  fetchDockerNetworks,
  fetchDockerColimaStatus,
} = vi.hoisted(() => ({
  fetchDockerOverview: vi.fn(),
  fetchDockerContainers: vi.fn(),
  fetchDockerImages: vi.fn(),
  fetchDockerVolumes: vi.fn(),
  fetchDockerNetworks: vi.fn(),
  fetchDockerColimaStatus: vi.fn(),
}))

// 概览页现在也渲染容器列表：只替身读接口，其余（错误类型、请求标识等）保持真实
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchDockerOverview,
  fetchDockerContainers,
  fetchDockerImages,
  fetchDockerVolumes,
  fetchDockerNetworks,
  fetchDockerColimaStatus,
  fetchDockerContainerLogs: vi.fn(),
  actOnDockerContainer: vi.fn(),
  removeDockerContainer: vi.fn(),
  pullDockerImage: vi.fn(),
  removeDockerImage: vi.fn(),
  removeDockerVolume: vi.fn(),
  removeDockerNetwork: vi.fn(),
}))

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

beforeEach(() => {
  fetchDockerContainers.mockResolvedValue({ containers: [], skipped: [] })
  fetchDockerImages.mockResolvedValue({ images: [] })
  fetchDockerVolumes.mockResolvedValue({ volumes: [] })
  fetchDockerNetworks.mockResolvedValue({ networks: [] })
  fetchDockerColimaStatus.mockResolvedValue(overview.colima)
  window.history.replaceState({}, "", "/")
  // 概览页也会渲染容器列表，jsdom 默认没有 matchMedia
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
})

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
  useAiAssistantLocalStore.setState({
    open: false,
    initialContext: null,
    sessionId: null,
  })
  fetchDockerOverview.mockReset()
  fetchDockerContainers.mockReset()
  fetchDockerImages.mockReset()
  fetchDockerVolumes.mockReset()
  fetchDockerNetworks.mockReset()
  fetchDockerColimaStatus.mockReset()
  vi.unstubAllGlobals()
})

describe("DockerPage 概览", () => {
  it("加载中显示可读状态，不留空白", async () => {
    fetchDockerOverview.mockReturnValue(new Promise<DockerOverview>(() => {}))
    renderPage()
    expect(screen.getByText("正在读取 Docker 概览…")).toBeTruthy()
    expect(screen.getByRole("status", { name: "Docker 加载中" })).toBeTruthy()
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

describe("DockerPage 分区导航", () => {
  it("默认停在容器分区，切换镜像分区会写进 URL", async () => {
    renderPage()
    expect(await screen.findByRole("heading", { name: "容器" })).toBeTruthy()
    expect(new URL(window.location.href).searchParams.get("tab")).toBeNull()

    screen.getByRole("button", { name: "镜像" }).click()
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get("tab")).toBe(
        "images"
      )
    )
    expect(await screen.findByRole("heading", { name: "镜像" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "容器" })).toBeNull()
  })

  it("URL 带 tab 时直接进入该分区（刷新可恢复）", async () => {
    window.history.replaceState({}, "", "/?feature=docker&tab=images")
    renderPage()
    expect(await screen.findByRole("heading", { name: "镜像" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "容器" })).toBeNull()
  })

  it("未知 tab 回落到容器分区", async () => {
    window.history.replaceState({}, "", "/?feature=docker&tab=nope")
    renderPage()
    expect(await screen.findByRole("heading", { name: "容器" })).toBeTruthy()
  })

  it("卷与网络分区渲染各自的列表", async () => {
    window.history.replaceState({}, "", "/?feature=docker&tab=volumes")
    renderPage()
    expect(await screen.findByRole("heading", { name: "卷" })).toBeTruthy()
    expect(await screen.findByText("没有卷")).toBeTruthy()

    window.history.replaceState({}, "", "/?feature=docker&tab=networks")
    cleanup()
    renderPage()
    expect(await screen.findByRole("heading", { name: "网络" })).toBeTruthy()
    expect(await screen.findByText("没有网络")).toBeTruthy()
  })

  it("AI 按钮带上概览计数与缓存里的容器条目", async () => {
    fetchDockerOverview.mockResolvedValue(overview)
    fetchDockerContainers.mockResolvedValue({
      containers: [
        {
          id: "c1".padEnd(64, "0"),
          name: "web",
          image: "nginx:latest",
          command: "nginx -g 'daemon off;'",
          state: "running",
          status: "Up 3 hours",
          createdAt: 1_700_000_000_000,
          startedAt: null,
          ports: [],
          mounts: [],
        },
      ],
      skipped: [],
    })
    renderPage()
    expect(await screen.findByText("共 4 个容器")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }))

    const context = useAiAssistantLocalStore.getState().initialContext ?? ""
    expect(context).toContain("【AI 助手上下文 · Docker】docker 29.5.2")
    expect(context).toContain("容器：共 4 · 运行 3 · 暂停 1 · 停止 0")
    expect(context).toContain("镜像：8 个")
    expect(context).toContain("容器明细：已从缓存读到 1 条")
    expect(context).toContain("#c10000000000 web · running · Up 3 hours")
    expect(context).toContain("优先调用本应用 API 核实最新状态")
    // 上下文读的是容器分区已经拉到的缓存，不为按钮多发一次请求。
    expect(fetchDockerContainers).toHaveBeenCalledTimes(1)
  })
})
