// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PiPage } from "./PiPage"

const { fetchModels, addProvider, updateProvider, deleteProvider } = vi.hoisted(
  () => ({
    fetchModels: vi.fn(),
    addProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
  })
)

vi.mock("@shared/client-api", () => ({
  fetchPiModels: fetchModels,
  addPiProvider: addProvider,
  updatePiProvider: updateProvider,
  deletePiProvider: deleteProvider,
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

beforeEach(() => {
  fetchModels.mockReset().mockResolvedValue(response)
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

  it("requires an explicit delete action", async () => {
    renderPage()
    fireEvent.click((await screen.findAllByRole("button", { name: "删除" }))[0])
    expect(screen.getByText(/将从 Pi 的 models.json 删除/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "删除 Provider" }))
    await waitFor(() => expect(deleteProvider).toHaveBeenCalledTimes(1))
  })
})
