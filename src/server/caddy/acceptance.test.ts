import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { publicSystemError } from "@server/common/public-error"
import { toTaskHttpResponse } from "@server/common/tasks/response"
import { TaskRunner } from "@server/common/tasks/runner"
import { TaskStore } from "@server/common/tasks/store"
import { createInlineHost } from "@server/common/tasks/worker-host"
import type {
  CaddyApplyResult,
  CaddyRule,
  CaddyRuleInput,
  TaskProgress,
} from "@shared/api-contract"
import { CaddyApplyResultSchema } from "@shared/api-contract/schemas/caddy"
import {
  CADDY_MANAGED_END,
  CADDY_MANAGED_START,
  caddyRulesSignature,
  generateManagedRules,
  type ParsedCaddyRule,
  parseCaddyfile,
  replaceManagedRegion,
} from "@shared/caddy-format"
import { caddyConfigTaskTarget } from "@shared/task-targets"
import { afterEach, describe, expect, it } from "vitest"
import type { CaddyCommandResult, CaddyCommands } from "./apply"
import {
  assertCaddyApplyReady,
  type CaddyProbes,
  type CaddyTargets,
  createCaddyRule,
  deleteCaddyRule,
  importCaddyRulesFromFile,
  readCaddyConfigText,
  readCaddyRules,
  updateCaddyRule,
} from "./service"
import { CaddyStore } from "./store"
import {
  CADDY_APPLY_KIND,
  type CaddyApplyDeps,
  type CaddyApplyTaskOutcome,
  runCaddyApplyTask,
} from "./task"

/**
 * Caddy 域的整体验收：把验收标准逐条变成可复现的自动化证据。
 *
 * 全部用临时目录、临时 SQLite 与受控替身：不读写 ~/.config/caddy，
 * 不真跑 caddy validate / reload，不启停 Caddy，也不连管理接口。
 */

const tempDirs: string[] = []
const stores: CaddyStore[] = []
const taskStores: TaskStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const store of taskStores.splice(0)) store.close()
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex")

/** 脱敏的真实结构：全局选项块 + :8443 站点块 + tls + 4 条路径 + 4 组域名规则。 */
const GLOBAL_BLOCK = [
  "{",
  "\tadmin off",
  "\tauto_https disable_redirects",
  "\temail admin@example.com",
  "\tservers {",
  "\t\t# frp 只转发 TCP，UDP 到不了本机；若继续广播 Alt-Svc h3，浏览器会把请求",
  "\t\t# 切到 QUIC（UDP）而卡死/报网络错误，故只开 h1/h2。",
  "\t\tprotocols h1 h2",
  "\t}",
  "}",
  "",
]

const SITE_HEAD = [
  "# 单一 HTTPS 网关：只监听本机 8443，由 frp 的 34085 端口透传进来。",
  "# 使用自签私有 CA 证书；手机安装并信任根证书后即可访问。",
  ":8443 {",
  "\ttls /Users/example/.config/caddy/ca/server.crt /Users/example/.config/caddy/ca/server.key",
  "",
  "\t# 按 URL 路径剥离前缀后转发到对应应用。",
]

const RULE_LINES = [
  "\thandle_path /alpha/* {",
  "\t\treverse_proxy 127.0.0.1:15001",
  "\t}",
  "",
  "\thandle_path /alpha-dev/* {",
  "\t\treverse_proxy 127.0.0.1:15002",
  "\t}",
  "",
  "\thandle_path /beta/* {",
  "\t\treverse_proxy 127.0.0.1:15003",
  "\t}",
  "",
  "\thandle_path /gamma/* {",
  "\t\treverse_proxy 127.0.0.1:15004",
  "\t}",
  "",
  "\t@alpha host alpha.example.com",
  "\thandle @alpha {",
  "\t\treverse_proxy 127.0.0.1:15001",
  "\t}",
  "",
  "\t@alphadev host alpha-dev.example.com",
  "\thandle @alphadev {",
  "\t\treverse_proxy 127.0.0.1:15002",
  "\t}",
  "",
  "\t@beta host beta.example.com",
  "\thandle @beta {",
  "\t\treverse_proxy 127.0.0.1:15003",
  "\t}",
  "",
  "\t@gamma host gamma.example.com",
  "\thandle @gamma {",
  "\t\treverse_proxy 127.0.0.1:15004",
  "\t}",
]

const SITE_TAIL = ["}", ""]

/** managed 为 true 时就是「手工把现有规则包进成对标记」之后的文件。 */
const buildFile = (managed: boolean): string =>
  [
    ...GLOBAL_BLOCK,
    ...SITE_HEAD,
    ...(managed ? [`\t${CADDY_MANAGED_START}`, ""] : []),
    ...RULE_LINES,
    ...(managed ? ["", `\t${CADDY_MANAGED_END}`] : []),
    ...SITE_TAIL,
  ].join("\n")

