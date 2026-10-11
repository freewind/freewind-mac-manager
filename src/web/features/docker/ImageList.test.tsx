// @vitest-environment jsdom

import type { DockerImage } from "@shared/api-contract"
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
import { ImageList } from "./ImageList"

const { api, toastMock } = vi.hoisted(() => ({
  api: {
    fetchDockerImages: vi.fn(),
    pullDockerImage: vi.fn(),
    removeDockerImage: vi.fn(),
  },
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchDockerImages: api.fetchDockerImages,
  pullDockerImage: api.pullDockerImage,
  removeDockerImage: api.removeDockerImage,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

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

const image = (overrides: Partial<DockerImage> = {}): DockerImage => ({
  id: "sha256:abc",
  repository: "alpine",
  tag: "3.20",
  sizeBytes: 12_200_000,
  createdAt: 1_790_000_000_000,
  containers: 0,
  ...overrides,
})

const renderList = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ImageList />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  setDesktop(false)
  api.fetchDockerImages.mockResolvedValue({ images: [image()] })
  api.pullDockerImage.mockResolvedValue({
    kind: "accepted",
    body: {
      taskId: "task-1",
      kind: "docker_action",
      status: "running",
      startedAt: 1_790_000_000,
    },
  })
  api.removeDockerImage.mockResolvedValue({
    kind: "completed",
    status: 200,
    body: { message: "已删除镜像 alpine:3.20" },
  })
})

afterEach(() => {
  cleanup()
  clearPendingRequests()
  document.body.style.overflow = ""
  document.body.style.pointerEvents = ""
  for (const fn of Object.values(api)) fn.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  vi.unstubAllGlobals()
})

describe("镜像列表", () => {
  it("展示仓库、标签、大小与引用数", async () => {
    api.fetchDockerImages.mockResolvedValue({
      images: [image({ containers: 2, repository: "postgres", tag: "16" })],
    })
    renderList()
    expect(await screen.findByText("postgres")).toBeTruthy()
    expect(screen.getByText(/标签 16/)).toBeTruthy()
    expect(screen.getByText(/2 个容器正在使用/)).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "删除镜像 postgres:16" })
    ).toBeTruthy()
  })

  it("拉取对话框要求必填并校验格式，合法才提交", async () => {
    renderList()
    const open = await screen.findByRole("button", { name: "拉取镜像" })
    open.click()
    const dialog = await screen.findByRole("dialog")

    // 空值提交：提示必填且不发请求
    within(dialog).getByRole("button", { name: "开始拉取" }).click()
    expect(await within(dialog).findByText("请填写镜像地址")).toBeTruthy()
    expect(api.pullDockerImage).not.toHaveBeenCalled()

    // 非法格式：前端也拦一层
    const input = within(dialog).getByLabelText("镜像地址")
    fireEventChange(input, "--rm")
    within(dialog).getByRole("button", { name: "开始拉取" }).click()
    expect(await within(dialog).findByText("镜像地址格式不合法")).toBeTruthy()
    expect(api.pullDockerImage).not.toHaveBeenCalled()

    // 合法提交：调用拉取端点，且页面不自己画进度百分比
    fireEventChange(input, "alpine:3.20")
    within(dialog).getByRole("button", { name: "开始拉取" }).click()
    await waitFor(() => expect(api.pullDockerImage).toHaveBeenCalledTimes(1))
    expect(api.pullDockerImage.mock.calls[0]?.[1]).toEqual({
      image: "alpine:3.20",
    })
    // 不自己画进度：没有百分比文案，也没有进度条控件
    expect(screen.queryByText(/\d+\s*%/)).toBeNull()
    expect(screen.queryByRole("progressbar")).toBeNull()
  })

  it("删除先确认：对话框含镜像名，取消不发请求", async () => {
    renderList()
    const remove = await screen.findByRole("button", {
      name: "删除镜像 alpine:3.20",
    })
    remove.click()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("删除镜像 alpine:3.20？")
    expect(api.removeDockerImage).not.toHaveBeenCalled()

    within(dialog).getByRole("button", { name: "取消" }).click()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(api.removeDockerImage).not.toHaveBeenCalled()
  })

  it("被容器引用的镜像可以显式强制删除", async () => {
    api.fetchDockerImages.mockResolvedValue({
      images: [image({ containers: 2, repository: "postgres", tag: "16" })],
    })
    renderList()
    const remove = await screen.findByRole("button", {
      name: "删除镜像 postgres:16",
    })
    remove.click()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("2 个容器使用它")
    within(dialog)
      .getByRole("button", { name: "强制删除镜像 postgres:16" })
      .click()
    await waitFor(() => expect(api.removeDockerImage).toHaveBeenCalledTimes(1))
    expect(api.removeDockerImage.mock.calls[0]?.[1]).toEqual({
      imageId: "postgres:16",
      force: true,
    })
  })

  it("被引用删除失败时，409 文案在页面上持续可见且不冒充成功", async () => {
    api.removeDockerImage.mockRejectedValue(
      new ApiRequestError(
        "请求失败（HTTP 409）：该镜像被容器使用中，请先删除相关容器，或显式选择强制删除",
        409
      )
    )
    renderList()
    const remove = await screen.findByRole("button", {
      name: "删除镜像 alpine:3.20",
    })
    remove.click()
    const dialog = await screen.findByRole("alertdialog")
    within(dialog).getByRole("button", { name: "删除镜像 alpine:3.20" }).click()

    await waitFor(() =>
      expect(
        screen.getAllByText(/该镜像被容器使用中，请先删除相关容器/).length
      ).toBeGreaterThan(0)
    )
    // 页面级提示还在（不是一闪而过），且没有成功提示
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)
    expect(toastMock.success).not.toHaveBeenCalled()
    // 对话框保留上下文，便于改用强制删除
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("执行中禁用删除按钮，避免重复提交", async () => {
    api.removeDockerImage.mockImplementation(() => new Promise(() => undefined))
    renderList()
    const remove = await screen.findByRole("button", {
      name: "删除镜像 alpine:3.20",
    })
    remove.click()
    const dialog = await screen.findByRole("alertdialog")
    const confirm = within(dialog).getByRole("button", {
      name: "删除镜像 alpine:3.20",
    })
    confirm.click()
    await waitFor(() => expect(api.removeDockerImage).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(true))
    confirm.click()
    expect(api.removeDockerImage).toHaveBeenCalledTimes(1)
  })
})

/** React 受控输入需要原生 setter + input 事件，才能被组件读到。 */
function fireEventChange(element: HTMLElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}
