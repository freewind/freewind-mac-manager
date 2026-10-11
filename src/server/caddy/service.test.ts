import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PublicOperationError } from "@server/common/public-error"
import type { CaddyRuleInput } from "@shared/api-contract"
import {
  CADDY_MANAGED_END,
  CADDY_MANAGED_START,
  generateManagedRules,
  replaceManagedRegion,
} from "@shared/caddy-format"
import { afterEach, describe, expect, it } from "vitest"
import {
  type CaddyProbes,
  type CaddyTargets,
  createCaddyRule,
  deleteCaddyRule,
  importCaddyRulesFromFile,
  readCaddyRules,
  readCaddyStatus,
  updateCaddyRule,
} from "./service"
import { CADDY_APPLY_SUCCESS, CaddyStore } from "./store"

const tempDirs: string[] = []
const stores: CaddyStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

/** 每次都指向临时目录与临时数据库，绝不碰真实配置与 data/。 */
const makeWorkspace = async (
  content: string | null
): Promise<{ targets: CaddyTargets; store: CaddyStore; filePath: string }> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mac-manager-caddy-"))
  tempDirs.push(dir)
  const filePath = path.join(dir, "Caddyfile")
  if (content !== null) await writeFile(filePath, content, "utf8")
  const store = new CaddyStore(path.join(dir, "caddy.sqlite3"))
  stores.push(store)
  return {
    targets: {
      configFile: filePath,
      binaryPath: path.join(dir, "caddy"),
      adminUrl: "http://127.0.0.1:2019",
      launchdLabel: "com.freewind.caddy",
    },
    store,
    filePath,
  }
}

const makeProbes = (overrides: Partial<CaddyProbes> = {}): CaddyProbes => ({
  isProcessRunning: async () => true,
  readVersion: async () => "v2.11.4",
  isAdminReachable: async () => false,
  ...overrides,
})

const makeInput = (
  overrides: Partial<CaddyRuleInput> = {}
): CaddyRuleInput => ({
  name: "alpha 路径",
  note: "",
  matchKind: "path",
  host: null,
  pathPrefix: "/alpha/*",
  stripPrefix: true,
  upstream: "127.0.0.1:15001",
  enabled: true,
  ...overrides,
})

const catchError = (run: () => unknown): unknown => {
  try {
    run()
    return null
  } catch (error) {
    return error
  }
}

const errorStatus = (error: unknown): number | null =>
  error instanceof PublicOperationError ? error.status : null

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : ""

/** 受管区域已存在、没有外部规则与无法识别行：可以安全应用。 */
const READY_FILE = `:8443 {
	${CADDY_MANAGED_START}
	${CADDY_MANAGED_END}
}
`

const FILE_WITH_EXTERNAL = `:8443 {
	${CADDY_MANAGED_START}
	${CADDY_MANAGED_END}
	handle_path /external/* {
		reverse_proxy 127.0.0.1:15009
	}
}
`

const FILE_WITH_UNSUPPORTED = `:8443 {
	${CADDY_MANAGED_START}
	${CADDY_MANAGED_END}
	encode gzip
}
`

/** 脱敏的真实结构：8 条尚未接管的转发规则。 */
const FILE_WITH_EIGHT_EXTERNAL = `:8443 {
	tls /Users/example/.config/caddy/ca/server.crt /Users/example/.config/caddy/ca/server.key

	handle_path /alpha/* {
		reverse_proxy 127.0.0.1:15001
	}

	handle_path /alpha-dev/* {
		reverse_proxy 127.0.0.1:15002
	}

	handle_path /beta/* {
		reverse_proxy 127.0.0.1:15003
	}

	handle_path /gamma/* {
		reverse_proxy 127.0.0.1:15004
	}

	@alpha host alpha.example.com
	handle @alpha {
		reverse_proxy 127.0.0.1:15001
	}

	@alphadev host alpha-dev.example.com
	handle @alphadev {
		reverse_proxy 127.0.0.1:15002
	}

	@beta host beta.example.com
	handle @beta {
		reverse_proxy 127.0.0.1:15003
	}

	@gamma host gamma.example.com
	handle @gamma {
		reverse_proxy 127.0.0.1:15004
	}
}
`

