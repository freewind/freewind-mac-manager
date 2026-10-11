import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let directory = ""
let configFile = ""

const provider = {
  name: "test",
  baseUrl: "https://example.test/v1",
  api: "openai-completions",
  apiKey: "secret-value",
  models: [{ id: "one", name: "One", contextWindow: 1000, maxTokens: 100 }],
}

const loadConfig = async () => {
  vi.resetModules()
  process.env.PI_CODING_AGENT_DIR = directory
  return import("./config")
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-models-test-"))
  configFile = path.join(directory, "models.json")
  await fs.writeFile(
    configFile,
    JSON.stringify({ retainedRoot: true, providers: { initial: provider } }),
    { mode: 0o600 }
  )
  await fs.writeFile(path.join(directory, "settings.json"), "{}")
})

afterEach(async () => {
  delete process.env.PI_CODING_AGENT_DIR
  await fs.rm(directory, { recursive: true, force: true })
})

describe("Pi model configuration", () => {
  it("redacts keys and preserves unknown root and provider fields", async () => {
    const api = await loadConfig()
    const listed = await api.listPiModels()
    expect(JSON.stringify(listed)).not.toContain("secret-value")
    expect(listed.providers[0].hasApiKey).toBe(true)
    await api.updatePiProvider("initial", {
      providerId: "initial",
      signature: listed.signature,
      provider: {
        ...listed.providers[0].provider,
        apiKey: "••••••",
        models: [
          { ...listed.providers[0].provider.models[0], id: "two" },
          { id: "three" },
        ],
      },
    })
    const stored = JSON.parse(await fs.readFile(configFile, "utf8"))
    expect(stored.retainedRoot).toBe(true)
    expect(stored.providers.initial.apiKey).toBe("secret-value")
    expect(stored.providers.initial.models).toHaveLength(2)
  })

  it("rejects stale signatures without changing the file", async () => {
    const api = await loadConfig()
    const listed = await api.listPiModels()
    await fs.appendFile(configFile, " ")
    await expect(
      api.deletePiProvider("initial", { signature: listed.signature })
    ).rejects.toThrow("其他程序修改")
  })

  it("refuses deleting the current default provider", async () => {
    await fs.writeFile(
      path.join(directory, "settings.json"),
      JSON.stringify({ defaultProvider: "initial", defaultModel: "one" })
    )
    const api = await loadConfig()
    const listed = await api.listPiModels()
    await expect(
      api.deletePiProvider("initial", { signature: listed.signature })
    ).rejects.toThrow("默认项")
  })

  it("refuses symlinked models.json", async () => {
    await fs.rename(configFile, `${configFile}.real`)
    await fs.symlink(`${configFile}.real`, configFile)
    const api = await loadConfig()
    await expect(api.listPiModels()).rejects.toThrow("非普通")
  })

  it("rejects malformed JSON without overwriting it", async () => {
    await fs.writeFile(configFile, "{")
    const api = await loadConfig()
    await expect(api.listPiModels()).rejects.toThrow("合法 JSON")
    expect(await fs.readFile(configFile, "utf8")).toBe("{")
  })
})
