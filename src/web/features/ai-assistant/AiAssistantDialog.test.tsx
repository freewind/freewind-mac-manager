// @vitest-environment jsdom
import type { AiAssistantSettingsResponse } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AiAssistantDialog } from "./AiAssistantDialog"
import { useAiAssistantLocalStore } from "./store"

const { api } = vi.hoisted(() => ({
  api: { fetchAiAssistantSettings: vi.fn(), streamAiAssistantMessage: vi.fn() },
}))

// 只替身设置读取；其余传输能力保持真实，行为与生产一致。
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAiAssistantSettings: api.fetchAiAssistantSettings,
  streamAiAssistantMessage: api.streamAiAssistantMessage,
}))

// 官方 SpiralLoader 用 lottie 渲染（需要 canvas），测试里把它替身掉。
vi.mock("lottie-react", () => ({ default: () => null }))

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

/** 输入并回车发送：官方 InputBar 用 Enter 触发 onSend。 */
const sendMessage = async (text: string): Promise<void> => {
  const user = userEvent.setup()
  const input = await screen.findByPlaceholderText("Send a message...")
  await user.type(input, `${text}{Enter}`)
}

beforeEach(() => {
  // jsdom 没有 ResizeObserver，而官方 MessageList 会用到它。
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  )
  api.fetchAiAssistantSettings.mockReset()
  api.streamAiAssistantMessage.mockReset()
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

describe("新建对话", () => {
  it("已有会话时新建：旧消息消失，下一条请求不带旧 sessionId", async () => {
    api.fetchAiAssistantSettings.mockResolvedValue(
      settingsResponse({ providerId: "pi", modelId: "cn:glm-5.3" })
    )
    api.streamAiAssistantMessage.mockImplementation(
      async (options: {
        onSessionId?: (id: string) => void
        onEvent: (event: unknown) => void
      }) => {
        options.onSessionId?.("s-1")
        options.onEvent({ type: "delta", kind: "text", delta: "第一次回答" })
        options.onEvent({
          type: "done",
          status: "done",
          sessionId: "s-1",
          message: null,
        })
      }
    )
    act(() => useAiAssistantLocalStore.getState().openWith())
    renderDialog()

    await sendMessage("第一个问题")
    expect(await screen.findByText(/第一次回答/)).toBeTruthy()
    expect(useAiAssistantLocalStore.getState().sessionId).toBe("s-1")

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "新建对话" }))

    expect(screen.queryByText(/第一次回答/)).toBeNull()
    expect(useAiAssistantLocalStore.getState().sessionId).toBeNull()

    await sendMessage("第二个问题")
    // 新会话由服务端按当前设置创建：模型换了也能真正生效。
    expect(api.streamAiAssistantMessage.mock.calls[1][0].sessionId).toBeNull()
  })

  it("正在回答时不能新建：按钮禁用且消息保留", async () => {
    api.fetchAiAssistantSettings.mockResolvedValue(
      settingsResponse({ providerId: "pi", modelId: "cn:glm-5.3" })
    )
    let release: () => void = () => {}
    api.streamAiAssistantMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    act(() => useAiAssistantLocalStore.getState().openWith())
    renderDialog()

    await sendMessage("长回答")
    const button = screen.getByRole("button", { name: "新建对话" })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    const user = userEvent.setup()
    await user.click(button)
    // 消息还在，说明没有被清空
    expect(await screen.findByText("长回答")).toBeTruthy()

    await act(async () => {
      release()
    })
  })

  it("会话过期时给出可理解的提示并能新建，不自动重发旧输入", async () => {
    api.fetchAiAssistantSettings.mockResolvedValue(
      settingsResponse({ providerId: "pi", modelId: "cn:glm-5.3" })
    )
    const { ApiRequestError } = await import("@shared/client-api")
    api.streamAiAssistantMessage.mockRejectedValue(
      new ApiRequestError(
        "请求失败（HTTP 404）：会话不存在或已过期，请新建会话",
        404,
        {
          message: "会话不存在或已过期，请新建会话",
        }
      )
    )
    act(() => {
      useAiAssistantLocalStore.setState({ open: true, sessionId: "gone" })
    })
    renderDialog()

    await sendMessage("继续刚才的话题")

    expect(await screen.findByText("会话已过期")).toBeTruthy()
    expect(screen.getByText(/之前那条输入不会自动重发/)).toBeTruthy()
    // 只发了一次：没有拿旧 prompt 去新建会话自动重放
    expect(api.streamAiAssistantMessage).toHaveBeenCalledTimes(1)
    expect(api.streamAiAssistantMessage.mock.calls[0][0].sessionId).toBe("gone")

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "新建对话" }))
    expect(screen.queryByText("会话已过期")).toBeNull()
    expect(useAiAssistantLocalStore.getState().sessionId).toBeNull()
  })
})