describe("Caddy 只读服务", () => {
  it("配置文件不存在时抛错，不返回空配置", async () => {
    const { targets, store } = await makeWorkspace(null)
    await expect(readCaddyStatus(targets, makeProbes())).rejects.toThrow(
      "找不到 Caddy 配置文件"
    )
    await expect(readCaddyRules(targets, makeProbes(), store)).rejects.toThrow(
      "找不到 Caddy 配置文件"
    )
  })

  it("管理接口不可达只影响该字段，其余照常返回", async () => {
    const { targets } = await makeWorkspace(READY_FILE)
    const status = await readCaddyStatus(targets, makeProbes())
    expect(status).toEqual({
      processRunning: true,
      version: "v2.11.4",
      configFile: targets.configFile,
      binaryPath: targets.binaryPath,
      launchdLabel: "com.freewind.caddy",
      adminUrl: "http://127.0.0.1:2019",
      adminReachable: false,
      managedRegionPresent: true,
      readAt: expect.any(Number),
    })
  })

  it("进程探测失败或版本读不到时只降级对应字段", async () => {
    const { targets } = await makeWorkspace(READY_FILE)
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
    const { targets, store } = await makeWorkspace(FILE_WITH_UNSUPPORTED)
    const result = await readCaddyRules(targets, makeProbes(), store)
    expect(result.unsupportedLines).toBe(1)
    expect(result.unsupportedSamples).toEqual(["第 4 行：encode gzip"])
  })

  it("无法识别行超过 20 条时样本截断到 20 条", async () => {
    const body = Array.from(
      { length: 25 },
      (_, index) => `\tencode gzip${index}`
    )
    const { targets, store } = await makeWorkspace(
      `${[":8443 {", ...body, "}"].join("\n")}\n`
    )
    const result = await readCaddyRules(targets, makeProbes(), store)
    expect(result.unsupportedLines).toBe(25)
    expect(result.unsupportedSamples).toHaveLength(20)
    expect(result.unsupportedSamples[0]).toBe("第 2 行：encode gzip0")
  })
})

