// @vitest-environment jsdom
import type { AiAssistantSettingsResponse } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AiAssistantDialog } from "./AiAssistantDialog"
import { useAiAssistantLocalStore } from "./store"

const { api } = vi.hoisted(() => ({
  api: { fetchAiAssistantSettings: vi.fn() },
}))

// 只替身设置读取；其余传输能力保持真实，行为与生产一致。
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAiAssistantSettings: api.fetchAiAssistantSettings,
}))

const settingsResponse = (
  overrides: Partial<AiAssistantSettingsResponse["settings"]> = {}
): AiAssistantSettingsResponse => ({
  settings: overrides,
  signature: "a".repeat(64),
  updatedAt: 1,
  defaults: { systemPrompt: "默认提示词", enabledTools: ["read", "bash"] },
})

const renderDialog = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AiAssistantDialog />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  api.fetchAiAssistantSettings.mockReset()
  useAiAssistantLocalStore.setState({
    open: false,
    initialContext: null,
    sessionId: null,
  })
})

afterEach(cleanup)

describe("AiAssistantDialog", () => {
  it("未配置模型时提示先去设置，并提供跳转入口", async () => {
    api.fetchAiAssistantSettings.mockResolvedValue(settingsResponse())
    act(() => useAiAssistantLocalStore.getState().openWith())
    const onOpenModelSettings = vi.fn()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <AiAssistantDialog onOpenModelSettings={onOpenModelSettings} />
      </QueryClientProvider>
    )

    expect(await screen.findByText("助手还没有选择模型")).toBeTruthy()
    const jump = screen.getByRole("button", { name: "去设置模型" })
    act(() => jump.click())
    expect(onOpenModelSettings).toHaveBeenCalledTimes(1)
    // 跳转前先把浮层关掉，避免设置页被浮层盖住。
    expect(useAiAssistantLocalStore.getState().open).toBe(false)
  })

  it("已配置模型时渲染对话组件（不发真实请求）", async () => {
    api.fetchAiAssistantSettings.mockResolvedValue(
      settingsResponse({ providerId: "pi", modelId: "cn:glm-5.3" })
    )
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    act(() => useAiAssistantLocalStore.getState().openWith())
    renderDialog()

    expect(await screen.findByPlaceholderText("Send a message...")).toBeTruthy()
    // 只是打开浮层：不应自动发送，也就不会有任何网络请求。
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("带着预填上下文打开时把它填进输入框", async () => {
    api.fetchAiAssistantSettings.mockResolvedValue(
      settingsResponse({ providerId: "pi", modelId: "cn:glm-5.3" })
    )
    act(() =>
      useAiAssistantLocalStore.getState().openWith("当前磁盘占用偏高，帮我看看")
    )
    renderDialog()

    const input = await screen.findByPlaceholderText("Send a message...")
    expect((input as HTMLTextAreaElement).value).toContain("当前磁盘占用偏高")
    // 预填只消费一次：上下文已释放，重新打开不会重复填入。
    expect(useAiAssistantLocalStore.getState().initialContext).toBeNull()
  })
})
