// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsTab } from "./SettingsTab"

const { fetchSettings, fetchModels, saveSettings } = vi.hoisted(() => ({
  fetchSettings: vi.fn(),
  fetchModels: vi.fn(),
  saveSettings: vi.fn(),
}))

vi.mock("@shared/client-api", () => ({
  fetchPiSettings: fetchSettings,
  fetchPiModels: fetchModels,
  savePiSettings: saveSettings,
}))

beforeEach(() => {
  fetchSettings.mockReset().mockResolvedValue({
    signature: "b".repeat(64),
    updatedAt: 1,
    settings: { packages: ["npm:keep"] },
    defaults: {
      defaultThinkingLevel: "medium",
      theme: "system",
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000 },
      compaction: {
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
      },
    },
  })
  fetchModels.mockReset().mockResolvedValue({
    signature: "a".repeat(64),
    updatedAt: 1,
    providers: [
      {
        id: "p1",
        hasApiKey: false,
        modelCount: 1,
        provider: {
          name: "Provider 1",
          baseUrl: "https://example.test/v1",
          api: "openai-completions",
          models: [{ id: "m1", name: "Model 1" }],
        },
      },
    ],
  })
  saveSettings
    .mockReset()
    .mockResolvedValue({ status: 200, body: { signature: "c".repeat(64) } })
})

const renderSettings = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SettingsTab />
    </QueryClientProvider>
  )
}

describe("Pi settings editor", () => {
  it("loads defaults and saves validated model selection", async () => {
    renderSettings()
    await waitFor(() =>
      expect(screen.getByText("重试与上下文压缩")).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1))
    expect(saveSettings.mock.calls[0][0].signature).toBe("b".repeat(64))
    expect(saveSettings.mock.calls[0][0].settings.defaultThinkingLevel).toBe(
      "medium"
    )
  })
})
