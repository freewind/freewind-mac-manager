import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  type CaddyProbes,
  type CaddyTargets,
  readCaddyRules,
  readCaddyStatus,
} from "./service"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

/** 每次都指向临时目录，绝不读写 ~/.config/caddy 下的真实文件。 */
const makeTargets = async (content: string | null): Promise<CaddyTargets> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mac-manager-caddy-"))
  tempDirs.push(dir)
  const configFile = path.join(dir, "Caddyfile")
  if (content !== null) await writeFile(configFile, content, "utf8")
  return {
    configFile,
    binaryPath: path.join(dir, "caddy"),
    adminUrl: "http://127.0.0.1:2019",
    launchdLabel: "com.freewind.caddy",
  }
}

const makeProbes = (overrides: Partial<CaddyProbes> = {}): CaddyProbes => ({
  isProcessRunning: async () => true,
  readVersion: async () => "v2.11.4",
  isAdminReachable: async () => false,
  ...overrides,
})

const ONE_RULE = `:8443 {
	handle_path /alpha/* {
		reverse_proxy 127.0.0.1:15001
	}
}
`

describe("Caddy 只读服务", () => {
  it("配置文件不存在时抛错，不返回空配置", async () => {
    const targets = await makeTargets(null)
    await expect(readCaddyStatus(targets, makeProbes())).rejects.toThrow(
      "找不到 Caddy 配置文件"
    )
    await expect(readCaddyRules(targets, makeProbes())).rejects.toThrow(
      "找不到 Caddy 配置文件"
    )
  })

  it("管理接口不可达只影响该字段，其余照常返回", async () => {
    const targets = await makeTargets(ONE_RULE)
    const status = await readCaddyStatus(targets, makeProbes())
    expect(status).toEqual({
      processRunning: true,
      version: "v2.11.4",
      configFile: targets.configFile,
      binaryPath: targets.binaryPath,
      launchdLabel: "com.freewind.caddy",
      adminUrl: "http://127.0.0.1:2019",
      adminReachable: false,
      managedRegionPresent: false,
      readAt: expect.any(Number),
    })
  })

  it("进程探测失败或版本读不到时只降级对应字段", async () => {
    const targets = await makeTargets(ONE_RULE)
    const status = await readCaddyStatus(
      targets,
      makeProbes({
        isProcessRunning: async () => false,
        readVersion: async () => null,
      })
    )
    expect(status.processRunning).toBe(false)
    expect(status.version).toBeNull()
    expect(status.adminReachable).toBe(false)
  })

  it("无法识别的行计入数量与原文样本", async () => {
    const targets = await makeTargets(`:8443 {
	encode gzip
	handle_path /alpha/* {
		reverse_proxy 127.0.0.1:15001
	}
}
`)
    const result = await readCaddyRules(targets, makeProbes())
    expect(result.rules).toHaveLength(1)
    expect(result.unsupportedLines).toBe(1)
    expect(result.unsupportedSamples).toEqual(["第 2 行：encode gzip"])
  })

  it("无法识别行超过 20 条时样本截断到 20 条", async () => {
    const body = Array.from(
      { length: 25 },
      (_, index) => `\tencode gzip${index}`
    )
    const targets = await makeTargets(
      `${[":8443 {", ...body, "}"].join("\n")}\n`
    )
    const result = await readCaddyRules(targets, makeProbes())
    expect(result.unsupportedLines).toBe(25)
    expect(result.unsupportedSamples).toHaveLength(20)
    expect(result.unsupportedSamples[0]).toBe("第 2 行：encode gzip0")
  })

  it("托管标记成对出现时 managedRegionPresent 为 true", async () => {
    const targets = await makeTargets(`:8443 {
	# mac-manager:rules:start
	handle_path /alpha/* {
		reverse_proxy 127.0.0.1:15001
	}
	# mac-manager:rules:end
}
`)
    const status = await readCaddyStatus(targets, makeProbes())
    expect(status.managedRegionPresent).toBe(true)
    const result = await readCaddyRules(targets, makeProbes())
    expect(result.rules.map((rule) => rule.origin)).toEqual(["managed"])
  })
})
