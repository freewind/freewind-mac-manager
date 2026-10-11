// @vitest-environment jsdom

import type { DockerContainer } from "@shared/api-contract"
import { ApiRequestError } from "@shared/client-api"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { clearPendingRequests } from "@web/features/tasks/pending-requests"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContainerList } from "./ContainerList"

const { api, toastMock } = vi.hoisted(() => ({
  api: {
    fetchDockerContainers: vi.fn(),
    fetchDockerContainerLogs: vi.fn(),
    fetchDockerImages: vi.fn(),
    createDockerContainer: vi.fn(),
    actOnDockerContainer: vi.fn(),
    removeDockerContainer: vi.fn(),
  },
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

// 只替身 Docker 相关调用；错误类型与请求标识工具保持真实，行为与生产一致
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchDockerContainers: api.fetchDockerContainers,
  fetchDockerContainerLogs: api.fetchDockerContainerLogs,
  fetchDockerImages: api.fetchDockerImages,
  createDockerContainer: api.createDockerContainer,
  actOnDockerContainer: api.actOnDockerContainer,
  removeDockerContainer: api.removeDockerContainer,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

/** 手机与桌面走同一个组件，用 matchMedia 切换布局分支。 */
const setDesktop = (desktop: boolean): void => {
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
}

const container = (
  overrides: Partial<DockerContainer> = {}
): DockerContainer => ({
  id: "c1".padEnd(64, "0"),
  name: "web",
  image: "nginx:latest",
  command: "nginx -g 'daemon off;'",
  state: "running",
  status: "Up 3 hours",
  createdAt: 1_700_000_000_000,
  startedAt: 1_700_000_000_500,
  ports: [
    { hostIp: "127.0.0.1", hostPort: 8080, containerPort: 80, protocol: "tcp" },
  ],
  mounts: [],
  ...overrides,
})

const containersResponse = (containers: DockerContainer[]) => ({
  containers,
  skipped: [],
})

const renderList = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ContainerList />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  setDesktop(false)
  api.fetchDockerContainers.mockResolvedValue(containersResponse([container()]))
  api.fetchDockerImages.mockResolvedValue({ images: [] })
  api.fetchDockerContainerLogs.mockResolvedValue({
    containerId: container().id,
    lines: ["ready", "listening on 80"],
    truncated: false,
    fetchedAt: 1_700_000_100_000,
  })
  api.actOnDockerContainer.mockResolvedValue({
    kind: "completed",
    status: 200,
    body: { message: "已启动 web" },
  })
  api.removeDockerContainer.mockResolvedValue({
    kind: "completed",
    status: 200,
    body: { message: "已删除 web" },
  })
})

afterEach(() => {
  cleanup()
  // 上一条用例可能停在「执行中」的弹窗上：清掉待核实请求与 body 锁样式，
  // 否则下一条用例会被判成 busy（按钮禁用）而点不动
  clearPendingRequests()
  document.body.style.overflow = ""
  document.body.style.pointerEvents = ""
  window.history.replaceState({}, "", "/")
  for (const fn of Object.values(api)) fn.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  vi.unstubAllGlobals()
})

describe("容器列表", () => {
  it("手机宽度用卡片展示名称、状态、端口与启动时间", async () => {
    renderList()
    expect(await screen.findByText("web")).toBeTruthy()
    expect(screen.getByText("运行中")).toBeTruthy()
    expect(screen.getByText(/端口 127.0.0.1:8080→80\/tcp/)).toBeTruthy()
    expect(screen.getByText(/启动于/)).toBeTruthy()
    // 手机不渲染表格
    expect(screen.queryByRole("table")).toBeNull()
    // 图标按钮有可访问名称
    expect(
      screen.getByRole("button", { name: "查看容器 web 的日志" })
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "删除容器 web" })).toBeTruthy()
  })

  it("桌面用表格展示更多列", async () => {
    setDesktop(true)
    renderList()
    expect(await screen.findByRole("table")).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "镜像" })).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "启动时间" })).toBeTruthy()
    expect(screen.getByRole("cell", { name: "nginx:latest" })).toBeTruthy()
  })

  it("删除先确认：对话框写明容器名，取消不发请求", async () => {
    renderList()
    const removeButton = await screen.findByRole("button", {
      name: "删除容器 web",
    })
    removeButton.click()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("删除容器 web？")
    // 运行中容器给出两条路径，且不是含糊的「确定」
    expect(dialog.textContent).toContain("正在运行")
    expect(api.removeDockerContainer).not.toHaveBeenCalled()

    screen.getByRole("button", { name: "取消" }).click()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(api.removeDockerContainer).not.toHaveBeenCalled()
  })

  it("确认强制删除才发请求，并且带 force", async () => {
    renderList()
    const removeButton = await screen.findByRole("button", {
      name: "删除容器 web",
    })
    removeButton.click()
    const confirm = await screen.findByRole("button", {
      name: "强制删除容器 web",
    })
    confirm.click()
    await waitFor(() =>
      expect(api.removeDockerContainer).toHaveBeenCalledTimes(1)
    )
    const [, body] = api.removeDockerContainer.mock.calls[0] ?? []
    expect(body).toEqual({ containerId: container().id, force: true })
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("已删除 web")
    )
  })

  it("执行中按钮禁用，避免重复提交", async () => {
    // 已停止的容器走普通删除路径
    api.fetchDockerContainers.mockResolvedValue(
      containersResponse([container({ state: "exited", status: "Exited" })])
    )
    api.removeDockerContainer.mockImplementation(
      () => new Promise(() => undefined)
    )
    renderList()
    const removeButton = await screen.findByRole("button", {
      name: "删除容器 web",
    })
    removeButton.click()
    const dialog = await screen.findByRole("alertdialog")
    const confirmButton = within(dialog).getByRole("button", {
      name: "删除容器 web",
    })
    confirmButton.click()
    await waitFor(() =>
      expect(api.removeDockerContainer).toHaveBeenCalledTimes(1)
    )
    // busy 期间确认按钮与取消按钮都不可再点
    await waitFor(() =>
      expect(confirmButton.hasAttribute("disabled")).toBe(true)
    )
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveProperty(
      "disabled",
      true
    )
    confirmButton.click()
    expect(api.removeDockerContainer).toHaveBeenCalledTimes(1)
  })

  it("日志抽屉展示行数与重新读取按钮", async () => {
    renderList()
    const logsButton = await screen.findByRole("button", {
      name: "查看容器 web 的日志",
    })
    logsButton.click()
    expect(await screen.findByText(/2 行/)).toBeTruthy()
    expect(screen.getByText(/数据时间/)).toBeTruthy()
    // 日志是一个整体文本块：断言两行都在，避免把行拆成多元素
    expect(screen.getByText(/ready[\s\S]*listening on 80/)).toBeTruthy()
    const refresh = screen.getByRole("button", { name: "重新读取" })
    refresh.click()
    await waitFor(() =>
      expect(api.fetchDockerContainerLogs).toHaveBeenCalledTimes(2)
    )
  })

  it("动作失败只提示错误，不冒充成功", async () => {
    api.removeDockerContainer.mockRejectedValue(
      new ApiRequestError("请求失败（HTTP 500）：容器仍在运行", 500)
    )
    renderList()
    const removeButton = await screen.findByRole("button", {
      name: "删除容器 web",
    })
    removeButton.click()
    const dialog = await screen.findByRole("alertdialog")
    // 运行中的容器只能走「强制删除」这条显式路径
    within(dialog).getByRole("button", { name: "强制删除容器 web" }).click()
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled())
    expect(toastMock.success).not.toHaveBeenCalled()
    // 失败后上下文保留，对话框不关闭
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("终止（kill）要二次确认，文案说明立即终止且没有清理机会", async () => {
    renderList()
    const killButton = await screen.findByRole("button", { name: "终止" })
    killButton.click()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("立即终止容器 web？")
    expect(dialog.textContent).toContain("没有清理机会")
    expect(api.actOnDockerContainer).not.toHaveBeenCalled()

    within(dialog).getByRole("button", { name: "立即终止容器 web" }).click()
    await waitFor(() =>
      expect(api.actOnDockerContainer).toHaveBeenCalledTimes(1)
    )
    const [, body] = api.actOnDockerContainer.mock.calls[0] ?? []
    expect(body).toMatchObject({ action: "kill", force: undefined })
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("已启动 web")
    )
  })
})

