// @vitest-environment jsdom
import type { DatabaseRestoreState } from "@shared/api-contract"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { describeRestoreState, RestoreStatusCard } from "./RestoreStatusCard"

const plan = (
  status: NonNullable<DatabaseRestoreState["plan"]>["status"],
  over: Partial<NonNullable<DatabaseRestoreState["plan"]>> = {}
): NonNullable<DatabaseRestoreState["plan"]> => ({
  id: "restore-plan-1",
  backupId: "snap-1",
  backupFileName: "snapshots-1791700000000-ab12cd.sqlite3",
  status,
  createdAt: 1_791_700_000_000,
  updatedAt: 1_791_700_100_000,
  message: "重启服务后生效",
  unknownReason: status === "unknown" ? "重启过程中进程被中断" : null,
  ...over,
})

const state = (over: Partial<DatabaseRestoreState>): DatabaseRestoreState => ({
  plan: null,
  verified: false,
  ...over,
})

afterEach(cleanup)

describe("恢复状态的四种说法", () => {
  it("没有计划时不装作有恢复在进行", () => {
    const summary = describeRestoreState(state({}))
    expect(summary.title).toBe("当前没有恢复计划")
    expect(summary.tone).toBe("muted")
  })

  it("计划已创建只代表等待重启，不代表数据库已经换掉", () => {
    const summary = describeRestoreState(state({ plan: plan("planned") }))
    expect(summary.title).toBe("恢复计划已创建，等待重启服务后生效")
    expect(summary.tone).toBe("pending")
  })

  it("已应用且已核实：恢复执行通过复验、启动迁移通过", () => {
    const summary = describeRestoreState(
      state({ plan: plan("applied"), verified: true })
    )
    expect(summary.title).toBe("已恢复并核实：当前数据库就是这份备份")
    expect(summary.detail).toContain("复验")
    expect(summary.tone).toBe("ok")
  })

  it("已应用但服务未确认核实：如实上报，不冒充已核实", () => {
    const summary = describeRestoreState(
      state({ plan: plan("applied"), verified: false })
    )
    expect(summary.title).toBe("计划显示已应用，但服务未确认核实结果")
    expect(summary.tone).toBe("danger")
  })

  it("失败、取消、结果未知各自说清后果", () => {
    expect(describeRestoreState(state({ plan: plan("failed") })).title).toBe(
      "恢复失败，当前数据库未被替换"
    )
    expect(describeRestoreState(state({ plan: plan("cancelled") })).title).toBe(
      "恢复计划已取消，当前数据库未变"
    )

    const unknown = describeRestoreState(state({ plan: plan("unknown") }))
    expect(unknown.title).toBe("恢复结果未知，需要重新核实")
    expect(unknown.detail).toContain("重启过程中进程被中断")
    expect(unknown.tone).toBe("danger")
  })
})

describe("恢复状态区", () => {
  it("结果未知时把服务端给的原因显示出来", () => {
    render(
      <RestoreStatusCard
        state={state({ plan: plan("unknown") })}
        loading={false}
        error={null}
      />
    )
    expect(screen.getByText("恢复结果未知，需要重新核实")).toBeTruthy()
    expect(screen.getByText(/重启过程中进程被中断/)).toBeTruthy()
  })

  it("状态读取失败时如实报错，不显示成没有计划", () => {
    render(<RestoreStatusCard state={null} loading={false} error="连接失败" />)
    expect(screen.getByText("恢复状态读取失败")).toBeTruthy()
    expect(screen.getByText("连接失败")).toBeTruthy()
    expect(screen.queryByText("当前没有恢复计划")).toBeNull()
  })
})
