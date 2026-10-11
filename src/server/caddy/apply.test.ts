import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PublicOperationError } from "@server/common/public-error"
import type {
  CaddyRule,
  CaddyRuleInput,
  TaskProgress,
} from "@shared/api-contract"
import {
  CADDY_MANAGED_END,
  CADDY_MANAGED_START,
  generateManagedRules,
  replaceManagedRegion,
} from "@shared/caddy-format"
import { afterEach, describe, expect, it } from "vitest"
import {
  applyCaddyRules,
  type CaddyApplyOptions,
  type CaddyCommandResult,
  type CaddyCommands,
  CaddyUnknownResultError,
} from "./apply"
import { type CaddyProbes, type CaddyTargets, readCaddyRules } from "./service"
import { CaddyStore } from "./store"

const tempDirs: string[] = []
const stores: CaddyStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

type Workspace = {
  dir: string
  filePath: string
  backupDir: string
  targets: CaddyTargets
  store: CaddyStore
}

/** 一律用临时目录与临时库，绝不碰真实配置、真实备份目录与 data/。 */
const makeWorkspace = async (options: {
  content: string
  fileMode?: number
}): Promise<Workspace> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mac-manager-caddy-apply-"))
  tempDirs.push(dir)
  const filePath = path.join(dir, "Caddyfile")
  await writeFile(
    filePath,
    options.content,
    options.fileMode === undefined
      ? "utf8"
      : { encoding: "utf8", mode: options.fileMode }
  )
  const store = new CaddyStore(path.join(dir, "caddy.sqlite3"))
  stores.push(store)
  return {
    dir,
    filePath,
    backupDir: path.join(dir, "backups"),
    targets: {
      configFile: filePath,
      binaryPath: path.join(dir, "caddy"),
      adminUrl: "http://127.0.0.1:2019",
      launchdLabel: "com.freewind.caddy",
    },
    store,
  }
}

