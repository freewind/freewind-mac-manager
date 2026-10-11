// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
} = vi.hoisted(() => ({
  fetchModels: vi.fn(),
  fetchBenchmarks: vi.fn(),
  startBenchmark: vi.fn(),
  deleteBenchmarks: vi.fn(),
  addProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
}))

vi.mock("@shared/client-api", () => ({
  fetchPiModels: fetchModels,
  fetchPiBenchmarks: fetchBenchmarks,
  startPiBenchmark: startBenchmark,
  deletePiBenchmarks: deleteBenchmarks,
  addPiProvider: addProvider,
  updatePiProvider: updateProvider,
  deletePiProvider: deleteProvider,
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
})

beforeEach(() => {
  fetchModels.mockReset().mockResolvedValue(response)
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
    fireEvent.click(screen.getByRole("combobox", { name: /测速 Provider/ }))
    fireEvent.click(await screen.findByRole("option", { name: "test" }))
    fireEvent.click(screen.getByRole("combobox", { name: "测速模型" }))
    fireEvent.click(await screen.findByRole("option", { name: /model-one/ }))
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
})