describe("Caddy 规则响应组装", () => {
  it("受管区域缺失时不可写，并提示尚未接管", async () => {
    const { targets, store } = await makeWorkspace(FILE_WITH_EIGHT_EXTERNAL)
    const result = await readCaddyRules(targets, makeProbes(), store)
    expect(result.writable).toBe(false)
    expect(result.blockedReason).toBe("现有配置尚未接管，应用会与手工规则重复")
    expect(result.externalRules).toHaveLength(8)
    expect(result.rules).toEqual([])
  })

  it("有无法识别的行时不可写，并说明原因", async () => {
    const { targets, store } = await makeWorkspace(FILE_WITH_UNSUPPORTED)
    const result = await readCaddyRules(targets, makeProbes(), store)
    expect(result.writable).toBe(false)
    expect(result.blockedReason).toBe(
      "配置文件里有无法识别的行，应用可能覆盖手工配置"
    )
  })

  it("还有未接管规则时不可写，并说明原因", async () => {
    const { targets, store } = await makeWorkspace(FILE_WITH_EXTERNAL)
    const result = await readCaddyRules(targets, makeProbes(), store)
    expect(result.writable).toBe(false)
    expect(result.blockedReason).toBe("配置文件里还有尚未接管的规则")
    expect(result.externalRules.map((rule) => rule.id)).toEqual([
      "path:/external/*",
    ])
  })

  it("受管区域干净时可写，并按数据库输出预览正文", async () => {
    const { targets, store } = await makeWorkspace(READY_FILE)
    const rule = createCaddyRule(makeInput(), store)
    const result = await readCaddyRules(targets, makeProbes(), store)
    expect(result.writable).toBe(true)
    expect(result.blockedReason).toBeNull()
    expect(result.rules.map((item) => item.id)).toEqual([rule.id])
    expect(result.externalRules).toEqual([])
    expect(result.previewText).toBe(generateManagedRules(store.listRules()))
    expect(result.previewText).toContain("handle_path /alpha/* {")
  })

  it("从未应用时所有规则都算新增", async () => {
    const { targets, store } = await makeWorkspace(READY_FILE)
    createCaddyRule(makeInput(), store)
    createCaddyRule(makeInput({ pathPrefix: "/beta/*" }), store)
    const result = await readCaddyRules(targets, makeProbes(), store)
    expect(result.appliedSignature).toBeNull()
    expect(result.appliedAt).toBeNull()
    expect(result.hasUnappliedChanges).toBe(true)
    expect(result.changes.added).toHaveLength(2)
    expect(result.changes.updated).toEqual([])
    expect(result.changes.removed).toEqual([])
    expect(result.changes.enabled).toEqual([])
    expect(result.changes.disabled).toEqual([])
  })

  it("有应用记录后按 id 比较出新增、修改、删除与启停", async () => {
    const { targets, store } = await makeWorkspace(READY_FILE)
    const alpha = createCaddyRule(makeInput(), store)
    const beta = createCaddyRule(
      makeInput({ pathPrefix: "/beta/*", name: "beta 路径" }),
      store
    )
    const gamma = createCaddyRule(
      makeInput({ pathPrefix: "/gamma/*", name: "gamma 路径" }),
      store
    )
    store.insertApplyRecord({
      id: "apply-1",
      appliedAt: 1000,
      status: CADDY_APPLY_SUCCESS,
      message: "已写入",
      rules: [alpha, beta, gamma],
      generatedText: generateManagedRules([alpha, beta, gamma]),
      configFingerprint: "fp",
      runningFingerprint: null,
    })

    updateCaddyRule(alpha.id, makeInput({ upstream: "127.0.0.1:15999" }), store)
    updateCaddyRule(
      beta.id,
      makeInput({ pathPrefix: "/beta/*", name: "beta 路径", enabled: false }),
      store
    )
    deleteCaddyRule(gamma.id, store)
    const delta = createCaddyRule(
      makeInput({ pathPrefix: "/delta/*", name: "delta 路径" }),
      store
    )

    const result = await readCaddyRules(targets, makeProbes(), store)
    expect(result.hasUnappliedChanges).toBe(true)
    expect(result.appliedAt).toBe(1000)
    expect(result.changes.added.map((rule) => rule.id)).toEqual([delta.id])
    expect(result.changes.updated).toHaveLength(1)
    expect(result.changes.updated[0].before.upstream).toBe("127.0.0.1:15001")
    expect(result.changes.updated[0].after.upstream).toBe("127.0.0.1:15999")
    expect(result.changes.removed.map((rule) => rule.id)).toEqual([gamma.id])
    expect(result.changes.disabled.map((rule) => rule.id)).toEqual([beta.id])
    expect(result.changes.enabled).toEqual([])
  })

  it("受管区域内容与数据库一致时不标记漂移", async () => {
    const { targets, store, filePath } = await makeWorkspace(READY_FILE)
    createCaddyRule(makeInput(), store)
    await writeFile(
      filePath,
      replaceManagedRegion(READY_FILE, generateManagedRules(store.listRules()))
        .text,
      "utf8"
    )
    const result = await readCaddyRules(targets, makeProbes(), store)
    expect(result.managedRegionDrifted).toBe(false)
  })

  it("手工改动受管区域内容后标记漂移", async () => {
    const { targets, store, filePath } = await makeWorkspace(READY_FILE)
    createCaddyRule(makeInput(), store)
    const drifted = replaceManagedRegion(
      READY_FILE,
      `\thandle_path /alpha/* {
\t\treverse_proxy 127.0.0.1:19999
\t}
`
    )
    await writeFile(filePath, drifted.text, "utf8")
    const result = await readCaddyRules(targets, makeProbes(), store)
    expect(result.managedRegionDrifted).toBe(true)
  })
})