const ruleInput = (
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

const makeProbes = (adminReachable = true): CaddyProbes => ({
  isProcessRunning: async () => true,
  readVersion: async () => "v2.11.4",
  isAdminReachable: async () => adminReachable,
})

/** 受控的 caddy 子命令与运行配置：测试里不执行任何真实命令。 */
type FakeIo = {
  commands: CaddyCommands
  validateCalls: () => number
  reloadCalls: () => number
  readRunningConfig: (adminUrl: string) => Promise<unknown>
  setRunningConfig: (value: unknown) => void
  setRunningError: (error: Error) => void
  setValidate: (result: CaddyCommandResult) => void
  setReload: (result: CaddyCommandResult) => void
}

const OK: CaddyCommandResult = { ok: true, timedOut: false, firstLine: "" }

const makeFakeIo = (runningConfig: unknown = null): FakeIo => {
  let running: unknown = runningConfig
  let runningError: Error | null = null
  let validate = OK
  let reload = OK
  let validateCount = 0
  let reloadCount = 0
  return {
    commands: {
      validate: async () => {
        validateCount += 1
        return validate
      },
      reload: async () => {
        reloadCount += 1
        return reload
      },
    },
    validateCalls: () => validateCount,
    reloadCalls: () => reloadCount,
    readRunningConfig: async () => {
      if (runningError !== null) throw runningError
      return running
    },
    setRunningConfig: (value) => {
      running = value
      runningError = null
    },
    setRunningError: (error) => {
      runningError = error
    },
    setValidate: (result) => {
      validate = result
    },
    setReload: (result) => {
      reload = result
    },
  }
}

/** 用与真实 /config/ 相同的嵌套形状承载规则，顺带验证递归收集。 */
const runningConfigFor = (rules: CaddyRule[]): unknown => ({
  apps: {
    http: {
      servers: {
        srv0: {
          listen: [":8443"],
          routes: rules.map((rule) => ({
            match: [
              rule.matchKind === "host"
                ? { host: [rule.host] }
                : { path: [rule.pathPrefix] },
            ],
            handle: [
              {
                handler: "reverse_proxy",
                upstreams: [{ dial: rule.upstream }],
              },
            ],
          })),
        },
      },
    },
  },
})

const apply = (
  workspace: Workspace,
  io: FakeIo,
  extra: Partial<CaddyApplyOptions> = {}
) =>
  applyCaddyRules({
    targets: workspace.targets,
    probes: makeProbes(),
    commands: io.commands,
    readRunningConfig: io.readRunningConfig,
    store: workspace.store,
    backupDir: workspace.backupDir,
    ...extra,
  })

const catchAsync = async (run: Promise<unknown>): Promise<unknown> => {
  try {
    await run
    return null
  } catch (error) {
    return error
  }
}

const errorStatus = (error: unknown): number | null =>
  error instanceof PublicOperationError ? error.status : null

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : ""

const listTempFiles = async (dir: string): Promise<string[]> =>
  (await readdir(dir)).filter((name) => name.endsWith(".tmp"))

/** 受管区域已存在、也没有别的规则：可以安全应用的基础配置。 */
const READY_FILE = `:8443 {
	${CADDY_MANAGED_START}
	${CADDY_MANAGED_END}
}
`

describe("Caddy 应用预检", () => {
  it.each([
    {
      name: "受管区域缺失",
      content: `:8443 {
	tls /Users/example/server.crt /Users/example/server.key
}
`,
      message: "现有配置尚未接管，应用会与手工规则重复",
    },
    {
      name: "有无法识别的行",
      content: `:8443 {
	${CADDY_MANAGED_START}
	${CADDY_MANAGED_END}
	encode gzip
}
`,
      message: "配置文件里有无法识别的行，应用可能覆盖手工配置",
    },
    {
      name: "还有未接管的规则",
      content: `:8443 {
	${CADDY_MANAGED_START}
	${CADDY_MANAGED_END}
	handle_path /external/* {
		reverse_proxy 127.0.0.1:15009
	}
}
`,
      message: "配置文件里还有尚未接管的规则",
    },
  ])("拒绝「$name」且不动文件与记录", async (item) => {
    const workspace = await makeWorkspace({ content: item.content })
    workspace.store.createRule(ruleInput())
    const io = makeFakeIo()

    const error = await catchAsync(apply(workspace, io))
    expect(errorStatus(error)).toBe(409)
    expect(errorMessage(error)).toBe(item.message)
    expect(await readFile(workspace.filePath, "utf8")).toBe(item.content)
    expect(workspace.store.listApplyRecords()).toEqual([])
    expect(io.validateCalls()).toBe(0)
    expect(io.reloadCalls()).toBe(0)
  })

  it("指纹不符时拒绝，不产生任何记录", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    workspace.store.createRule(ruleInput())
    const io = makeFakeIo()

    const error = await catchAsync(
      apply(workspace, io, { expectedSignature: "stale-signature" })
    )
    expect(errorStatus(error)).toBe(409)
    expect(errorMessage(error)).toBe("规则已被其他改动更新，请重新读取后再应用")
    expect(await readFile(workspace.filePath, "utf8")).toBe(READY_FILE)
    expect(workspace.store.listApplyRecords()).toEqual([])
    expect(io.validateCalls()).toBe(0)
  })

  it("管理接口不可达时拒绝，不尝试开启它", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    workspace.store.createRule(ruleInput())
    const io = makeFakeIo()

    const error = await catchAsync(
      applyCaddyRules({
        targets: workspace.targets,
        probes: makeProbes(false),
        commands: io.commands,
        readRunningConfig: io.readRunningConfig,
        store: workspace.store,
        backupDir: workspace.backupDir,
      })
    )
    expect(errorStatus(error)).toBe(409)
    expect(errorMessage(error)).toBe(
      "Caddy 管理接口未启用，无法平滑加载配置；请先完成接管"
    )
    expect(await readFile(workspace.filePath, "utf8")).toBe(READY_FILE)
    expect(workspace.store.listApplyRecords()).toEqual([])
    expect(io.validateCalls()).toBe(0)
  })
})

