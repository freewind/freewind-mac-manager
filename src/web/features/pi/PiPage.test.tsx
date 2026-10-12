// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PiPage } from "./PiPage"

const {
  fetchModels,
  fetchBenchmarks,
  startBenchmark,
  deleteBenchmarks,
  addProvider,
  updateProvider,
  deleteProvider,
  fetchAssistantSettings,
  saveAssistantSettings,
} = vi.hoisted(() => ({
  fetchModels: vi.fn(),
  fetchBenchmarks: vi.fn(),
  startBenchmark: vi.fn(),
  deleteBenchmarks: vi.fn(),
  addProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  fetchAssistantSettings: vi.fn(),
  saveAssistantSettings: vi.fn(),
}))

vi.mock("@shared/client-api", () => ({
  fetchPiModels: fetchModels,
  fetchPiBenchmarks: fetchBenchmarks,
  startPiBenchmark: startBenchmark,
  deletePiBenchmarks: deleteBenchmarks,
  addPiProvider: addProvider,
  updatePiProvider: updateProvider,
  deletePiProvider: deleteProvider,
  // 助手设置卡片（AI助手标签）从同一入口读取能力，此处用无害替身补全
  fetchAiAssistantSettings: fetchAssistantSettings,
  saveAiAssistantSettings: saveAssistantSettings,
  // 页面与其它页签从同一入口导入的其余能力，此处用无害替身补全
  fetchTaskByRequestId: vi.fn(),
  newRequestId: vi.fn(() => "req_test_benchmark_001"),
  ApiRequestError: class ApiRequestError extends Error {},
  cancelPiLab: vi.fn(),
  clearPiLab: vi.fn(),
  fetchPiLab: vi.fn(),
  fetchPiLabRuns: vi.fn(),
  startPiLab: vi.fn(),
  fetchPiSettings: vi.fn(),
  savePiSettings: vi.fn(),
}))

const response = {
  signature: "a".repeat(64),
  updatedAt: 1,
  providers: [
    {
      id: "test",
      hasApiKey: true,
      modelCount: 1,
      provider: {
        name: "Test",
        baseUrl: "https://example.test/v1",
        api: "openai-completions",
        models: [{ id: "model-one", contextWindow: 1000, maxTokens: 100 }],
      },
    },
  ],
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

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PiPage />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, "", "/")
})

beforeEach(() => {
  setDesktop(true)
  fetchModels.mockReset().mockResolvedValue(response)
  fetchAssistantSettings.mockReset().mockResolvedValue({
    settings: {},
    signature: "c".repeat(64),
    updatedAt: 1,
    defaults: { systemPrompt: "默认提示词", enabledTools: ["read"] },
  })
  saveAssistantSettings.mockReset()
  fetchBenchmarks.mockReset().mockResolvedValue({ benchmarks: [] })
  startBenchmark.mockReset().mockResolvedValue({
    kind: "completed",
    status: 200,
    body: { id: "req_test_benchmark_001" },
  })
  deleteBenchmarks.mockReset().mockResolvedValue({ status: 204, body: null })
  addProvider.mockReset().mockResolvedValue({ status: 201, body: {} })
  updateProvider.mockReset().mockResolvedValue({ status: 200, body: {} })
  deleteProvider.mockReset().mockResolvedValue({ status: 204, body: null })
})

