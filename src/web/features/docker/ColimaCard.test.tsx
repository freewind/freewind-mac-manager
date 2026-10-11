// @vitest-environment jsdom

import type { DockerColimaStatus } from "@shared/api-contract"
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
import { ColimaCard } from "./ColimaCard"

const { api, toastMock } = vi.hoisted(() => ({
  api: {
    fetchDockerColimaStatus: vi.fn(),
    actOnDockerColima: vi.fn(),
  },
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchDockerColimaStatus: api.fetchDockerColimaStatus,
  actOnDockerColima: api.actOnDockerColima,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

const colima = (
  overrides: Partial<DockerColimaStatus> = {}
): DockerColimaStatus => ({
  installed: true,
  running: true,
  status: "colima 运行中",
  runtime: "docker",
  arch: "x86_64",
  cpus: null,
  memoryBytes: null,
  diskBytes: null,
  checkedAt: 1_790_000_000_000,
  ...overrides,
})

const renderCard = (running = true, runningContainers = 4) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ColimaCard
        colima={colima({ running })}
        runningContainers={runningContainers}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
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
  api.fetchDockerColimaStatus.mockResolvedValue(colima())
  api.actOnDockerColima.mockResolvedValue({
    kind: "completed",
    status: 200,
    body: { message: "Colima 已停止" },
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

describe("Colima 控制", () => {
  it("运行中显示停止与重启", async () => {
    renderCard(true)
    expect(await screen.findByRole("button", { name: "停止" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "重启" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "启动" })).toBeNull()
  })

  it("未运行时只显示启动", async () => {
    api.fetchDockerColimaStatus.mockResolvedValue(
      colima({ running: false, status: "colima 未运行" })
    )
    renderCard(false)
    expect(await screen.findByRole("button", { name: "启动" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "停止" })).toBeNull()
    expect(screen.queryByRole("button", { name: "重启" })).toBeNull()
  })

  it("未安装时不给任何操作入口，只说明不可用", async () => {
    api.fetchDockerColimaStatus.mockResolvedValue(
      colima({
        installed: false,
        running: false,
        status: "未安装 colima",
        runtime: null,
        arch: null,
      })
    )
    renderCard(false)
    expect(await screen.findByText("未安装")).toBeTruthy()
    expect(
      screen.getAllByText(/未安装 colima，Docker 能力不可用/).length
    ).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: "启动" })).toBeNull()
    expect(screen.queryByRole("button", { name: "停止" })).toBeNull()
    expect(screen.queryByRole("button", { name: "重启" })).toBeNull()
  })

  it("停止确认写明会停止多少个正在运行的容器，取消不发请求", async () => {
    renderCard(true, 4)
    const stop = await screen.findByRole("button", { name: "停止" })
    stop.click()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("停止 Colima 并停止 4 个容器？")
    expect(dialog.textContent).toContain(
      "同时停止全部正在运行的容器（当前 4 个）"
    )
    expect(api.actOnDockerColima).not.toHaveBeenCalled()

    within(dialog).getByRole("button", { name: "取消" }).click()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(api.actOnDockerColima).not.toHaveBeenCalled()
  })

  it("重启确认写明会中断多少个容器，确认后调用正确的动作", async () => {
    renderCard(true, 3)
    const restart = await screen.findByRole("button", { name: "重启" })
    restart.click()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("会中断 3 个容器")

    within(dialog)
      .getByRole("button", { name: "重启 Colima（会中断 3 个容器）" })
      .click()
    await waitFor(() => expect(api.actOnDockerColima).toHaveBeenCalledTimes(1))
    expect(api.actOnDockerColima.mock.calls[0]?.[1]).toEqual({
      action: "restart",
    })
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Colima 已停止")
    )
  })

  it("启动不需要确认，直接提交", async () => {
    api.fetchDockerColimaStatus.mockResolvedValue(
      colima({ running: false, status: "colima 未运行" })
    )
    renderCard(false)
    const start = await screen.findByRole("button", { name: "启动" })
    start.click()
    await waitFor(() => expect(api.actOnDockerColima).toHaveBeenCalledTimes(1))
    expect(api.actOnDockerColima.mock.calls[0]?.[1]).toEqual({
      action: "start",
    })
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("执行中禁用按钮，防重复提交", async () => {
    api.actOnDockerColima.mockImplementation(() => new Promise(() => undefined))
    renderCard(true, 2)
    const stop = await screen.findByRole("button", { name: "停止" })
    stop.click()
    const dialog = await screen.findByRole("alertdialog")
    within(dialog)
      .getByRole("button", { name: "停止 Colima 并停止 2 个容器" })
      .click()
    await waitFor(() => expect(api.actOnDockerColima).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(stop.hasAttribute("disabled")).toBe(true))
    stop.click()
    expect(api.actOnDockerColima).toHaveBeenCalledTimes(1)
  })

  it("409 文案在卡片上持续可见，且不提示成功", async () => {
    api.actOnDockerColima.mockRejectedValue(
      new ApiRequestError("请求失败（HTTP 409）：Colima 已在运行", 409)
    )
    renderCard(true)
    const stop = await screen.findByRole("button", { name: "停止" })
    stop.click()
    const dialog = await screen.findByRole("alertdialog")
    within(dialog)
      .getByRole("button", { name: "停止 Colima 并停止 4 个容器" })
      .click()

    const message = await screen.findByText(/Colima 已在运行/)
    expect(message.closest('[role="alert"]')).toBeTruthy()
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})