describe("Caddy 应用执行", () => {
  it("校验失败：400、文件未变、无记录、临时文件已删", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    workspace.store.createRule(ruleInput())
    const io = makeFakeIo()
    io.setValidate({
      ok: false,
      timedOut: false,
      firstLine: "Error: adapting config: unrecognized directive",
    })

    const error = await catchAsync(apply(workspace, io))
    expect(errorStatus(error)).toBe(400)
    expect(errorMessage(error)).toContain("配置校验未通过")
    expect(errorMessage(error)).toContain("unrecognized directive")
    expect(await readFile(workspace.filePath, "utf8")).toBe(READY_FILE)
    expect(workspace.store.listApplyRecords()).toEqual([])
    expect(await listTempFiles(workspace.dir)).toEqual([])
    expect(io.reloadCalls()).toBe(0)
  })

  it("备份失败：抛错且正式文件未变", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    workspace.store.createRule(ruleInput())
    const io = makeFakeIo()
    // 备份目录的位置被普通文件占住，mkdir 必定失败。
    const blocked = path.join(workspace.dir, "blocked")
    await writeFile(blocked, "not a directory", "utf8")

    const error = await catchAsync(apply(workspace, io, { backupDir: blocked }))
    expect(error).toBeInstanceOf(Error)
    expect(errorStatus(error)).toBeNull()
    expect(await readFile(workspace.filePath, "utf8")).toBe(READY_FILE)
    expect(workspace.store.listApplyRecords()).toEqual([])
    expect(io.reloadCalls()).toBe(0)
  })

  it("加载失败：还原文件、记 failed、不写 success", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    workspace.store.createRule(ruleInput())
    const io = makeFakeIo()
    io.setReload({
      ok: false,
      timedOut: false,
      firstLine: "Error: sending configuration to instance: connection refused",
    })

    const error = await catchAsync(apply(workspace, io))
    expect(errorStatus(error)).toBe(500)
    expect(errorMessage(error)).toContain("配置未生效，文件已还原")
    expect(await readFile(workspace.filePath, "utf8")).toBe(READY_FILE)
    const records = workspace.store.listApplyRecords()
    expect(records.map((record) => record.status)).toEqual(["failed"])
    const backups = await readdir(workspace.backupDir)
    expect(backups).toHaveLength(1)
    expect(
      await readFile(path.join(workspace.backupDir, backups[0]), "utf8")
    ).toBe(READY_FILE)
  })

  it("加载超时：结果未知、文件不还原、可被上层识别", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    workspace.store.createRule(ruleInput())
    const io = makeFakeIo()
    io.setReload({ ok: false, timedOut: true, firstLine: "" })

    const error = await catchAsync(apply(workspace, io))
    expect(error).toBeInstanceOf(CaddyUnknownResultError)
    expect((error as CaddyUnknownResultError).outcome.status).toBe("unknown")
    expect(await readFile(workspace.filePath, "utf8")).toContain("/alpha/*")
    expect(workspace.store.listApplyRecords().map((r) => r.status)).toEqual([
      "unknown",
    ])
  })

  it("核实不到规则：failed、verified false、runningFingerprint 为 null", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    const rule = workspace.store.createRule(ruleInput())
    const io = makeFakeIo(runningConfigFor([]))

    const outcome = await apply(workspace, io)
    expect(outcome.status).toBe("failed")
    expect(outcome.result.verified).toBe(false)
    expect(outcome.result.message).toContain("未核实到全部规则")
    expect(outcome.result.message).toContain(rule.upstream)
    const record = workspace.store.listApplyRecords()[0]
    expect(record?.status).toBe("failed")
    expect(record?.runningFingerprint).toBeNull()
  })

  it("核实请求失败：结果未知", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    workspace.store.createRule(ruleInput())
    const io = makeFakeIo()
    io.setRunningError(new Error("timeout"))

    const outcome = await apply(workspace, io)
    expect(outcome.status).toBe("unknown")
    expect(outcome.result.verified).toBe(false)
    expect(outcome.result.message).toContain("无法确认运行配置")
    const record = workspace.store.listApplyRecords()[0]
    expect(record?.status).toBe("unknown")
    expect(record?.runningFingerprint).toBeNull()
  })

  it("成功路径：success、备份是改动前原文、读回无未应用变更", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    const rule = workspace.store.createRule(ruleInput())
    const io = makeFakeIo(runningConfigFor([rule]))

    const outcome = await apply(workspace, io)
    expect(outcome.status).toBe("success")
    expect(outcome.result.verified).toBe(true)
    expect(outcome.result.ruleCount).toBe(1)
    expect(io.readRunningConfig).toBeDefined()
    const backups = await readdir(workspace.backupDir)
    expect(backups).toHaveLength(1)
    expect(outcome.result.backupFile).toBe(
      path.join(workspace.backupDir, backups[0])
    )
    expect(
      await readFile(path.join(workspace.backupDir, backups[0]), "utf8")
    ).toBe(READY_FILE)

    const reread = await readCaddyRules(
      workspace.targets,
      makeProbes(),
      workspace.store
    )
    expect(reread.hasUnappliedChanges).toBe(false)
    expect(reread.managedRegionDrifted).toBe(false)
    expect(reread.writable).toBe(true)
    expect(reread.externalRules).toEqual([])
  })

  it("原子写入：内容等于候选文本，权限位保持不变", async () => {
    const workspace = await makeWorkspace({
      content: READY_FILE,
      fileMode: 0o600,
    })
    const rule = workspace.store.createRule(ruleInput())
    const io = makeFakeIo(runningConfigFor([rule]))

    await apply(workspace, io)
    const expected = replaceManagedRegion(
      READY_FILE,
      generateManagedRules(workspace.store.listRules())
    ).text
    expect(await readFile(workspace.filePath, "utf8")).toBe(expected)
    expect(await readFile(workspace.filePath, "utf8")).toContain(
      "reverse_proxy 127.0.0.1:15001"
    )
    expect((await stat(workspace.filePath)).mode & 0o777).toBe(0o600)
    expect(await listTempFiles(workspace.dir)).toEqual([])
  })

  it("进度按真实阶段上报，总量为 5", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    const rule = workspace.store.createRule(ruleInput())
    const io = makeFakeIo(runningConfigFor([rule]))
    const progress: TaskProgress[] = []

    await apply(workspace, io, { report: (item) => progress.push(item) })
    expect(progress.map((item) => item.stage)).toEqual([
      "校验配置",
      "备份",
      "写入文件",
      "加载配置",
      "核实",
      "完成",
    ])
    expect(progress.map((item) => item.done)).toEqual([0, 1, 2, 3, 4, 5])
    expect(progress.every((item) => item.total === 5)).toBe(true)
  })

  it("失败路径也会报完最后一个阶段", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    workspace.store.createRule(ruleInput())
    const io = makeFakeIo()
    io.setReload({ ok: false, timedOut: false, firstLine: "Error: refused" })
    const progress: TaskProgress[] = []

    await catchAsync(
      apply(workspace, io, { report: (item) => progress.push(item) })
    )
    expect(progress.at(-1)).toMatchObject({ done: 5, total: 5, stage: "完成" })
  })

  it("备份超过 20 份时删除最旧的", async () => {
    const workspace = await makeWorkspace({ content: READY_FILE })
    const rule = workspace.store.createRule(ruleInput())
    const io = makeFakeIo(runningConfigFor([rule]))

    await mkdir(workspace.backupDir, { recursive: true })
    const oldNames = Array.from(
      { length: 21 },
      (_, index) => `2024010100${String(index).padStart(4, "0")}-Caddyfile`
    )
    for (const [index, name] of oldNames.entries()) {
      await writeFile(
        path.join(workspace.backupDir, name),
        `旧备份 ${index}`,
        "utf8"
      )
    }

    const outcome = await apply(workspace, io)
    const backups = (await readdir(workspace.backupDir)).sort()
    expect(backups).toHaveLength(20)
    expect(backups).not.toContain(oldNames[0])
    expect(backups).not.toContain(oldNames[1])
    expect(backups).toContain(oldNames[2])
    expect(backups).toContain(path.basename(outcome.result.backupFile ?? ""))
  })
})
