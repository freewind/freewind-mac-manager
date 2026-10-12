// @vitest-environment jsdom
import type { AiAssistantSettingsResponse } from "@shared/api-contract"
import { ApiRequestError } from "@shared/client-api"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsCard } from "./SettingsCard"

const { api, toastMock } = vi.hoisted(() => ({
  api: {
    fetchAiAssistantSettings: vi.fn(),
    saveAiAssistantSettings: vi.fn(),
    fetchPiModels: vi.fn(),
  },
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

// 只替身这三项远程调用；ApiRequestError 等公共能力保持真实。
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAiAssistantSettings: api.fetchAiAssistantSettings,
  saveAiAssistantSettings: api.saveAiAssistantSettings,
  fetchPiModels: api.fetchPiModels,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

const SETTINGS_SIGNATURE = "a".repeat(64)

const settingsResponse = (
  overrides: Partial<AiAssistantSettingsResponse["settings"]> = {},
  signature = SETTINGS_SIGNATURE
): AiAssistantSettingsResponse => ({
  settings: {
    providerId: "alpha",
    modelId: "m1",
    thinkingLevel: "medium",
    systemPrompt: "自定义提示词",
    ...overrides,
  },
  signature,
  updatedAt: 1,
  defaults: { systemPrompt: "默认提示词", enabledTools: ["read"] },
})

/** Pi 已配置的模型目录：两个 Provider，模型不重叠。 */
const modelsResponse = {
  signature: "b".repeat(64),
  updatedAt: 1,
  providers: [
    {
      id: "alpha",
      hasApiKey: true,
      modelCount: 2,
      provider: {
        name: "Alpha",
        baseUrl: "https://alpha.test/v1",
        api: "openai-completions",
        models: [{ id: "m1" }, { id: "m2" }],
      },
    },
    {
      id: "beta",
      hasApiKey: true,
      modelCount: 1,
      provider: {
        name: "Beta",
        baseUrl: "https://beta.test/v1",
        api: "openai-completions",
        models: [{ id: "b1" }],
      },
    },
  ],
}

const renderCard = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SettingsCard />
    </QueryClientProvider>
  )
}

const pickFrom = async (label: string, option: string): Promise<void> => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("combobox", { name: label }))
  await user.click(await screen.findByRole("option", { name: option }))
}