describe("新建容器入口", () => {
  it("打开表单并在成功后提示一次、关闭对话框", async () => {
    api.createDockerContainer.mockResolvedValue({
      kind: "completed",
      status: 201,
      body: {
        containerId: "new-id",
        name: "smoke-new",
        message: "已创建并启动 smoke-new",
      },
    })
    renderList()
    const open = await screen.findByRole("button", { name: "新建容器" })
    open.click()
    const dialog = await screen.findByRole("dialog")
    within(dialog).getByLabelText("镜像（必填）").setAttribute("value", "")
    const input = within(dialog).getByLabelText("镜像（必填）")
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set
    setter?.call(input, "alpine:3.20")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    within(dialog).getByRole("button", { name: "创建并启动" }).click()

    await waitFor(() =>
      expect(api.createDockerContainer).toHaveBeenCalledTimes(1)
    )
    expect(api.createDockerContainer.mock.calls[0]?.[1]).toEqual({
      image: "alpine:3.20",
      restartPolicy: "no",
    })
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("已创建并启动 smoke-new")
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("409 的中文文案留在对话框里，且不提示成功", async () => {
    api.createDockerContainer.mockRejectedValue(
      new ApiRequestError(
        "请求失败（HTTP 409）：本地没有该镜像，请先在镜像页拉取",
        409
      )
    )
    renderList()
    const open = await screen.findByRole("button", { name: "新建容器" })
    open.click()
    const dialog = await screen.findByRole("dialog")
    const input = within(dialog).getByLabelText("镜像（必填）")
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set
    setter?.call(input, "missing:latest")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    within(dialog).getByRole("button", { name: "创建并启动" }).click()

    expect(
      await within(dialog).findByText(/本地没有该镜像，请先在镜像页拉取/)
    ).toBeTruthy()
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })
})
