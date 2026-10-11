// @vitest-environment jsdom

import type { DockerNetwork } from "@shared/api-contract"
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
import { NetworkList } from "./NetworkList"

const { api, toastMock } = vi.hoisted(() => ({
  api: {
    fetchDockerNetworks: vi.fn(),
    removeDockerNetwork: vi.fn(),
  },
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchDockerNetworks: api.fetchDockerNetworks,
  removeDockerNetwork: api.removeDockerNetwork,
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

const network = (overrides: Partial<DockerNetwork> = {}): DockerNetwork => ({
  id: "net-1",
  name: "mac-manager-smoke-net",
  driver: "bridge",
  scope: "local",
  internal: false,
  containers: 0,
  builtin: false,
  ...overrides,
})

const renderList = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NetworkList />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  setDesktop(false)
  api.fetchDockerNetworks.mockResolvedValue({ networks: [network()] })
  api.removeDockerNetwork.mockResolvedValue({
    kind: "completed",
    status: 200,
    body: { message: "已删除网络 mac-manager-smoke-net" },
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

describe("网络列表", () => {
  it("展示名称、驱动、scope 与接入容器数", async () => {
    api.fetchDockerNetworks.mockResolvedValue({
      networks: [network({ containers: 2 })],
    })
    renderList()
    const row = (await screen.findByText("mac-manager-smoke-net")).closest("li")
    expect(row?.textContent).toContain(
      "驱动 bridge · scope local · 接入 2 个容器"
    )
  })

  it("内置网络：删除按钮禁用并说明原因", async () => {
    api.fetchDockerNetworks.mockResolvedValue({
      networks: [network({ name: "bridge", builtin: true, containers: 1 })],
    })
    renderList()
    const button = await screen.findByRole("button", {
      name: "删除网络 bridge",
    })
    expect(button.hasAttribute("disabled")).toBe(true)
    expect(screen.getByText("Docker 内置网络，不能删除")).toBeTruthy()
    button.click()
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(api.removeDockerNetwork).not.toHaveBeenCalled()
  })

  it("非内置网络：确认框含网络名与接入数，取消不发请求", async () => {
    api.fetchDockerNetworks.mockResolvedValue({
      networks: [network({ containers: 2 })],
    })
    renderList()
    const remove = await screen.findByRole("button", {
      name: "删除网络 mac-manager-smoke-net",
    })
    expect(remove.hasAttribute("disabled")).toBe(false)
    remove.click()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("删除网络 mac-manager-smoke-net？")
    expect(dialog.textContent).toContain("2 个容器接入")
    expect(api.removeDockerNetwork).not.toHaveBeenCalled()

    within(dialog).getByRole("button", { name: "取消" }).click()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(api.removeDockerNetwork).not.toHaveBeenCalled()
  })

  it("确认后调用删除端点并提示一次", async () => {
    renderList()
    const remove = await screen.findByRole("button", {
      name: "删除网络 mac-manager-smoke-net",
    })
    remove.click()
    const dialog = await screen.findByRole("alertdialog")
    within(dialog)
      .getByRole("button", { name: "删除网络 mac-manager-smoke-net" })
      .click()
    await waitFor(() =>
      expect(api.removeDockerNetwork).toHaveBeenCalledTimes(1)
    )
    expect(api.removeDockerNetwork.mock.calls[0]?.[1]).toEqual({
      networkId: "net-1",
    })
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        "已删除网络 mac-manager-smoke-net"
      )
    )
  })

  it("仍有容器接入：后端 409 文案持续展示且不冒充成功", async () => {
    api.removeDockerNetwork.mockRejectedValue(
      new ApiRequestError(
        "请求失败（HTTP 409）：该网络仍有容器接入，请先断开",
        409
      )
    )
    renderList()
    const remove = await screen.findByRole("button", {
      name: "删除网络 mac-manager-smoke-net",
    })
    remove.click()
    const dialog = await screen.findByRole("alertdialog")
    within(dialog)
      .getByRole("button", { name: "删除网络 mac-manager-smoke-net" })
      .click()

    const message = await screen.findByText(/该网络仍有容器接入，请先断开/)
    expect(message.closest('[role="alert"]')).toBeTruthy()
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})
