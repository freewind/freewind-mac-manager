import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let directory = ""
let dbFile = ""

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "ai-assistant-test-"))
  dbFile = path.join(directory, "test.sqlite3")
  process.env.MAC_MANAGER_DB_FILE = dbFile
  vi.resetModules()
})

afterEach(() => {
  delete process.env.MAC_MANAGER_DB_FILE
  rmSync(directory, { recursive: true, force: true })
})

const loadConfig = async () => import("./config")

describe("AI 助手设置存储", () => {
  it("首次读取返回默认 systemPrompt 非空", async () => {
    const config = await loadConfig()
    const response = config.getAiAssistantSettings()
    expect(response.defaults.systemPrompt.length).toBeGreaterThan(0)
    expect(response.defaults.systemPrompt).toContain("freewind-mac-manager")
    expect(response.defaults.enabledTools).toEqual([
      "read",
      "bash",
      "write",
      "edit",
      "grep",
      "ls",
    ])
    expect(response.settings).toEqual({})
    expect(response.signature).toHaveLength(64)
  })

  it("保存后 signature 更新且能读回", async () => {
    const config = await loadConfig()
    const initial = config.getAiAssistantSettings()
    const saved = config.saveAiAssistantSettings({
      signature: initial.signature,
      settings: {
        providerId: "pi",
        modelId: "cn:glm-5.3",
        thinkingLevel: "medium",
        systemPrompt: "测试提示词",
        enabledTools: ["read"],
      },
    })
    expect(saved.signature).not.toBe(initial.signature)
    expect(saved.signature).toHaveLength(64)
    const reread = config.getAiAssistantSettings()
    expect(reread.signature).toBe(saved.signature)
    expect(reread.settings).toMatchObject({
      providerId: "pi",
      modelId: "cn:glm-5.3",
      thinkingLevel: "medium",
      systemPrompt: "测试提示词",
      enabledTools: ["read"],
    })
  })

  it("过期 signature 写入被拒绝且内容不变", async () => {
    const config = await loadConfig()
    const initial = config.getAiAssistantSettings()
    config.saveAiAssistantSettings({
      signature: initial.signature,
      settings: { systemPrompt: "第一次写入" },
    })
    expect(() =>
      config.saveAiAssistantSettings({
        signature: initial.signature,
        settings: { systemPrompt: "过期的写入" },
      })
    ).toThrow("其他程序修改")
    const unchanged = config.getAiAssistantSettings()
    expect(unchanged.settings.systemPrompt).toBe("第一次写入")
  })

  it("clearFields 清除字段且读改往返一致", async () => {
    const config = await loadConfig()
    const initial = config.getAiAssistantSettings()
    const saved = config.saveAiAssistantSettings({
      signature: initial.signature,
      settings: { providerId: "pi", systemPrompt: "保留内容" },
    })
    const cleared = config.saveAiAssistantSettings({
      signature: saved.signature,
      settings: {},
      clearFields: ["providerId"],
    })
    expect(cleared.settings.providerId).toBeUndefined()
    expect(cleared.settings.systemPrompt).toBe("保留内容")
    const reread = config.getAiAssistantSettings()
    expect(reread.settings).toEqual(cleared.settings)
    expect(reread.signature).toBe(cleared.signature)
  })

  it("providerId 为空白时被拒绝", async () => {
    const config = await loadConfig()
    const initial = config.getAiAssistantSettings()
    expect(() =>
      config.saveAiAssistantSettings({
        signature: initial.signature,
        settings: { providerId: "   " },
      })
    ).toThrow("不能为空白")
  })
})
