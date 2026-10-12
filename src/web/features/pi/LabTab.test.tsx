// @vitest-environment jsdom

import type { PiLabResult } from "@shared/api-contract/schemas/pi-lab"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LabTab } from "./LabTab"

const api = vi.hoisted(() => ({
  fetchPiLab: vi.fn(),
  fetchPiLabRuns: vi.fn(),
  fetchPiModels: vi.fn(),
  startPiLab: vi.fn(),
  cancelPiLab: vi.fn(),
  clearPiLab: vi.fn(),
}))

vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchPiLab: api.fetchPiLab,
  fetchPiLabRuns: api.fetchPiLabRuns,
  fetchPiModels: api.fetchPiModels,
  startPiLab: api.startPiLab,
  cancelPiLab: api.cancelPiLab,
  clearPiLab: api.clearPiLab,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const RUN_ID = "run-1234567890abcdef"

const runResult = (overrides: Partial<PiLabResult> = {}): PiLabResult => ({
  id: RUN_ID,
  sessionId: null,
  providerId: "p1",
  modelId: "m1",
  mode: "probe",
  status: "running",
  message: "探测中",
  text: "",
  thinking: "",
  input: "{}",
  payload: "{}",
  samples: [],
  updatedAt: Date.now(),
  ...overrides,
})

const sample = (maxTokens: number) => ({
  requestedThinking: "off" as const,
  requestedMaxTokens: maxTokens,
  sentParameters: null,
  status: "accepted" as const,
  stopReason: null,
  outputTokens: 16,
})

const renderLab = (mode: "chat" | "probe" = "probe") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <LabTab mode={mode} />
    </QueryClientProvider>
  )

const sleep = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

let desktop = true

/** 与 useIsDesktop 一致的匹配媒体查询替身：改 desktop 就切换断点。 */
const setDesktop = (value: boolean) => {
  desktop = value
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

beforeEach(() => {
  setDesktop(true)
  window.history.replaceState({}, "", `/?piRun=${RUN_ID}`)
  api.fetchPiModels.mockResolvedValue({ providers: [] })
  api.fetchPiLabRuns.mockResolvedValue([])
  api.cancelPiLab.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, "", "/")
  for (const fn of Object.values(api)) fn.mockReset()
})

describe("能力探测的进度与收敛", () => {
  it("running 期间显示阶段、已完成计数与剩余时间", async () => {
    api.fetchPiLab.mockResolvedValue(
      runResult({ samples: [sample(128), sample(512)] })
    )
    renderLab()

    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "探测进度" }).textContent
      ).toContain("正在探测第 3 轮")
    )
    const progress = screen.getByRole("status", { name: "探测进度" })
    expect(progress.textContent).toContain("已完成 2/4 项")
    expect(progress.textContent).toContain("剩余")
  })

  it("读取失败后停止轮询，只如实显示错误", async () => {
    api.fetchPiLab.mockRejectedValue(new Error("网络中断"))
    renderLab()

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("网络中断")
    // 失败后不再 500ms 无限重试：页面不会永远停在「正在检测」
    await sleep(1300)
    expect(api.fetchPiLab).toHaveBeenCalledTimes(1)
  })

  it("超过服务端陈旧判据后按结果未知处理并停止轮询", async () => {
    api.fetchPiLab.mockResolvedValue(
      runResult({ updatedAt: Date.now() - 80_000 })
    )
    renderLab()

    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "探测进度" }).textContent
      ).toContain("按结果未知处理")
    )
    await sleep(1300)
    expect(api.fetchPiLab).toHaveBeenCalledTimes(1)
  })

  it("组件卸载时取消仍在进行的读取", async () => {
    let signal: AbortSignal | undefined
    api.fetchPiLab.mockImplementation(
      (_id: string, next?: AbortSignal): Promise<PiLabResult> => {
        signal = next
        return new Promise(() => undefined)
      }
    )
    const { unmount } = renderLab()

    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal))
    expect(signal?.aborted).toBe(false)
    unmount()
    await waitFor(() => expect(signal?.aborted).toBe(true))
  })

  it("中止当前请求会同时取消本地读取并请求服务端停止", async () => {
    api.fetchPiLab.mockResolvedValue(runResult())
    renderLab()

    await screen.findByRole("status", { name: "探测进度" })
    fireEvent.click(screen.getByRole("button", { name: "中止当前请求" }))

    await waitFor(() => expect(api.cancelPiLab).toHaveBeenCalledTimes(1))
    expect(api.cancelPiLab.mock.calls[0][0]).toBe(RUN_ID)
  })

  it("手机二选一渲染：参数视图不挂载结果区，请求入口常驻底栏", async () => {
    setDesktop(false)
    api.fetchPiLab.mockResolvedValue(runResult())
    renderLab()

    expect(await screen.findByText("系统提示词")).toBeTruthy()
    // 结果区（进度）在参数视图下不挂载，而不是隐藏两套
    expect(screen.queryByRole("status", { name: "探测进度" })).toBeNull()
    // 请求入口在常驻底栏上，随时可点
    expect(screen.getByRole("button", { name: "发起有界探测" })).toBeTruthy()
  })

  it("桌面参数与结果并列在两列网格里", async () => {
    api.fetchPiLab.mockResolvedValue(runResult())
    renderLab()

    await screen.findByRole("status", { name: "探测进度" })
    const grid = document.querySelector(".md\\:grid-cols-2")
    expect(grid).not.toBeNull()
    // 参数与结果同在一个两列容器里，各自滚动不互相推挤
    expect(grid?.textContent).toContain("系统提示词")
    expect(grid?.querySelector('[aria-label="探测进度"]')).not.toBeNull()
  })

  it("探测结束后不再显示进度", async () => {
    api.fetchPiLab.mockResolvedValue(
      runResult({ status: "done", message: "探测完成" })
    )
    renderLab()

    expect(await screen.findByText(/done：探测完成/)).toBeTruthy()
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "探测进度" })).toBeNull()
    )
  })
})