describe("Caddy 规则写入与校验", () => {
  it("创建后能读回，非法入参给出中文原因", async () => {
    const { store } = await makeWorkspace(READY_FILE)
    const created = createCaddyRule(makeInput(), store)
    expect(store.findRule(created.id)?.pathPrefix).toBe("/alpha/*")

    const hostError = catchError(() =>
      createCaddyRule(
        makeInput({
          matchKind: "host",
          host: "bad host",
          pathPrefix: null,
          stripPrefix: false,
        }),
        store
      )
    )
    expect(errorStatus(hostError)).toBe(400)
    expect(errorMessage(hostError)).toContain("域名")

    const upstreamError = catchError(() =>
      createCaddyRule(
        makeInput({ pathPrefix: "/beta/*", upstream: "127.0.0.1:99999" }),
        store
      )
    )
    expect(errorStatus(upstreamError)).toBe(400)
    expect(errorMessage(upstreamError)).toContain("端口")

    const pathError = catchError(() =>
      createCaddyRule(makeInput({ pathPrefix: "beta/*" }), store)
    )
    expect(errorStatus(pathError)).toBe(400)
    expect(errorMessage(pathError)).toContain("路径必须以 / 开头")
  })

  it("matchKind 与字段不匹配时返回 400", async () => {
    const { store } = await makeWorkspace(READY_FILE)
    const hostWithoutDomain = catchError(() =>
      createCaddyRule(
        makeInput({ matchKind: "host", host: null, pathPrefix: null }),
        store
      )
    )
    expect(errorStatus(hostWithoutDomain)).toBe(400)
    expect(errorMessage(hostWithoutDomain)).toContain("host 匹配必须填写域名")

    const pathWithHost = catchError(() =>
      createCaddyRule(
        makeInput({ matchKind: "path", host: "alpha.example.com" }),
        store
      )
    )
    expect(errorStatus(pathWithHost)).toBe(400)
    expect(errorMessage(pathWithHost)).toContain("路径匹配不能同时填域名")
  })

  it("host 规则的 stripPrefix 一律按 false 存", async () => {
    const { store } = await makeWorkspace(READY_FILE)
    const created = createCaddyRule(
      makeInput({
        matchKind: "host",
        host: "alpha.example.com",
        pathPrefix: null,
        stripPrefix: true,
      }),
      store
    )
    expect(created.stripPrefix).toBe(false)
  })

  it("重复匹配条件返回 409", async () => {
    const { store } = await makeWorkspace(READY_FILE)
    createCaddyRule(makeInput(), store)
    const duplicate = catchError(() =>
      createCaddyRule(makeInput({ name: "重复路径" }), store)
    )
    expect(errorStatus(duplicate)).toBe(409)
    expect(errorMessage(duplicate)).toContain("同样的匹配条件")
  })

  it("路径前缀重叠返回 409 并指出重叠对象", async () => {
    const { store } = await makeWorkspace(READY_FILE)
    createCaddyRule(
      makeInput({ pathPrefix: "/alpha", name: "alpha 目录" }),
      store
    )
    const overlapped = catchError(() =>
      createCaddyRule(makeInput({ pathPrefix: "/alpha/sub/*" }), store)
    )
    expect(errorStatus(overlapped)).toBe(409)
    expect(errorMessage(overlapped)).toContain("alpha 目录")
  })

  it("更新成与自己相同的匹配条件不报冲突", async () => {
    const { store } = await makeWorkspace(READY_FILE)
    const created = createCaddyRule(makeInput(), store)
    const updated = updateCaddyRule(
      created.id,
      makeInput({ name: "改名后", upstream: "127.0.0.1:15002" }),
      store
    )
    expect(updated.name).toBe("改名后")
    expect(updated.upstream).toBe("127.0.0.1:15002")
  })

  it("更新或删除不存在的 id 返回 404，删除成功返回空", async () => {
    const { store } = await makeWorkspace(READY_FILE)
    const missingUpdate = catchError(() =>
      updateCaddyRule("missing", makeInput(), store)
    )
    expect(errorStatus(missingUpdate)).toBe(404)

    const missingDelete = catchError(() => deleteCaddyRule("missing", store))
    expect(errorStatus(missingDelete)).toBe(404)

    const created = createCaddyRule(makeInput(), store)
    expect(catchError(() => deleteCaddyRule(created.id, store))).toBeNull()
    expect(store.listRules()).toEqual([])
  })
})

describe("Caddy 规则导入", () => {
  it("首次导入 8 条外部规则，再导入全部跳过且不改文件", async () => {
    const { targets, store, filePath } = await makeWorkspace(
      FILE_WITH_EIGHT_EXTERNAL
    )
    const before = await readFile(filePath, "utf8")

    expect(await importCaddyRulesFromFile(targets, store)).toEqual({
      imported: 8,
      skipped: 0,
    })
    expect(store.listRules()).toHaveLength(8)
    expect(store.listRules().map((rule) => rule.sortOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ])
    expect(store.listRules()[0]?.name).toBe("/alpha/*")
    expect(store.listRules()[7]?.name).toBe("gamma.example.com")

    expect(await importCaddyRulesFromFile(targets, store)).toEqual({
      imported: 0,
      skipped: 8,
    })
    expect(await readFile(filePath, "utf8")).toBe(before)
  })

  it("导入前同样校验字段，非法规则报 400 且不入库", async () => {
    const { targets, store } = await makeWorkspace(`:8443 {
	@bad host bad_host
	handle @bad {
		reverse_proxy 127.0.0.1:15001
	}
}
`)
    await expect(importCaddyRulesFromFile(targets, store)).rejects.toThrow(
      "第 3 行的规则无法导入"
    )
    expect(store.listRules()).toEqual([])
  })
})
