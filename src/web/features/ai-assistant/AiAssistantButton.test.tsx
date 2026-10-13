// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AiAssistantButton } from "./AiAssistantButton"
import { useAiAssistantLocalStore } from "./store"

const { api } = vi.hoisted(() => ({
  api: { streamAiAssistantMessage: vi.fn(), saveAiAssistantSettings: vi.fn() },
}))

// 传输层替身：用来证明「点按钮不会发送任何请求」。
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  streamAiAssistantMessage: api.streamAiAssistantMessage,
  saveAiAssistantSettings: api.saveAiAssistantSettings,
}))

const CONTEXT = "【AI 助手上下文 · 总览】macbook\n数据状态：正常（未提供时间）"

beforeEach(() => {
  useAiAssistantLocalStore.setState({
    open: false,
    initialContext: null,
    sessionId: null,
  })
})

afterEach(cleanup)

describe("AiAssistantButton", () => {
  it("点击只打开浮层并预填上下文，不发送任何内容", async () => {
    const user = userEvent.setup()
    render(<AiAssistantButton context={CONTEXT} />)

    await user.click(screen.getByRole("button", { name: "AI 助手" }))

    const state = useAiAssistantLocalStore.getState()
    expect(state.open).toBe(true)
    expect(state.initialContext).toBe(CONTEXT)
    // 没有会话、也没有发出请求：发送必须由用户在浮层里手动触发。
    expect(state.sessionId).toBeNull()
    expect(api.streamAiAssistantMessage).not.toHaveBeenCalled()
    expect(api.saveAiAssistantSettings).not.toHaveBeenCalled()
  })

  it("不带上下文时只打开浮层，不预填", async () => {
    const user = userEvent.setup()
    render(<AiAssistantButton />)

    await user.click(screen.getByRole("button", { name: "AI 助手" }))

    expect(useAiAssistantLocalStore.getState().open).toBe(true)
    expect(useAiAssistantLocalStore.getState().initialContext).toBeNull()
  })

  it("按钮可聚焦、可键盘触发，且可见文案是 AI、触控目标不小于 44px", async () => {
    const user = userEvent.setup()
    render(<AiAssistantButton context={CONTEXT} />)

    const button = screen.getByRole("button", { name: "AI 助手" })
    expect(button.textContent).toContain("AI")
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(button.getAttribute("aria-label")).toBe("AI 助手")

    await user.tab()
    expect(document.activeElement).toBe(button)

    await user.keyboard("{Enter}")
    expect(useAiAssistantLocalStore.getState().open).toBe(true)
    expect(api.streamAiAssistantMessage).not.toHaveBeenCalled()
  })
})
