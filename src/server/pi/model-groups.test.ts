import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let directory = ""
let groupsFile = ""
let modelsFile = ""

const provider = (id: string) => ({
  name: id,
  baseUrl: "https://example.test/v1",
  api: "openai-completions",
  apiKey: "secret-value",
  models: [
    { id: "model-a", name: "A", contextWindow: 1000, maxTokens: 100 },
    { id: "model-b", name: "B", contextWindow: 1000, maxTokens: 100 },
  ],
})

const loadGroups = async () => {
  vi.resetModules()
  process.env.PI_CODING_AGENT_DIR = directory
  return import("./model-groups")
}

const signatureOf = async (mod: Awaited<ReturnType<typeof loadGroups>>) =>
  (await mod.listPiModelGroups()).signature

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-groups-test-"))
  groupsFile = path.join(directory, "model-groups.json")
  modelsFile = path.join(directory, "models.json")
  await fs.writeFile(
    modelsFile,
    JSON.stringify({
      providers: { alpha: provider("alpha"), beta: provider("beta") },
    }),
    { mode: 0o600 }
  )
  await fs.writeFile(
    groupsFile,
    JSON.stringify({
      existing: {
        name: "Existing",
        members: [{ provider: "alpha", modelId: "model-a" }],
      },
    }),
    { mode: 0o600 }
  )
})

afterEach(async () => {
  delete process.env.PI_CODING_AGENT_DIR
  await fs.rm(directory, { recursive: true, force: true })
})

const groupInput = (overrides: Record<string, unknown> = {}) => ({
  name: "New",
  members: [
    { provider: "alpha", modelId: "model-a" },
    { provider: "beta", modelId: "model-b" },
  ],
  ...overrides,
})

describe("Pi model groups", () => {
  it("lists groups with signature", async () => {
    const mod = await loadGroups()
    const result = await mod.listPiModelGroups()
    expect(result.groups).toMatchInlineSnapshot(`
      [
        {
          "group": {
            "members": [
              {
                "modelId": "model-a",
                "provider": "alpha",
              },
            ],
            "name": "Existing",
          },
          "id": "existing",
        },
      ]
    `)
    expect(result.signature).toHaveLength(64)
  })

  it("adds a group and persists it", async () => {
    const mod = await loadGroups()
    const signature = await signatureOf(mod)
    const result = await mod.addPiModelGroup({
      groupId: "g-new",
      signature,
      group: groupInput({ contextWindow: 256000, maxTokens: 131072 }),
    })
    expect(result).toEqual({ groupId: "g-new" })
    const raw = JSON.parse(await fs.readFile(groupsFile, "utf8"))
    expect(raw["g-new"]).toMatchInlineSnapshot(`
      {
        "contextWindow": 256000,
        "maxTokens": 131072,
        "members": [
          {
            "modelId": "model-a",
            "provider": "alpha",
          },
          {
            "modelId": "model-b",
            "provider": "beta",
          },
        ],
        "name": "New",
      }
    `)
    expect(raw.existing).toBeDefined()
  })

  it("rejects add when group already exists", async () => {
    const mod = await loadGroups()
    const signature = await signatureOf(mod)
    await expect(
      mod.addPiModelGroup({
        groupId: "existing",
        signature,
        group: groupInput(),
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it("rejects add when a member does not exist in models.json", async () => {
    const mod = await loadGroups()
    const signature = await signatureOf(mod)
    await expect(
      mod.addPiModelGroup({
        groupId: "g-bad",
        signature,
        group: groupInput({
          members: [{ provider: "alpha", modelId: "nope" }],
        }),
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it("rejects add when members are duplicated", async () => {
    const mod = await loadGroups()
    const signature = await signatureOf(mod)
    await expect(
      mod.addPiModelGroup({
        groupId: "g-dup",
        signature,
        group: groupInput({
          members: [
            { provider: "alpha", modelId: "model-a" },
            { provider: "alpha", modelId: "model-a" },
          ],
        }),
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it("rejects invalid group id", async () => {
    const mod = await loadGroups()
    const signature = await signatureOf(mod)
    await expect(
      mod.addPiModelGroup({
        groupId: "bad id!",
        signature,
        group: groupInput(),
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it("rejects add with stale signature", async () => {
    const mod = await loadGroups()
    await expect(
      mod.addPiModelGroup({
        groupId: "g-stale",
        signature: "0".repeat(64),
        group: groupInput(),
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it("replaces an existing group", async () => {
    const mod = await loadGroups()
    const signature = await signatureOf(mod)
    const result = await mod.replacePiModelGroup("existing", {
      signature,
      group: groupInput({ name: "Renamed" }),
    })
    expect(result).toEqual({ groupId: "existing" })
    const raw = JSON.parse(await fs.readFile(groupsFile, "utf8"))
    expect(raw.existing.name).toBe("Renamed")
  })

  it("rejects replace of missing group", async () => {
    const mod = await loadGroups()
    const signature = await signatureOf(mod)
    await expect(
      mod.replacePiModelGroup("missing", { signature, group: groupInput() })
    ).rejects.toMatchObject({ status: 404 })
  })

  it("deletes a group", async () => {
    const mod = await loadGroups()
    const signature = await signatureOf(mod)
    await mod.deletePiModelGroup("existing", { signature })
    const raw = JSON.parse(await fs.readFile(groupsFile, "utf8"))
    expect(raw.existing).toBeUndefined()
  })

  it("rejects delete with stale signature", async () => {
    const mod = await loadGroups()
    await expect(
      mod.deletePiModelGroup("existing", { signature: "0".repeat(64) })
    ).rejects.toMatchObject({ status: 409 })
  })

  it("rejects delete of missing group", async () => {
    const mod = await loadGroups()
    const signature = await signatureOf(mod)
    await expect(
      mod.deletePiModelGroup("missing", { signature })
    ).rejects.toMatchObject({ status: 404 })
  })

  it("creates the file when it does not exist yet", async () => {
    await fs.rm(groupsFile)
    const mod = await loadGroups()
    const result = await mod.listPiModelGroups()
    expect(result.groups).toEqual([])
    const signature = result.signature
    await mod.addPiModelGroup({
      groupId: "g-first",
      signature,
      group: groupInput(),
    })
    const raw = JSON.parse(await fs.readFile(groupsFile, "utf8"))
    expect(raw["g-first"].name).toBe("New")
  })

  it("refuses to read a symlinked groups file", async () => {
    await fs.rm(groupsFile)
    const target = path.join(directory, "target.json")
    await fs.writeFile(target, "{}")
    await fs.symlink(target, groupsFile)
    const mod = await loadGroups()
    await expect(mod.listPiModelGroups()).rejects.toMatchObject({
      status: 403,
    })
  })
})