/** 受管区域已存在但没有规则、外面还有一条未接管的规则。 */
const buildExternalFile = (): string =>
  [
    ":8443 {",
    `\t${CADDY_MANAGED_START}`,
    `\t${CADDY_MANAGED_END}`,
    "\thandle_path /extra/* {",
    "\t\treverse_proxy 127.0.0.1:15009",
    "\t}",
    "}",
    "",
  ].join("\n")

const semanticsOf = (rules: ParsedCaddyRule[]) =>
  rules.map((rule) => [
    rule.matchKind,
    rule.host,
    rule.pathPrefix,
    rule.stripPrefix,
    rule.upstream,
  ])

/** 标记区间之外的行，用于「除标记区间外逐字节不变」的比对。 */
const outsideRegion = (text: string): string[] => {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => line.trim() === CADDY_MANAGED_START)
  const end = lines.findIndex((line) => line.trim() === CADDY_MANAGED_END)
  return [...lines.slice(0, start), ...lines.slice(end + 1)]
}

type Workspace = {
  dir: string
  filePath: string
  backupDir: string
  targets: CaddyTargets
  store: CaddyStore
}

const makeWorkspace = async (content: string): Promise<Workspace> => {
  const dir = await makeTempDir("mac-manager-caddy-acceptance-")
  const filePath = path.join(dir, "Caddyfile")
  await writeFile(filePath, content, "utf8")
  const store = new CaddyStore(path.join(dir, "caddy.sqlite3"))
  stores.push(store)
  // 备份目录放在配置目录之外：这样「配置目录不可写」才只影响写文件这一步。
  const backupDir = path.join(
    await makeTempDir("mac-manager-caddy-acceptance-backups-"),
    "backups"
  )
  return {
    dir,
    filePath,
    backupDir,
    targets: {
      configFile: filePath,
      binaryPath: path.join(dir, "caddy"),
      adminUrl: "http://127.0.0.1:2019",
      launchdLabel: "com.freewind.caddy",
    },
    store,
  }
}

const OK: CaddyCommandResult = { ok: true, timedOut: false, firstLine: "" }

