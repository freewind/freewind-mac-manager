import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PublicOperationError } from "@server/common/public-error"
import { TaskRunner } from "@server/common/tasks/runner"
import { TaskStore } from "@server/common/tasks/store"
import { taskExecutors } from "@server/tasks/executors"
import type {
  CaddyApplyResult,
  CaddyRule,
  CaddyRuleInput,
  TaskProgress,
} from "@shared/api-contract"
import {
  CADDY_MANAGED_END,
  CADDY_MANAGED_START,
  caddyRulesSignature,
} from "@shared/caddy-format"
import { caddyConfigTaskTarget } from "@shared/task-targets"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CaddyCommands } from "./apply"
import { CaddyStore } from "./store"
import {
  CADDY_APPLY_KIND,
  CaddyApplyPayloadSchema,
  runCaddyApplyTask,
} from "./task"

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
  store: CaddyStore
  deps: {
    targets: {
      configFile: string
      binaryPath: string
      adminUrl: string
      launchdLabel: string
    }
    probes: {
      isProcessRunning: (label: string) => Promise<boolean>
      readVersion: (binaryPath: string) => Promise<string | null>
      isAdminReachable: (adminUrl: string) => Promise<boolean>
    }
    commands: CaddyCommands
    readRunningConfig: (adminUrl: string) => Promise<unknown>
    store: CaddyStore
    backupDir: string
  }
}

