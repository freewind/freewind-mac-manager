import { describe, expect, it } from "vitest"
import {
  AI_CONTEXT_MAX_CHARS,
  AI_CONTEXT_MAX_ITEMS_PER_LIST,
  AI_CONTEXT_NOTICE,
  buildAiAssistantContext,
} from "./context"

/** 固定时间戳，让快照可复现。 */
const COLLECTED_AT = Date.UTC(2026, 9, 12, 9, 30, 0)
const CACHED_AT = Date.UTC(2026, 9, 12, 9, 30, 5)

describe("buildAiAssistantContext", () => {
  it("把指标与列表整理成可复现的快照", () => {
    const text = buildAiAssistantContext({
      feature: "总览",
      subject: "macbook · Apple M3",
      collectedAt: COLLECTED_AT,
      cachedAt: CACHED_AT,
      status: "ready",
      summary: ["CPU 负载（1/5/15 分钟）：1.23 / 1.10 / 0.98 · 12 核"],
      lists: [
        {
          label: "占用最高的进程",
          items: ["PID 4242 node · CPU 31.2% · 内存 512.0 MB"],
          total: 1,
        },
      ],
    })
    expect(text).toMatchInlineSnapshot(`
      "【AI 助手上下文 · 总览】macbook · Apple M3
      数据状态：正常（采集时间 2026-10-12 09:30:00 UTC，缓存时间 2026-10-12 09:30:05 UTC）

      已显示的指标：
      - CPU 负载（1/5/15 分钟）：1.23 / 1.10 / 0.98 · 12 核

      占用最高的进程（1 条）：
      - PID 4242 node · CPU 31.2% · 内存 512.0 MB

      ${AI_CONTEXT_NOTICE}"
    `)
  })

  it("列表超过上限时只列前十条并标明总数", () => {
    const items = Array.from(
      { length: 23 },
      (_, index) => `PID ${100 + index} worker-${index} · CPU 1%`
    )
    const text = buildAiAssistantContext({
      feature: "进程管理",
      status: "ready",
      lists: [{ label: "进程", items, total: items.length }],
    })
    expect(text).toContain("进程（共 23 条，仅列前 10 条）：")
    expect(text).toContain("- PID 109 worker-9 · CPU 1%")
    expect(text).not.toContain("worker-10")
  })

  it("总量超过上限时先截断内容再截断条目，总长不超过上限", () => {
    const text = buildAiAssistantContext({
      feature: "进程管理",
      status: "ready",
      summary: Array.from({ length: 200 }, () => "x".repeat(120)),
      lists: [
        {
          label: "进程",
          items: Array.from({ length: 40 }, (_, index) => `PID ${index}`),
        },
      ],
    })
    expect(text.length).toBeLessThanOrEqual(AI_CONTEXT_MAX_CHARS)
    expect(text).toContain("…（上下文已截断，省略了部分内容）")
    expect(text.endsWith(AI_CONTEXT_NOTICE)).toBe(true)
  })

  it("加载中与读取失败时如实说明，不编造数值", () => {
    expect(
      buildAiAssistantContext({ feature: "流量监控", status: "loading" })
    ).toMatchInlineSnapshot(`
      "【AI 助手上下文 · 流量监控】
      数据状态：尚未获取（页面仍在加载，未拿到可摘录的数据）

      优先调用本应用 API 核实最新状态；本上下文为页面快照，不代表实时状态。"
    `)
    expect(
      buildAiAssistantContext({
        feature: "Docker",
        status: "error",
        errorMessage: "无法连接 Docker",
      })
    ).toContain("数据状态：读取失败（无法连接 Docker）")
    expect(
      buildAiAssistantContext({ feature: "Docker", status: "error" })
    ).toContain("数据状态：读取失败（页面未提供失败原因）")
  })

  it("状态正常但页面没数据时明确说明，不写假数值", () => {
    expect(
      buildAiAssistantContext({ feature: "总览", status: "ready" })
    ).toContain("页面尚未展示可摘录的数据")
  })

  it("没有条目的列表按空列表说明，不省略标题", () => {
    expect(
      buildAiAssistantContext({
        feature: "Docker",
        status: "ready",
        lists: [{ label: "容器", items: [], total: 0 }],
      })
    ).toContain("容器：页面尚未展示条目。")
  })

  it("疑似凭据的行被替换，密码、token、API key 不外传", () => {
    const text = buildAiAssistantContext({
      feature: "总览",
      status: "ready",
      summary: [
        "API_KEY=sk-live-1234567890",
        "Authorization: Bearer abc.def.ghi",
        "password=hunter2",
        "内存 8.0 GB / 16.0 GB",
      ],
      lists: [
        {
          label: "进程",
          items: ["PID 1 launchd · CPU 0.1%", "PID 2 ssh-agent --token t-123"],
        },
      ],
    })
    expect(text).not.toContain("sk-live-1234567890")
    expect(text).not.toContain("abc.def.ghi")
    expect(text).not.toContain("hunter2")
    expect(text).not.toContain("t-123")
    expect(text).toContain("（已省略疑似凭据内容）")
    // 正常指标不受影响。
    expect(text).toContain("内存 8.0 GB / 16.0 GB")
    expect(text).toMatchInlineSnapshot(`
      "【AI 助手上下文 · 总览】
      数据状态：正常（未提供时间）

      已显示的指标：
      - （已省略疑似凭据内容）
      - （已省略疑似凭据内容）
      - （已省略疑似凭据内容）
      - 内存 8.0 GB / 16.0 GB

      进程（2 条）：
      - PID 1 launchd · CPU 0.1%
      - （已省略疑似凭据内容）

      优先调用本应用 API 核实最新状态；本上下文为页面快照，不代表实时状态。"
    `)
  })

  it("同样的入参得到同样的文本（可重复）", () => {
    const build = () =>
      buildAiAssistantContext({
        feature: "流量监控",
        subject: "实时",
        collectedAt: COLLECTED_AT,
        status: "ready",
        summary: ["下载 1.2 MB/s、上传 340 KB/s"],
      })
    expect(build()).toBe(build())
  })

  it("上限常量是约定的值", () => {
    expect(AI_CONTEXT_MAX_CHARS).toBe(4000)
    expect(AI_CONTEXT_MAX_ITEMS_PER_LIST).toBe(10)
  })

  it("对象与错误说明自身超长时也受总长约束", () => {
    const longSubject = buildAiAssistantContext({
      feature: "总览",
      subject: `macbook ${"s".repeat(10_000)}`,
      status: "ready",
      summary: ["内存 8.0 GB / 16.0 GB"],
    })
    expect(longSubject.length).toBeLessThanOrEqual(AI_CONTEXT_MAX_CHARS)
    expect(longSubject).toContain("…（上下文已截断，省略了部分内容）")
    expect(longSubject.endsWith(AI_CONTEXT_NOTICE)).toBe(true)

    const longError = buildAiAssistantContext({
      feature: "Docker",
      status: "error",
      errorMessage: `上游返回 ${"e".repeat(10_000)}`,
    })
    expect(longError.length).toBeLessThanOrEqual(AI_CONTEXT_MAX_CHARS)
    expect(longError).toContain("…（上下文已截断，省略了部分内容）")
    expect(longError.endsWith(AI_CONTEXT_NOTICE)).toBe(true)
  })

  it("超长对象被截断时仍保留明确的截断标记与收尾说明", () => {
    const text = buildAiAssistantContext({
      feature: "总览",
      subject: "x".repeat(AI_CONTEXT_MAX_CHARS * 2),
      status: "ready",
    })
    expect(text.length).toBeLessThanOrEqual(AI_CONTEXT_MAX_CHARS)
    // 不只裁 body：对象本身就被裁掉了，且标记与收尾说明都在。
    expect(text).toContain("…（上下文已截断，省略了部分内容）")
    expect(text.trimEnd().endsWith(AI_CONTEXT_NOTICE)).toBe(true)
    // 末尾形状固定：截断标记 + 收尾说明（前面的内容按预算裁掉）。
    expect(text.slice(-96)).toMatchInlineSnapshot(`
      "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

      …（上下文已截断，省略了部分内容）

      优先调用本应用 API 核实最新状态；本上下文为页面快照，不代表实时状态。"
    `)
    expect(text).not.toContain("【AI 助手上下文 · 总览】…（")
  })

  it("对象与功能名里的凭据同样被脱敏", () => {
    const text = buildAiAssistantContext({
      feature: "总览 password=hunter2",
      subject: "macbook token tk_live_should_not_leak",
      status: "ready",
      summary: ["内存 8.0 GB"],
      lists: [{ label: "带凭据的列表 api_key=sk-1", items: ["OK"] }],
    })
    const withErrorSecret = buildAiAssistantContext({
      feature: "Docker",
      status: "error",
      errorMessage: "连接失败 authorization=Bearer abc.secret.token",
    })
    expect(text).not.toContain("hunter2")
    expect(text).not.toContain("tk_live_should_not_leak")
    expect(text).not.toContain("sk-1")
    expect(text).toContain("（已省略疑似凭据内容）")
    expect(text).toContain("内存 8.0 GB")
    expect(withErrorSecret).not.toContain("abc.secret.token")
    expect(withErrorSecret).toContain("（已省略疑似凭据内容）")
  })

  it("有限但超出 Date 范围的时间按未提供时间处理，不抛错", () => {
    const outOfRange = buildAiAssistantContext({
      feature: "总览",
      collectedAt: 8.64e15 + 1,
      cachedAt: Number.MAX_VALUE,
      status: "ready",
      summary: ["内存 8.0 GB"],
    })
    expect(outOfRange).toContain("数据状态：正常（未提供时间）")
    // 合法边界值仍然照常格式化。
    const boundary = buildAiAssistantContext({
      feature: "总览",
      collectedAt: 8.64e15,
      status: "ready",
      summary: ["内存 8.0 GB"],
    })
    expect(boundary).toContain("采集时间 +275760-09-13 00:00:00 UTC")
  })
})