beforeEach(() => {
  api.fetchAiAssistantSettings.mockReset().mockResolvedValue(settingsResponse())
  api.fetchPiModels.mockReset().mockResolvedValue(modelsResponse)
  api.saveAiAssistantSettings
    .mockReset()
    .mockResolvedValue(settingsResponse({}, "c".repeat(64)))
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

afterEach(cleanup)

describe("AI 助手设置卡片", () => {
  it("显示已保存的模型与提示词，并提供显式刷新模型列表", async () => {
    renderCard()

    expect(await screen.findByLabelText("助手系统提示词")).toHaveProperty(
      "value",
      "自定义提示词"
    )
    expect(
      screen.getByRole("combobox", { name: "助手 Provider" })
    ).toHaveProperty("textContent", "alpha")
    expect(screen.getByRole("combobox", { name: "助手模型" })).toHaveProperty(
      "textContent",
      "m1"
    )
    // 读取的是 Pi 已配置目录，不做网络发现：不点刷新就不重新读取。
    expect(api.fetchPiModels).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: /刷新模型列表/ }))
    await waitFor(() => expect(api.fetchPiModels).toHaveBeenCalledTimes(2))
  })

  it("换 Provider 后不属于它的模型被清空，选好才可保存", async () => {
    renderCard()
    await screen.findByLabelText("助手系统提示词")

    await pickFrom("助手 Provider", "beta")

    // m1 不属于 beta：模型被清空，保存按钮不可用。
    expect(screen.getByRole("combobox", { name: "助手模型" })).toHaveProperty(
      "textContent",
      "选择模型"
    )
    const save = screen.getByRole("button", { name: "保存设置" })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    await pickFrom("助手模型", "b1")
    expect(
      (screen.getByRole("button", { name: "保存设置" }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  })

  it("编辑系统提示词，并能恢复默认提示词（不影响模型选择）", async () => {
    renderCard()
    const textarea = await screen.findByLabelText("助手系统提示词")

    fireEvent.change(textarea, { target: { value: "改过的提示词" } })
    expect(textarea).toHaveProperty("value", "改过的提示词")

    fireEvent.click(screen.getByRole("button", { name: /恢复默认提示词/ }))
    expect(screen.getByLabelText("助手系统提示词")).toHaveProperty(
      "value",
      "默认提示词"
    )
    // 恢复默认提示词只改提示词，不碰模型。
    expect(
      screen.getByRole("combobox", { name: "助手 Provider" })
    ).toHaveProperty("textContent", "alpha")
  })

  it("保存时提交 signature 与完整设置", async () => {
    renderCard()
    await screen.findByLabelText("助手系统提示词")

    await pickFrom("助手 Thinking 档位", "high")
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() =>
      expect(api.saveAiAssistantSettings).toHaveBeenCalledTimes(1)
    )
    expect(api.saveAiAssistantSettings.mock.calls[0][0]).toEqual({
      signature: SETTINGS_SIGNATURE,
      settings: {
        providerId: "alpha",
        modelId: "m1",
        thinkingLevel: "high",
        systemPrompt: "自定义提示词",
      },
      clearFields: [],
    })
  })

  it("提示词留空时改为清除该字段，回到默认提示词", async () => {
    renderCard()
    const textarea = await screen.findByLabelText("助手系统提示词")

    fireEvent.change(textarea, { target: { value: "   " } })
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() =>
      expect(api.saveAiAssistantSettings).toHaveBeenCalledTimes(1)
    )
    expect(api.saveAiAssistantSettings.mock.calls[0][0]).toEqual({
      signature: SETTINGS_SIGNATURE,
      settings: { providerId: "alpha", modelId: "m1", thinkingLevel: "medium" },
      clearFields: ["systemPrompt"],
    })
  })

  it("保存成功后只提示一次，并重新读取设置", async () => {
    renderCard()
    await screen.findByLabelText("助手系统提示词")

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1))
    expect(toastMock.error).not.toHaveBeenCalled()
    // 失效设置查询 → 触发一次重新读取（挂载时 1 次）。
    await waitFor(() =>
      expect(api.fetchAiAssistantSettings).toHaveBeenCalledTimes(2)
    )
  })

  it("409 冲突时持续显示冲突提示，且不提示成功", async () => {
    renderCard()
    await screen.findByLabelText("助手系统提示词")
    api.saveAiAssistantSettings.mockRejectedValueOnce(
      new ApiRequestError("请求失败（HTTP 409）：设置已被修改", 409, {
        message: "设置已被修改",
      })
    )

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }))

    expect(await screen.findByText(/配置已被其他程序修改（冲突）/)).toBeTruthy()
    expect(toastMock.success).not.toHaveBeenCalled()
    // 持续展示：提示仍在，且草稿没有被冲掉。
    expect(screen.getByText(/配置已被其他程序修改（冲突）/)).toBeTruthy()
    expect(screen.getByLabelText("助手系统提示词")).toHaveProperty(
      "value",
      "自定义提示词"
    )
  })

  it("模型目录读取失败时显示错误与重试，不伪装成可用", async () => {
    api.fetchPiModels.mockRejectedValue(new Error("读取失败"))
    renderCard()

    expect(await screen.findByText("读取模型目录失败")).toBeTruthy()
    expect(screen.getByRole("button", { name: /刷新模型列表/ })).toBeTruthy()
  })

  it("没有可用 Provider 时提示先去配置模型", async () => {
    api.fetchPiModels.mockResolvedValue({
      signature: "b".repeat(64),
      updatedAt: 1,
      providers: [],
    })
    renderCard()

    expect(await screen.findByText("Pi 还没有可用的 Provider")).toBeTruthy()
  })

  it("模型目录还在读取时显示加载状态，不冒充「无 Provider」，也不允许保存", async () => {
    api.fetchPiModels.mockReturnValue(new Promise(() => {}))
    renderCard()

    expect(await screen.findByText("正在读取模型目录…")).toBeTruthy()
    expect(screen.queryByText("Pi 还没有可用的 Provider")).toBeNull()
    expect(
      (screen.getByRole("button", { name: "保存设置" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it("409 后重新读取设置：用新 signature 保存，草稿仍保留", async () => {
    const firstSignature = "a".repeat(64)
    const secondSignature = "d".repeat(64)
    api.fetchAiAssistantSettings
      .mockReset()
      .mockResolvedValueOnce(settingsResponse({}, firstSignature))
      .mockResolvedValueOnce(settingsResponse({}, secondSignature))
    renderCard()
    const textarea = await screen.findByLabelText("助手系统提示词")
    fireEvent.change(textarea, { target: { value: "编辑中的草稿" } })

    api.saveAiAssistantSettings.mockRejectedValueOnce(
      new ApiRequestError("请求失败（HTTP 409）", 409, { message: "冲突" })
    )
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }))
    expect(await screen.findByText(/配置已被其他程序修改（冲突）/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "重新读取设置" }))
    // 重新读取是显式入口：不自动重试保存。
    await waitFor(() =>
      expect(api.fetchAiAssistantSettings).toHaveBeenCalledTimes(2)
    )
    expect(api.saveAiAssistantSettings).toHaveBeenCalledTimes(1)
    // 草稿没被刷新冲掉。
    expect(screen.getByLabelText("助手系统提示词")).toHaveProperty(
      "value",
      "编辑中的草稿"
    )

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }))
    await waitFor(() =>
      expect(api.saveAiAssistantSettings).toHaveBeenCalledTimes(2)
    )
    expect(api.saveAiAssistantSettings.mock.calls[1][0].signature).toBe(
      secondSignature
    )
    expect(api.saveAiAssistantSettings.mock.calls[1][0].settings).toMatchObject(
      { systemPrompt: "编辑中的草稿" }
    )
  })

  it("刷新后已选模型被删除：持续显示失效并禁止提交", async () => {
    api.fetchPiModels
      .mockReset()
      .mockResolvedValueOnce(modelsResponse)
      .mockResolvedValueOnce({
        signature: "b".repeat(64),
        updatedAt: 2,
        // alpha 只剩 m2：原先选定的 m1 已经不在目录里。
        providers: [
          {
            id: "alpha",
            hasApiKey: true,
            modelCount: 1,
            provider: {
              name: "Alpha",
              baseUrl: "https://alpha.test/v1",
              api: "openai-completions",
              models: [{ id: "m2" }],
            },
          },
        ],
      })
    renderCard()
    await screen.findByLabelText("助手系统提示词")

    fireEvent.click(screen.getByRole("button", { name: /刷新模型列表/ }))

    expect(await screen.findByText("当前选择已失效")).toBeTruthy()
    expect(screen.getByText(/所选模型已不在该 Provider 下/)).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "保存设置" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    // 不只靠按钮禁用：直接用表单提交也不能发出请求。
    fireEvent.submit(screen.getByRole("form", { name: "AI 助手设置" }))
    expect(api.saveAiAssistantSettings).not.toHaveBeenCalled()
  })

  it("刷新后已选 Provider 被删除：同样禁止提交", async () => {
    api.fetchPiModels
      .mockReset()
      .mockResolvedValueOnce(modelsResponse)
      .mockResolvedValueOnce({
        signature: "b".repeat(64),
        updatedAt: 2,
        providers: [modelsResponse.providers[1]],
      })
    renderCard()
    await screen.findByLabelText("助手系统提示词")

    fireEvent.click(screen.getByRole("button", { name: /刷新模型列表/ }))

    expect(
      await screen.findByText(/所选 Provider 已不在模型目录里/)
    ).toBeTruthy()
    fireEvent.submit(screen.getByRole("form", { name: "AI 助手设置" }))
    expect(api.saveAiAssistantSettings).not.toHaveBeenCalled()
  })
})