/** 运行配置按当前数据库规则动态生成：恢复前后都能"真的"核实到。 */
const runningConfigFor = (rules: CaddyRule[]): unknown => ({
  apps: {
    http: {
      servers: {
        srv0: {
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

const makeWorkspace = async (content: string): Promise<Workspace> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mac-manager-caddy-task-"))
  tempDirs.push(dir)
  const filePath = path.join(dir, "Caddyfile")
  await writeFile(filePath, content, "utf8")
  const store = new CaddyStore(path.join(dir, "caddy.sqlite3"))
  stores.push(store)
  const backupDir = path.join(dir, "backups")
  return {
    dir,
    filePath,
    backupDir,
    store,
    deps: {
      targets: {
        configFile: filePath,
        binaryPath: path.join(dir, "caddy"),
        adminUrl: "http://127.0.0.1:2019",
        launchdLabel: "com.freewind.caddy",
      },
      probes: {
        isProcessRunning: async () => true,
        readVersion: async () => "v2.11.4",
        isAdminReachable: async () => true,
      },
      commands: {
        validate: async () => ({ ok: true, timedOut: false, firstLine: "" }),
        reload: async () => ({ ok: true, timedOut: false, firstLine: "" }),
      },
      readRunningConfig: async () => runningConfigFor(store.listRules()),
      store,
      backupDir,
    },
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

const noProgress = (_progress: TaskProgress): void => {}

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

const READY_FILE = `:8443 {
	${CADDY_MANAGED_START}
	${CADDY_MANAGED_END}
}
`

describe("Caddy 应用任务载荷", () => {
  it.each([
    {},
    { mode: "unknown" },
    { mode: "apply" },
    { mode: "restore" },
    { mode: "restore", versionId: "" },
  ])("拒绝非法载荷 %j 且不产生副作用", async (payload) => {
    expect(CaddyApplyPayloadSchema.safeParse(payload).success).toBe(false)
    const report = vi.fn()
    await expect(runCaddyApplyTask({ payload, report })).rejects.toThrow(
      "Caddy 应用载荷非法"
    )
    expect(report).not.toHaveBeenCalled()
  })

  it("执行器已注册，并在执行前再校验一次载荷", async () => {
    const executor = taskExecutors.find(
      (item) => item.kind === CADDY_APPLY_KIND
    )
    if (executor === undefined) throw new Error("未注册 Caddy 应用执行器")
    await expect(
      executor.run({ mode: "unknown" }, { report: noProgress })
    ).rejects.toThrow("Caddy 应用载荷非法")
  })
})

describe("Caddy 应用任务执行", () => {
  it("恢复不存在的版本返回 404 且不改数据库", async () => {
    const workspace = await makeWorkspace(READY_FILE)
    const rule = workspace.store.createRule(ruleInput())

    const error = await catchAsync(
      runCaddyApplyTask({
        payload: { mode: "restore", versionId: "missing" },
        report: noProgress,
        deps: workspace.deps,
      })
    )
    expect(errorStatus(error)).toBe(404)
    expect(workspace.store.listRules().map((item) => item.id)).toEqual([
      rule.id,
    ])
    expect(workspace.store.listApplyRecords()).toEqual([])
  })

  it("应用成功后可见于版本列表", async () => {
    const workspace = await makeWorkspace(READY_FILE)
    workspace.store.createRule(ruleInput())
    const outcome = await runCaddyApplyTask({
      payload: {
        mode: "apply",
        expectedSignature: caddyRulesSignature(workspace.store.listRules()),
      },
      report: noProgress,
      deps: workspace.deps,
    })
    expect(outcome.status).toBe("success")
    expect(workspace.store.listApplyRecords()).toHaveLength(1)
    expect(workspace.store.latestApplyRecord()?.id).toBe(
      outcome.result.versionId
    )
  })

  it("恢复历史版本：数据库与文件都回到该版本并留下新的成功记录", async () => {
    const workspace = await makeWorkspace(READY_FILE)
    const alpha = workspace.store.createRule(ruleInput())
    const first = await runCaddyApplyTask({
      payload: {
        mode: "apply",
        expectedSignature: caddyRulesSignature(workspace.store.listRules()),
      },
      report: noProgress,
      deps: workspace.deps,
    })
    expect(first.status).toBe("success")
    const versionA = first.result.versionId
    const textA = workspace.store.findApplyRecord(versionA)?.generatedText

    // 换成另一条规则并应用，制造第二个版本。
    workspace.store.deleteRule(alpha.id)
    const beta = workspace.store.createRule(
      ruleInput({
        pathPrefix: "/beta/*",
        name: "beta 路径",
        upstream: "127.0.0.1:15002",
      })
    )
    const second = await runCaddyApplyTask({
      payload: {
        mode: "apply",
        expectedSignature: caddyRulesSignature(workspace.store.listRules()),
      },
      report: noProgress,
      deps: workspace.deps,
    })
    expect(second.status).toBe("success")
    expect(await readFile(workspace.filePath, "utf8")).toContain("/beta/*")

    const restored = await runCaddyApplyTask({
      payload: { mode: "restore", versionId: versionA },
      report: noProgress,
      deps: workspace.deps,
    })
    expect(restored.status).toBe("success")
    expect(restored.result.verified).toBe(true)
    expect(workspace.store.listRules().map((item) => item.id)).toEqual([
      alpha.id,
    ])
    expect(workspace.store.findRule(beta.id)).toBeNull()
    const text = await readFile(workspace.filePath, "utf8")
    expect(text).toBe(textA)
    expect(text).toContain("/alpha/*")
    expect(text).not.toContain("/beta/*")

    const latest = workspace.store.latestApplyRecord()
    expect(latest?.id).toBe(restored.result.versionId)
    expect(latest?.status).toBe("success")
    expect(latest?.generatedText).toBe(textA)
    expect(workspace.store.listApplyRecords()).toHaveLength(3)
  })
})

describe("Caddy 应用任务提交", () => {
  it("同一 requestId 只执行一次，载荷变了则冲突且不留新记录", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mac-manager-caddy-task-"))
    tempDirs.push(dir)
    const taskStore = new TaskStore(path.join(dir, "tasks.sqlite3"))
    const executed: string[] = []
    const runner = new TaskRunner({
      store: taskStore,
      thresholdMs: 20,
      host: {
        execute: async (job) => {
          executed.push(job.taskId)
          return {
            result: {
              message: "已应用",
              versionId: "v1",
              appliedAt: 1,
              ruleCount: 1,
              verified: true,
              backupFile: null,
            },
            message: "已应用",
            status: "done",
          }
        },
      },
    })

    const requestId = `req_${"a".repeat(16)}`
    const submit = (expectedSignature: string) =>
      runner.submit<CaddyApplyResult>({
        kind: CADDY_APPLY_KIND,
        target: caddyConfigTaskTarget(),
        lockTarget: caddyConfigTaskTarget(),
        payload: { mode: "apply", expectedSignature },
        requestId,
        toCompletedResponse: (outcome) => ({
          status: 200,
          body: outcome.result as CaddyApplyResult,
        }),
      })

    const first = await submit("sig-1")
    const second = await submit("sig-1")
    expect(first.kind).toBe("completed")
    expect(second.kind).toBe("completed")
    expect(executed).toHaveLength(1)

    const stale = await submit("sig-2")
    expect(stale.kind).toBe("conflict")
    expect(executed).toHaveLength(1)
    expect(
      taskStore.list({
        statuses: ["done", "failed", "unknown", "partial", "running"],
        limit: 10,
        offset: 0,
      }).total
    ).toBe(1)

    runner.shutdown()
    taskStore.close()
  })
})