describe("Pi model manager page", () => {
  it("lists provider/model metadata but never receives a key", async () => {
    renderPage()
    expect(await screen.findByText("test")).toBeTruthy()
    expect(screen.getByText("密钥已配置")).toBeTruthy()
    expect(JSON.stringify(fetchModels.mock.results[0].value)).not.toContain(
      "apiKey"
    )
  })

  it("submits provider changes without sending a key on reads", async () => {
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }))
    fireEvent.change(screen.getByLabelText("Provider ID"), {
      target: { value: "renamed" },
    })
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }))
    await waitFor(() => expect(updateProvider).toHaveBeenCalledTimes(1))
    expect(updateProvider.mock.calls[0][0]).toBe("test")
    expect(updateProvider.mock.calls[0][1].provider.apiKey).toBeUndefined()
    expect(updateProvider.mock.calls[0][1].clearApiKey).toBe(false)
  })

  it("starts a benchmark only after an explicit user action", async () => {
    renderPage()
    await screen.findByText("test")
    expect(startBenchmark).not.toHaveBeenCalled()
    // 测速是独立工作区：先显式打开，不再默认压在模型列表前面
    fireEvent.click(screen.getByRole("button", { name: "模型测速" }))
    const providerInput = screen.getByRole("combobox", {
      name: /测速 Provider/,
    })
    fireEvent.focus(providerInput)
    fireEvent.keyDown(providerInput, { key: "ArrowDown" })
    fireEvent.click(
      await within(document.body).findByRole("option", { name: "test" })
    )
    const modelInput = screen.getByRole("combobox", { name: "测速模型" })
    fireEvent.focus(modelInput)
    fireEvent.keyDown(modelInput, { key: "ArrowDown" })
    fireEvent.click(
      await within(document.body).findByRole("option", { name: /model-one/ })
    )
    fireEvent.click(screen.getByRole("button", { name: "开始一次测速" }))
    await waitFor(() => expect(startBenchmark).toHaveBeenCalledTimes(1))
    expect(startBenchmark.mock.calls[0][0]).toMatchObject({
      providerId: "test",
      modelId: "model-one",
      thinkingLevel: "medium",
    })
  })

  it("requires an explicit delete action", async () => {
    renderPage()
    fireEvent.click((await screen.findAllByRole("button", { name: "删除" }))[0])
    expect(screen.getByText(/将从 Pi 的 models.json 删除/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "删除 Provider" }))
    await waitFor(() => expect(deleteProvider).toHaveBeenCalledTimes(1))
  })

  it("通过 piTab=assistant 直接定位到 AI 助手设置", async () => {
    window.history.replaceState({}, "", "/?feature=pi&piTab=assistant")
    renderPage()

    expect(await screen.findByText(/设置只保存在应用数据库/)).toBeTruthy()
    expect(await screen.findByLabelText("助手系统提示词")).toBeTruthy()
  })

  it("点击「AI助手」标签后，地址栏带上 piTab，刷新可恢复", async () => {
    renderPage()
    await screen.findByText("test")

    fireEvent.click(screen.getByRole("button", { name: "AI助手" }))

    expect(await screen.findByText(/设置只保存在应用数据库/)).toBeTruthy()
    expect(new URL(window.location.href).searchParams.get("piTab")).toBe(
      "assistant"
    )
  })

  it("手机上分区收进一个选择入口，不再铺一整排按钮", async () => {
    setDesktop(false)
    renderPage()
    await screen.findByText("test")

    // 桌面那一排分区按钮不在 DOM 里
    expect(screen.queryByRole("button", { name: "分组" })).toBeNull()
    // 当前分区在入口上可见，切换后进入对应分区
    fireEvent.click(screen.getByRole("button", { name: "当前分区：模型" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "设置" }))
    expect(new URL(window.location.href).searchParams.get("piTab")).toBe(
      "settings"
    )
    // 入口上的当前分区跟着变（设置内容本身依赖接口返回，这里不断言）
    expect(screen.getByRole("button", { name: "当前分区：设置" })).toBeTruthy()
  })

  it("模型分区默认显示 Provider 列表，测速与历史不占首屏", async () => {
    renderPage()
    await screen.findByText("test")

    expect(screen.getByRole("button", { name: "模型测速" })).toBeTruthy()
    expect(screen.queryByText("测速历史（最多 100 条）")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "模型测速" }))
    expect(await screen.findByText("测速历史（最多 100 条）")).toBeTruthy()
  })
})
