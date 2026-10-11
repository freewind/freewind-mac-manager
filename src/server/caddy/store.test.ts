import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { CaddyRuleInput } from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CADDY_APPLY_FAILED, CADDY_APPLY_SUCCESS, CaddyStore } from "./store"

const tempDirs: string[] = []
let store: CaddyStore

beforeEach(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mac-manager-caddy-store-"))
  tempDirs.push(dir)
  store = new CaddyStore(path.join(dir, "caddy.sqlite3"))
})

afterEach(async () => {
  store.close()
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
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

describe("CaddyStore 规则读写", () => {
  it("创建后能读回，sortOrder 按创建顺序递增", () => {
    const first = store.createRule(makeInput())
    const second = store.createRule(
      makeInput({ pathPrefix: "/beta/*", name: "beta 路径" })
    )
    const third = store.createRule(
      makeInput({
        matchKind: "host",
        host: "alpha.example.com",
        pathPrefix: null,
        stripPrefix: false,
        name: "alpha 域名",
      })
    )

    expect([first.sortOrder, second.sortOrder, third.sortOrder]).toEqual([
      0, 1, 2,
    ])
    expect(store.maxSortOrder()).toBe(2)
    expect(store.listRules().map((rule) => rule.name)).toEqual([
      "alpha 路径",
      "beta 路径",
      "alpha 域名",
    ])
    expect(store.findRule(third.id)).toEqual(third)
    expect(store.findRule("missing")).toBeNull()
    expect(first.createdAt).toBeGreaterThan(0)
    expect(first.enabled).toBe(true)
    expect(third.host).toBe("alpha.example.com")
  })

  it("按匹配条件查重可以排除自身", () => {
    const rule = store.createRule(makeInput({ pathPrefix: "/alpha/*" }))
    expect(store.findRuleByMatch("path", null, "/alpha/*", null)?.id).toBe(
      rule.id
    )
    expect(store.findRuleByMatch("path", null, "/alpha/*", rule.id)).toBeNull()
    expect(store.findRuleByMatch("path", null, "/other", null)).toBeNull()
    expect(
      store.findRuleByMatch("host", "alpha.example.com", null, null)
    ).toBeNull()
  })

  it("更新改内容与 updatedAt，不改 sortOrder；目标不存在返回 null", () => {
    const rule = store.createRule(makeInput())
    const updated = store.updateRule(rule.id, {
      ...makeInput(),
      name: "改名",
      note: "备注",
      upstream: "127.0.0.1:15002",
      enabled: false,
      stripPrefix: false,
    })
    expect(updated).not.toBeNull()
    expect(updated?.name).toBe("改名")
    expect(updated?.note).toBe("备注")
    expect(updated?.upstream).toBe("127.0.0.1:15002")
    expect(updated?.enabled).toBe(false)
    expect(updated?.stripPrefix).toBe(false)
    expect(updated?.sortOrder).toBe(rule.sortOrder)
    expect(updated?.createdAt).toBe(rule.createdAt)
    expect(store.findRule(rule.id)?.upstream).toBe("127.0.0.1:15002")
    expect(store.updateRule("missing", makeInput())).toBeNull()
  })

  it("删除目标不存在返回 false", () => {
    const rule = store.createRule(makeInput())
    expect(store.deleteRule(rule.id)).toBe(true)
    expect(store.listRules()).toEqual([])
    expect(store.deleteRule(rule.id)).toBe(false)
  })

  it("批量导入按顺序追加 sortOrder 并跳过重复匹配条件", () => {
    store.createRule(makeInput({ pathPrefix: "/existing/*" }))
    const result = store.importRules([
      makeInput({ pathPrefix: "/alpha/*" }),
      makeInput({ pathPrefix: "/beta/*" }),
      makeInput({ pathPrefix: "/alpha/*" }),
      makeInput({ pathPrefix: "/existing/*" }),
    ])
    expect(result).toEqual({ imported: 2, skipped: 2 })
    expect(store.listRules().map((rule) => rule.pathPrefix)).toEqual([
      "/existing/*",
      "/alpha/*",
      "/beta/*",
    ])
    expect(store.listRules().map((rule) => rule.sortOrder)).toEqual([0, 1, 2])
  })

  it("批量导入失败时整体回滚", () => {
    const broken = {
      ...makeInput({ pathPrefix: "/beta/*" }),
      // 故意破坏 NOT NULL 约束，验证事务回滚。
      name: null as unknown as string,
    }
    expect(() =>
      store.importRules([makeInput({ pathPrefix: "/alpha/*" }), broken])
    ).toThrow()
    expect(store.listRules()).toEqual([])
  })
})

describe("CaddyStore 应用记录", () => {
  const rule = () => store.createRule(makeInput())

  it("插入后可按 id 与倒序读出", () => {
    const saved = rule()
    store.insertApplyRecord({
      id: "apply-1",
      appliedAt: 100,
      status: CADDY_APPLY_FAILED,
      message: "加载失败",
      rules: [saved],
      generatedText: "旧的",
      configFingerprint: "fp-1",
      runningFingerprint: null,
    })
    store.insertApplyRecord({
      id: "apply-2",
      appliedAt: 200,
      status: CADDY_APPLY_SUCCESS,
      message: "已写入",
      rules: [saved],
      generatedText: "新的",
      configFingerprint: "fp-2",
      runningFingerprint: "run-2",
    })

    expect(store.listApplyRecords().map((record) => record.id)).toEqual([
      "apply-2",
      "apply-1",
    ])
    expect(store.findApplyRecord("apply-1")).toMatchObject({
      status: CADDY_APPLY_FAILED,
      message: "加载失败",
      rules: [{ id: saved.id, pathPrefix: "/alpha/*" }],
      runningFingerprint: null,
    })
    expect(store.findApplyRecord("missing")).toBeNull()
  })

  it("上次成功应用跳过失败记录", () => {
    const saved = rule()
    const base = {
      rules: [saved],
      generatedText: "正文",
      configFingerprint: "fp",
      runningFingerprint: null,
    }
    store.insertApplyRecord({
      id: "apply-ok",
      appliedAt: 100,
      status: CADDY_APPLY_SUCCESS,
      message: "已写入",
      ...base,
    })
    store.insertApplyRecord({
      id: "apply-failed",
      appliedAt: 300,
      status: CADDY_APPLY_FAILED,
      message: "加载失败",
      ...base,
    })
    expect(store.latestApplyRecord()?.id).toBe("apply-ok")
  })

  it("没有任何成功记录时返回 null", () => {
    expect(store.latestApplyRecord()).toBeNull()
  })
})