/** 按当前数据库规则生成运行配置，模拟 caddy adapt 之后的 /config/ 结构。 */
const runningConfigFor = (rules: CaddyRule[]): unknown => ({
  apps: {
    http: {
      servers: {
        srv0: {
          routes: rules
            .filter((rule) => rule.enabled)
            .map((rule) => ({
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

/** 受控的外部命令与运行配置；测试里没有任何真实子进程或网络请求。 */
type FakeIo = {
  commands: CaddyCommands
  probes: () => CaddyProbes
  readRunningConfig: () => Promise<unknown>
  setValidate: (result: CaddyCommandResult) => void
  setReload: (result: CaddyCommandResult) => void
  setRunningConfig: (value: unknown) => void
  setRunningError: (error: Error) => void
  setAdminReachable: (reachable: boolean) => void
}

const makeFakeIo = (workspace: Workspace): FakeIo => {
  let validate = OK
  let reload = OK
  let running: unknown = null
  let runningError: Error | null = null
  let adminReachable = true
  return {
    commands: {
      validate: async () => validate,
      reload: async () => reload,
    },
    probes: () => ({
      isProcessRunning: async () => true,
      readVersion: async () => "v2.11.4",
      isAdminReachable: async () => adminReachable,
    }),
    // 未显式设置过就按当前数据库规则生成：核实阶段永远能"真的"读到规则。
    readRunningConfig: async () => {
      if (runningError !== null) throw runningError
      return running ?? runningConfigFor(workspace.store.listRules())
    },
    setValidate: (result) => {
      validate = result
    },
    setReload: (result) => {
      reload = result
    },
    setRunningConfig: (value) => {
      running = value
      runningError = null
    },
    setRunningError: (error) => {
      runningError = error
    },
    setAdminReachable: (reachable) => {
      adminReachable = reachable
    },
  }
}

const depsOf = (workspace: Workspace, io: FakeIo): CaddyApplyDeps => ({
  targets: workspace.targets,
  probes: io.probes(),
  commands: io.commands,
  readRunningConfig: io.readRunningConfig,
  store: workspace.store,
  backupDir: workspace.backupDir,
})

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

const signatureOf = (workspace: Workspace): string =>
  caddyRulesSignature(workspace.store.listRules())

/** 预检被拒时的 HTTP 语义：与 handler 用同一个错误映射。 */
const rejectionOf = async (
  workspace: Workspace,
  expectedSignature?: string
): Promise<{ status: number; body: { message: string } }> => {
  try {
    await assertCaddyApplyReady(
      workspace.targets,
      makeFakeIo(workspace).probes(),
      workspace.store,
      expectedSignature
    )
    throw new Error("预期被拒绝，但检查通过了")
  } catch (error) {
    return publicSystemError(error)
  }
}

/** 把一个预期会失败的动作转成 handler 用的 HTTP 错误语义。 */
const failureOf = async (
  run: () => Promise<unknown>
): Promise<{ status: number; body: { message: string } }> => {
  try {
    await run()
    throw new Error("预期被拒绍，但检查通过了")
  } catch (error) {
    return publicSystemError(error)
  }
}

const noProgress = (_progress: TaskProgress): void => undefined

/** 与 src/server/tasks/executors.ts 里 Caddy 条目的映射保持一致。 */
const toHostOutcome = (outcome: CaddyApplyTaskOutcome) => {
  if (outcome.status === "unknown") {
    return {
      result: outcome.result,
      message: outcome.message,
      error: outcome.error,
      status: "unknown" as const,
    }
  }
  if (outcome.status === "failed") throw new Error(outcome.message)
  return {
    result: outcome.result,
    message: outcome.message,
    status: "done" as const,
  }
}

/** 真实任务运行时 + 受控执行器：临时任务库，执行器复用真实 apply 逻辑。 */
const makeRuntime = async (workspace: Workspace, io: FakeIo) => {
  const dir = await makeTempDir("mac-manager-caddy-acceptance-tasks-")
  const store = new TaskStore(path.join(dir, "tasks.sqlite3"))
  taskStores.push(store)
  let calls = 0
  let hold = false
  const deps = depsOf(workspace, io)
  const runner = new TaskRunner({
    store,
    thresholdMs: 20,
    host: createInlineHost(async (job, context) => {
      calls += 1
      // 让任务一直不结束：用来观察同目标冲突
      if (hold) await new Promise<never>(() => undefined)
      const outcome = await runCaddyApplyTask({
        payload: job.payload,
        report: context.onProgress,
        deps,
      })
      return toHostOutcome(outcome)
    }),
  })
  return {
    runner,
    store,
    calls: () => calls,
    setHold: (value: boolean) => {
      hold = value
    },
  }
}

type Runtime = Awaited<ReturnType<typeof makeRuntime>>

const runtimeStatuses = (runtime: Runtime): string[] =>
  runtime.store
    .list({
      statuses: ["done", "failed", "unknown", "partial", "running"],
      limit: 10,
      offset: 0,
    })
    .rows.map((row) => row.status)

/**
 * 并行负载下 host.execute 可能超过 thresholdMs（20ms）：submit 先返回 202
 * 受理回执，终态要晚一点才落进任务表。断言终态前先轮询等它落定：
 * 10ms 间隔远小于一次应用的真实执行耗时，不拖慢用例；3 秒上限覆盖
 * 重负载下的真实 IO，超时说明终态真的没写成，报错里带当前状态。
 */
const waitForStatus = async (
  runtime: Runtime,
  requestId: string,
  expected: string
) => {
  const deadline = Date.now() + 3000
  for (;;) {
    const row = runtime.store.findByRequestId(requestId)
    if (row?.status === expected) return row
    if (Date.now() > deadline) {
      throw new Error(
        `等待任务 ${requestId} 达到终态 ${expected} 超时（当前状态：${row?.status ?? "无记录"}）`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** 与 handlers.ts 的 apply 端点同构：提交任务并把结果映射成 HTTP 语义。 */
const submitApply = async (
  runtime: Runtime,
  input: { requestId: string; expectedSignature: string }
) =>
  toTaskHttpResponse(
    await runtime.runner.submit<CaddyApplyResult>({
      kind: CADDY_APPLY_KIND,
      target: caddyConfigTaskTarget(),
      lockTarget: caddyConfigTaskTarget(),
      payload: {
        mode: "apply",
        expectedSignature: input.expectedSignature,
      },
      requestId: input.requestId,
      toCompletedResponse: (result) => ({
        status: 200 as const,
        body: CaddyApplyResultSchema.parse(result.result),
      }),
    }),
    200
  )

describe("验收 1：接管语义等价", () => {
  it("识别 8 条规则；导入后包标记再生成，语义与顺序都不变", async () => {
    const parsed = parseCaddyfile(buildFile(false))
    expect(parsed.unsupported).toEqual([])
    expect(parsed.siteAddresses).toEqual([":8443"])
    expect(semanticsOf(parsed.rules)).toMatchInlineSnapshot(`
      [
        [
          "path",
          null,
          "/alpha/*",
          true,
          "127.0.0.1:15001",
        ],
        [
          "path",
          null,
          "/alpha-dev/*",
          true,
          "127.0.0.1:15002",
        ],
        [
          "path",
          null,
          "/beta/*",
          true,
          "127.0.0.1:15003",
        ],
        [
          "path",
          null,
          "/gamma/*",
          true,
          "127.0.0.1:15004",
        ],
        [
          "host",
          "alpha.example.com",
          null,
          false,
          "127.0.0.1:15001",
        ],
        [
          "host",
          "alpha-dev.example.com",
          null,
          false,
          "127.0.0.1:15002",
        ],
        [
          "host",
          "beta.example.com",
          null,
          false,
          "127.0.0.1:15003",
        ],
        [
          "host",
          "gamma.example.com",
          null,
          false,
          "127.0.0.1:15004",
        ],
      ]
    `)

    const workspace = await makeWorkspace(buildFile(false))
    const unwrapped = await readFile(workspace.filePath, "utf8")

    // 接管第一步：规则还在标记之外时导入（只写数据库）
    const imported = await importCaddyRulesFromFile(
      workspace.targets,
      workspace.store
    )
    expect(imported).toEqual({ imported: 8, skipped: 0 })
    expect(await readFile(workspace.filePath, "utf8")).toBe(unwrapped)

    // 接管第二步：手工把同一批规则包进成对标记
    const wrapped = buildFile(true)
    await writeFile(workspace.filePath, wrapped, "utf8")

    // 应用时做的那一步：只替换标记之间的内容
    const replaced = replaceManagedRegion(
      wrapped,
      generateManagedRules(workspace.store.listRules())
    )
    expect(replaced.replaced).toBe(true)
    await writeFile(workspace.filePath, replaced.text, "utf8")

    const reparsed = parseCaddyfile(replaced.text)
    expect(reparsed.unsupported).toEqual([])
    expect(reparsed.rules).toHaveLength(8)
    expect(reparsed.rules.every((rule) => rule.origin === "managed")).toBe(true)
    expect(semanticsOf(reparsed.rules)).toEqual(semanticsOf(parsed.rules))
    expect(outsideRegion(replaced.text)).toEqual(outsideRegion(wrapped))
  })

  /**
   * 导入识别文件里的全部规则（不区分在不在标记内）：接管顺序不影响结果，
   * 数据库丢失时也能从受管区域把规则恢复回来。
   */
  it("先包标记再导入同样导入 8 条", async () => {
    const workspace = await makeWorkspace(buildFile(true))
    const parsed = parseCaddyfile(buildFile(true))
    expect(parsed.rules.every((rule) => rule.origin === "managed")).toBe(true)
    expect(
      await importCaddyRulesFromFile(workspace.targets, workspace.store)
    ).toEqual({ imported: 8, skipped: 0 })
    expect(workspace.store.listRules()).toHaveLength(8)
    expect(
      workspace.store
        .listRules()
        .map((rule) => [
          rule.matchKind,
          rule.host,
          rule.pathPrefix,
          rule.stripPrefix,
          rule.upstream,
        ])
    ).toEqual(semanticsOf(parsed.rules))
    // 再次导入全部跳过，不会重复入库
    expect(
      await importCaddyRulesFromFile(workspace.targets, workspace.store)
    ).toEqual({ imported: 0, skipped: 8 })
  })
})

describe("验收 2：草稿写入不碰文件", () => {
  it("创建、修改、停用、删除、导入都不改文件，也不产生应用记录", async () => {
    const workspace = await makeWorkspace(buildFile(false))
    const before = await readFile(workspace.filePath, "utf8")

    const created = createCaddyRule(ruleInput(), workspace.store)
    updateCaddyRule(
      created.id,
      ruleInput({ name: "改名", upstream: "127.0.0.1:15999" }),
      workspace.store
    )
    updateCaddyRule(
      created.id,
      ruleInput({ name: "改名", upstream: "127.0.0.1:15999", enabled: false }),
      workspace.store
    )
    deleteCaddyRule(created.id, workspace.store)
    expect(
      await importCaddyRulesFromFile(workspace.targets, workspace.store)
    ).toEqual({ imported: 8, skipped: 0 })

    expect(sha256(await readFile(workspace.filePath, "utf8"))).toBe(
      sha256(before)
    )
    expect(workspace.store.listApplyRecords()).toEqual([])
  })
})

describe("验收 3：无效配置、版本冲突与权限不足都阻止应用", () => {
  it("受管区域缺失时拒绝且不改文件", async () => {
    const workspace = await makeWorkspace(buildFile(false))
    const before = await readFile(workspace.filePath, "utf8")
    const rejection = await rejectionOf(workspace)
    expect(rejection).toEqual({
      status: 409,
      body: { message: "现有配置尚未接管，应用会与手工规则重复" },
    })
    expect(await readFile(workspace.filePath, "utf8")).toBe(before)
    expect(workspace.store.listApplyRecords()).toEqual([])
  })

  it("有无法识别的行时拒绝，且这些行仍在文件里", async () => {
    const content = buildFile(true).replace(
      "\thandle_path /alpha/* {",
      "\tencode gzip\n\thandle_path /alpha/* {"
    )
    const workspace = await makeWorkspace(content)
    const rejection = await rejectionOf(workspace)
    expect(rejection).toEqual({
      status: 409,
      body: { message: "配置文件里有无法识别的行，应用可能覆盖手工配置" },
    })
    const after = await readFile(workspace.filePath, "utf8")
    expect(after).toBe(content)
    expect(after).toContain("\tencode gzip")
    expect(workspace.store.listApplyRecords()).toEqual([])
  })

  it("还有未接管的规则时拒绝，规则一条都不少", async () => {
    const content = buildExternalFile()
    const workspace = await makeWorkspace(content)
    const rejection = await rejectionOf(workspace)
    expect(rejection).toEqual({
      status: 409,
      body: { message: "配置文件里还有尚未接管的规则" },
    })
    expect(await readFile(workspace.filePath, "utf8")).toBe(content)
    const parsed = parseCaddyfile(content)
    expect(
      parsed.rules.filter((rule) => rule.origin === "external")
    ).toHaveLength(1)
    expect(workspace.store.listApplyRecords()).toEqual([])
  })

  it("指纹不符（版本冲突）时拒绝，且不产生写入", async () => {
    const workspace = await makeWorkspace(buildFile(true))
    // 数据库里有规则，才轮得到指纹这一层（空库会先被上一条闸门拦住）
    createCaddyRule(ruleInput(), workspace.store)
    const before = await readFile(workspace.filePath, "utf8")
    const rejection = await rejectionOf(workspace, "stale-signature")
    expect(rejection).toEqual({
      status: 409,
      body: { message: "规则已被其他改动更新，请重新读取后再应用" },
    })
    expect(await readFile(workspace.filePath, "utf8")).toBe(before)
    expect(workspace.store.listApplyRecords()).toEqual([])
  })

  it("配置文件不可读时返回 403 且不产生写入", async () => {
    const workspace = await makeWorkspace(buildFile(true))
    const before = await readFile(workspace.filePath, "utf8")
    await chmod(workspace.filePath, 0o000)
    try {
      const readFailure = await failureOf(() =>
        readCaddyConfigText(workspace.targets.configFile)
      )
      expect(readFailure.status).toBe(403)
      expect(readFailure.body.message).toContain("没有权限读取 Caddy 配置文件")
      expect((await rejectionOf(workspace)).status).toBe(403)
      expect(workspace.store.listApplyRecords()).toEqual([])
    } finally {
      await chmod(workspace.filePath, 0o600)
    }
    expect(await readFile(workspace.filePath, "utf8")).toBe(before)
  })
})

describe("验收 3b：空库保护与数据库丢失恢复", () => {
  it("从未应用 + 数据库空 + 受管区域有规则时拒绝应用，导入一次即解除", async () => {
    const workspace = await makeWorkspace(buildFile(true))
    const before = await readFile(workspace.filePath, "utf8")

    const read = await readCaddyRules(
      workspace.targets,
      makeFakeIo(workspace).probes(),
      workspace.store
    )
    expect(read.writable).toBe(false)
    expect(read.blockedReason).toContain("避免应用后清空这些转发")
    expect(read.blockedReason).toContain("8 条规则")

    const rejection = await rejectionOf(workspace)
    expect(rejection.status).toBe(409)
    expect(rejection.body.message).toContain("避免应用后清空这些转发")
    expect(await readFile(workspace.filePath, "utf8")).toBe(before)
    expect(workspace.store.listApplyRecords()).toEqual([])

    // 导入现有规则后闸门解除
    expect(
      await importCaddyRulesFromFile(workspace.targets, workspace.store)
    ).toEqual({ imported: 8, skipped: 0 })
    const afterImport = await readCaddyRules(
      workspace.targets,
      makeFakeIo(workspace).probes(),
      workspace.store
    )
    expect(afterImport.writable).toBe(true)
    expect(afterImport.blockedReason).toBeNull()
  })

  it("有成功应用记录后把规则全删光再应用是允许的（有意清空）", async () => {
    const workspace = await makeWorkspace(buildFile(true))
    expect(
      await importCaddyRulesFromFile(workspace.targets, workspace.store)
    ).toEqual({ imported: 8, skipped: 0 })
    const deps = depsOf(workspace, makeFakeIo(workspace))

    const first = await runCaddyApplyTask({
      payload: { mode: "apply", expectedSignature: signatureOf(workspace) },
      report: noProgress,
      deps,
    })
    expect(first.status).toBe("success")

    for (const rule of workspace.store.listRules()) {
      deleteCaddyRule(rule.id, workspace.store)
    }
    const read = await readCaddyRules(
      workspace.targets,
      makeFakeIo(workspace).probes(),
      workspace.store
    )
    // 数据库是权威：有成功记录后空库不再被拦
    expect(read.writable).toBe(true)
    expect(read.blockedReason).toBeNull()

    const second = await runCaddyApplyTask({
      payload: { mode: "apply", expectedSignature: signatureOf(workspace) },
      report: noProgress,
      deps,
    })
    expect(second.status).toBe("success")
    expect(second.result.ruleCount).toBe(0)
    const reparsed = parseCaddyfile(await readFile(workspace.filePath, "utf8"))
    expect(reparsed.rules).toEqual([])
    expect(workspace.store.listApplyRecords()).toHaveLength(2)
  })

  it("数据库丢失后能从受管区域把规则导入回来", async () => {
    const workspace = await makeWorkspace(buildFile(false))
    expect(
      await importCaddyRulesFromFile(workspace.targets, workspace.store)
    ).toEqual({ imported: 8, skipped: 0 })

    // 接管后的状态：文件里已经有生成好的受管区域
    const replaced = replaceManagedRegion(
      buildFile(true),
      generateManagedRules(workspace.store.listRules())
    )
    await writeFile(workspace.filePath, replaced.text, "utf8")

    // 模拟数据库丢失：规则一条不剩
    for (const rule of workspace.store.listRules()) {
      deleteCaddyRule(rule.id, workspace.store)
    }
    expect(workspace.store.listRules()).toEqual([])
    const blocked = await readCaddyRules(
      workspace.targets,
      makeFakeIo(workspace).probes(),
      workspace.store
    )
    expect(blocked.writable).toBe(false)

    // 受管区域内的 8 条规则同样能导入回来
    expect(
      await importCaddyRulesFromFile(workspace.targets, workspace.store)
    ).toEqual({ imported: 8, skipped: 0 })
    expect(workspace.store.listRules()).toHaveLength(8)
    const recovered = await readCaddyRules(
      workspace.targets,
      makeFakeIo(workspace).probes(),
      workspace.store
    )
    expect(recovered.writable).toBe(true)
    expect(recovered.managedRegionDrifted).toBe(false)
  })
})

describe("验收 4：任务运行时的重复与冲突分类", () => {
  it("同一 requestId 只执行一次，载荷变了返回 409 未开始", async () => {
    const workspace = await makeWorkspace(buildFile(true))
    createCaddyRule(ruleInput(), workspace.store)
    const runtime = await makeRuntime(workspace, makeFakeIo(workspace))
    const signature = signatureOf(workspace)
    const requestId = `req_${"a".repeat(16)}`

    await submitApply(runtime, {
      requestId,
      expectedSignature: signature,
    })
    await submitApply(runtime, {
      requestId,
      expectedSignature: signature,
    })
    // 同一 requestId 只执行一次：两次提交后执行器仍只被调用一次
    expect(runtime.calls()).toBe(1)

    // 负载下执行可能超过 20ms 响应阈值，提交可能拿到 202 受理回执；
    // 等终态落定后重放同一请求，断言确定的完成响应，仍不重复执行
    await waitForStatus(runtime, requestId, "done")
    const replayed = await submitApply(runtime, {
      requestId,
      expectedSignature: signature,
    })
    expect(replayed.status).toBe(200)
    expect(runtime.calls()).toBe(1)

    const conflicted = await submitApply(runtime, {
      requestId,
      expectedSignature: "stale-signature",
    })
    expect(conflicted.status).toBe(409)
    expect(conflicted.body).toMatchObject({ executionStatus: "not_started" })
    expect(runtime.calls()).toBe(1)
  })

  it("同目标并发是未开始，核实请求失败是结果未知", async () => {
    // 未开始：同目标已有任务在跑
    const busyWorkspace = await makeWorkspace(buildFile(true))
    createCaddyRule(ruleInput(), busyWorkspace.store)
    const busyRuntime = await makeRuntime(
      busyWorkspace,
      makeFakeIo(busyWorkspace)
    )
    const busySignature = signatureOf(busyWorkspace)
    busyRuntime.setHold(true)
    const held = await submitApply(busyRuntime, {
      requestId: `req_${"b".repeat(16)}`,
      expectedSignature: busySignature,
    })
    expect(held.status).toBe(202)
    const notStarted = await submitApply(busyRuntime, {
      requestId: `req_${"c".repeat(16)}`,
      expectedSignature: busySignature,
    })
    expect(notStarted.status).toBe(409)
    expect(notStarted.body).toMatchObject({ executionStatus: "not_started" })
    busyRuntime.setHold(false)
    busyRuntime.runner.shutdown()

    // 结果未知：文件已写入并加载，但核实请求失败
    const unknownWorkspace = await makeWorkspace(buildFile(true))
    createCaddyRule(ruleInput(), unknownWorkspace.store)
    const unknownIo = makeFakeIo(unknownWorkspace)
    unknownIo.setRunningError(new Error("timeout"))
    const unknownRuntime = await makeRuntime(unknownWorkspace, unknownIo)
    const unknownRequestId = `req_${"d".repeat(16)}`
    await submitApply(unknownRuntime, {
      requestId: unknownRequestId,
      expectedSignature: signatureOf(unknownWorkspace),
    })
    // 核实失败的任务终态是 unknown；负载下终态可能晚于 submit 返回
    // （先拿到 202 受理回执），等落定后重放同一请求，断言「结果未知」
    // 的语义而不是误报成功
    await waitForStatus(unknownRuntime, unknownRequestId, "unknown")
    const settled = await submitApply(unknownRuntime, {
      requestId: unknownRequestId,
      expectedSignature: signatureOf(unknownWorkspace),
    })
    expect(settled.status).toBe(409)
    expect(settled.body).toMatchObject({ executionStatus: "unknown" })
    expect(runtimeStatuses(unknownRuntime)).toEqual(["unknown"])
  })
})

describe("验收 5：任何失败阶段都不误报成功", () => {
  type Case = {
    name: string
    expectedTaskStatus: string
    prepare: (io: FakeIo) => void
  }

  const cases: Case[] = [
    {
      name: "校验失败",
      expectedTaskStatus: "failed",
      prepare: (io) =>
        io.setValidate({
          ok: false,
          timedOut: false,
          firstLine: "Error: adapting config: unrecognized directive",
        }),
    },
    {
      name: "加载失败",
      expectedTaskStatus: "failed",
      prepare: (io) =>
        io.setReload({
          ok: false,
          timedOut: false,
          firstLine: "Error: connection refused",
        }),
    },
    {
      name: "加载超时",
      expectedTaskStatus: "unknown",
      prepare: (io) =>
        io.setReload({ ok: false, timedOut: true, firstLine: "" }),
    },
    {
      name: "核实缺规则",
      expectedTaskStatus: "failed",
      prepare: (io) => io.setRunningConfig({ apps: {} }),
    },
    {
      name: "核实请求失败",
      expectedTaskStatus: "unknown",
      prepare: (io) => io.setRunningError(new Error("timeout")),
    },
  ]

  it.each(cases)(
    "$name：任务终态是 $expectedTaskStatus 而不是 done",
    async (item) => {
      const workspace = await makeWorkspace(buildFile(true))
      const created = createCaddyRule(ruleInput(), workspace.store)
      const io = makeFakeIo(workspace)
      item.prepare(io)
      const runtime = await makeRuntime(workspace, io)
      const requestId = `req_${"e".repeat(16)}`

      await submitApply(runtime, {
        requestId,
        expectedSignature: signatureOf(workspace),
      })

      // 负载下终态可能晚于 submit 返回（先拿到 202），轮询等到预期
      // 终态落定再断言
      const row = await waitForStatus(
        runtime,
        requestId,
        item.expectedTaskStatus
      )
      expect(row.status).not.toBe("done")

      // 都能重新核实：数据库规则还在、变更仍未应用、没有成功记录
      const reread = await readCaddyRules(
        workspace.targets,
        io.probes(),
        workspace.store
      )
      expect(reread.rules.map((rule) => rule.id)).toEqual([created.id])
      expect(reread.hasUnappliedChanges).toBe(true)
      const records = workspace.store.listApplyRecords()
      expect(records.every((record) => record.status !== "success")).toBe(true)

      if (item.name === "加载失败") {
        // 加载失败必须把文件还原成改动前的原文，并说明已还原
        expect(await readFile(workspace.filePath, "utf8")).toBe(buildFile(true))
        expect(records[0]?.message).toContain("文件已还原")
      }
      if (item.name === "加载超时") {
        // 结果未知时不还原：文件已是候选内容，记录标 unknown
        expect(await readFile(workspace.filePath, "utf8")).toContain("/alpha/*")
        expect(records[0]?.status).toBe("unknown")
      }
    }
  )

  it("备份失败：抛错、文件未变、无记录", async () => {
    const workspace = await makeWorkspace(buildFile(true))
    createCaddyRule(ruleInput(), workspace.store)
    const io = makeFakeIo(workspace)
    const blocked = path.join(workspace.dir, "blocked")
    await writeFile(blocked, "not a directory", "utf8")

    await expect(
      runCaddyApplyTask({
        payload: { mode: "apply", expectedSignature: signatureOf(workspace) },
        report: noProgress,
        deps: { ...depsOf(workspace, io), backupDir: blocked },
      })
    ).rejects.toThrow()
    expect(await readFile(workspace.filePath, "utf8")).toBe(buildFile(true))
    expect(workspace.store.listApplyRecords()).toEqual([])
  })

  it("写文件失败（配置目录不可写）时抛错、文件未变、无记录", async () => {
    const workspace = await makeWorkspace(buildFile(true))
    createCaddyRule(ruleInput(), workspace.store)
    const io = makeFakeIo(workspace)
    await chmod(workspace.dir, 0o500)
    try {
      await expect(
        runCaddyApplyTask({
          payload: { mode: "apply", expectedSignature: signatureOf(workspace) },
          report: noProgress,
          deps: depsOf(workspace, io),
        })
      ).rejects.toThrow()
      expect(workspace.store.listApplyRecords()).toEqual([])
    } finally {
      await chmod(workspace.dir, 0o700)
    }
    expect(await readFile(workspace.filePath, "utf8")).toBe(buildFile(true))
  })
})

describe("验收 6：不删除未识别配置，也不泄露配置内容", () => {
  it("被拒绝后文件里的指令与规则一条都不少", async () => {
    const content = buildFile(true).replace(
      "\thandle_path /beta/* {",
      "\tencode gzip\n\thandle_path /beta/* {"
    )
    const workspace = await makeWorkspace(content)
    const externalBefore = parseCaddyfile(content).rules.filter(
      (rule) => rule.origin === "external"
    ).length

    const rejection = await rejectionOf(workspace)
    expect(rejection.status).toBe(409)
    const after = await readFile(workspace.filePath, "utf8")
    expect(after).toBe(content)
    expect(after).toContain("\tencode gzip")
    expect(
      parseCaddyfile(after).rules.filter((rule) => rule.origin === "external")
        .length
    ).toBe(externalBefore)
  })

  it("样本最多 20 条；响应与失败消息都不含环境文件内容或配置正文", async () => {
    const body = Array.from(
      { length: 25 },
      (_, index) => `\tencode gzip${index}`
    )
    const workspace = await makeWorkspace(
      `${[
        ":8443 {",
        `\t${CADDY_MANAGED_START}`,
        `\t${CADDY_MANAGED_END}`,
        ...body,
        "}",
      ].join("\n")}\n`
    )
    // 同目录放一份「环境文件」：它不应出现在任何响应里
    await writeFile(
      path.join(workspace.dir, "cloudflare.env"),
      "CF_API_TOKEN=secret-marker-should-not-leak\n",
      "utf8"
    )

    const result = await readCaddyRules(
      workspace.targets,
      makeFakeIo(workspace).probes(),
      workspace.store
    )
    expect(result.unsupportedLines).toBe(25)
    expect(result.unsupportedSamples).toHaveLength(20)
    expect(JSON.stringify(result)).not.toContain(
      "secret-marker-should-not-leak"
    )
    expect(JSON.stringify(result)).not.toContain("CF_API_TOKEN")

    const fileText = await readFile(workspace.targets.configFile, "utf8")
    const failure = await rejectionOf(workspace)
    expect(failure.status).toBe(409)
    expect(failure.body.message).not.toContain("admin off")
    expect(failure.body.message.length).toBeLessThan(fileText.length)
    expect(JSON.stringify(failure)).not.toContain("CF_API_TOKEN")
  })
})

describe("验收 7：恢复闭环", () => {
  it("应用 A → 应用 B → 恢复 A，数据库、文件与记录都回到 A", async () => {
    const workspace = await makeWorkspace(buildFile(true))
    const alpha = createCaddyRule(ruleInput(), workspace.store)
    const deps = depsOf(workspace, makeFakeIo(workspace))

    const first = await runCaddyApplyTask({
      payload: { mode: "apply", expectedSignature: signatureOf(workspace) },
      report: noProgress,
      deps,
    })
    expect(first.status).toBe("success")
    const versionA = first.result.versionId
    const textA = workspace.store.findApplyRecord(versionA)?.generatedText

    deleteCaddyRule(alpha.id, workspace.store)
    const beta = createCaddyRule(
      ruleInput({
        name: "beta 路径",
        pathPrefix: "/beta/*",
        upstream: "127.0.0.1:15002",
      }),
      workspace.store
    )
    const second = await runCaddyApplyTask({
      payload: { mode: "apply", expectedSignature: signatureOf(workspace) },
      report: noProgress,
      deps,
    })
    expect(second.status).toBe("success")
    expect(await readFile(workspace.filePath, "utf8")).toContain("/beta/*")

    const restored = await runCaddyApplyTask({
      payload: { mode: "restore", versionId: versionA },
      report: noProgress,
      deps,
    })
    expect(restored.status).toBe("success")
    expect(restored.result.verified).toBe(true)
    expect(workspace.store.listRules().map((rule) => rule.id)).toEqual([
      alpha.id,
    ])
    expect(workspace.store.findRule(beta.id)).toBeNull()
    const text = await readFile(workspace.filePath, "utf8")
    expect(text).toBe(textA)
    expect(text).not.toContain("/beta/*")

    const records = workspace.store.listApplyRecords()
    expect(records).toHaveLength(3)
    expect(workspace.store.latestApplyRecord()?.id).toBe(
      restored.result.versionId
    )
  })
})
