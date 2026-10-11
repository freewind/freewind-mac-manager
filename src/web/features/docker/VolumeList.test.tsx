// @vitest-environment jsdom

import type { DockerVolume } from "@shared/api-contract"
import { ApiRequestError } from "@shared/client-api"
import { formatBytes } from "@shared/format"
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
import { VolumeList } from "./VolumeList"

const { api, toastMock } = vi.hoisted(() => ({
  api: {
    fetchDockerVolumes: vi.fn(),
    removeDockerVolume: vi.fn(),
  },
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchDockerVolumes: api.fetchDockerVolumes,
  removeDockerVolume: api.removeDockerVolume,
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

const volume = (overrides: Partial<DockerVolume> = {}): DockerVolume => ({
  name: "mac-manager-smoke-vol",
  driver: "local",
  mountpoint: "/var/lib/docker/volumes/mac-manager-smoke-vol/_data",
  createdAt: 1_790_000_000_000,
  sizeBytes: 795_500_000,
  inUse: false,
  ...overrides,
})

const renderList = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <VolumeList />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  setDesktop(false)
  api.fetchDockerVolumes.mockResolvedValue({ volumes: [volume()] })
  api.removeDockerVolume.mockResolvedValue({
    kind: "completed",
    status: 200,
    body: { message: "已删除卷 mac-manager-smoke-vol" },
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

describe("卷列表", () => {
  it("展示名称、驱动、大小与挂载点，大小未知时显示未知", async () => {
    api.fetchDockerVolumes.mockResolvedValue({
      volumes: [
        volume({ name: "known", sizeBytes: 1024 }),
        volume({ name: "unknown", sizeBytes: null }),
      ],
    })
    renderList()
    const knownRow = (await screen.findByText("known")).closest("li")
    expect(knownRow?.textContent).toContain(`驱动 local · ${formatBytes(1024)}`)
    expect(knownRow?.textContent).toContain("挂载点 /var/lib/docker/volumes")
    const unknownRow = (await screen.findByText("unknown")).closest("li")
    expect(unknownRow?.textContent).toContain("未知")
  })

  it("被容器使用的卷：删除按钮禁用并说明原因", async () => {
    api.fetchDockerVolumes.mockResolvedValue({
      volumes: [volume({ inUse: true })],
    })
    renderList()
    const button = await screen.findByRole("button", {
      name: "删除卷 mac-manager-smoke-vol",
    })
    expect(button.hasAttribute("disabled")).toBe(true)
    expect(
      screen.getByText("正被容器使用，不能删除（请先删除相关容器）")
    ).toBeTruthy()
    button.click()
    // 点了也不会打开确认框
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(api.removeDockerVolume).not.toHaveBeenCalled()
  })

  it("删除先确认：对话框含卷名，取消不发请求", async () => {
    renderList()
    const remove = await screen.findByRole("button", {
      name: "删除卷 mac-manager-smoke-vol",
    })
    remove.click()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("删除卷 mac-manager-smoke-vol？")
    expect(api.removeDockerVolume).not.toHaveBeenCalled()

    within(dialog).getByRole("button", { name: "取消" }).click()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(api.removeDockerVolume).not.toHaveBeenCalled()
  })

  it("确认后调用删除端点并提示一次", async () => {
    renderList()
    const remove = await screen.findByRole("button", {
      name: "删除卷 mac-manager-smoke-vol",
    })
    remove.click()
    const dialog = await screen.findByRole("alertdialog")
    within(dialog)
      .getByRole("button", { name: "删除卷 mac-manager-smoke-vol" })
      .click()
    await waitFor(() => expect(api.removeDockerVolume).toHaveBeenCalledTimes(1))
    expect(api.removeDockerVolume.mock.calls[0]?.[1]).toEqual({
      name: "mac-manager-smoke-vol",
    })
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        "已删除卷 mac-manager-smoke-vol"
      )
    )
  })

  it("后端 409 时文案在页面上持续可见且不冒充成功", async () => {
    api.removeDockerVolume.mockRejectedValue(
      new ApiRequestError(
        "请求失败（HTTP 409）：该卷正被容器使用，请先删除相关容器",
        409
      )
    )
    renderList()
    const remove = await screen.findByRole("button", {
      name: "删除卷 mac-manager-smoke-vol",
    })
    remove.click()
    const dialog = await screen.findByRole("alertdialog")
    within(dialog)
      .getByRole("button", { name: "删除卷 mac-manager-smoke-vol" })
      .click()

    const message =
      await screen.findByText(/该卷正被容器使用，请先删除相关容器/)
    // 弹窗打开时页面其余部分被 aria-hidden，因此按文本定位再确认它属于 alert 容器
    expect(message.closest('[role="alert"]')).toBeTruthy()
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})
