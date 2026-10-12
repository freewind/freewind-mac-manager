// @vitest-environment jsdom
import type { DatabaseBackup } from "@shared/api-contract"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RestorePlanDialog } from "./RestorePlanDialog"

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

const SIGNATURE = `1234abcd${"e".repeat(24)}`

const backup = (over: Partial<DatabaseBackup> = {}): DatabaseBackup => ({
  id: "snap-1",
  fileName: "snapshots-1791700000000-aaa111.sqlite3",
  createdAt: 1_791_700_000_000,
  sizeBytes: 1_073_741_824,
  source: "manual",
  integrity: { ok: true },
  contentSignature: SIGNATURE,
  tableCount: 12,
  rowCount: 340,
  originalFileName: null,
  restoreBlockedReason: null,
  ...over,
})

/** 回调默认都是 spy：断言「停在确认框、没有提交」要有据可查。 */
const renderDialog = (
  over: Partial<Parameters<typeof RestorePlanDialog>[0]> = {}
) => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    backup: backup(),
    busy: false,
    failure: null,
    unknownNotice: null,
    backupCurrent: true,
    onBackupCurrentChange: vi.fn(),
    onVerify: vi.fn(),
    onDismissUnknown: vi.fn(),
    onConfirm: vi.fn(),
    ...over,
  }
  render(<RestorePlanDialog {...props} />)
  return props
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("恢复确认框", () => {
  it("写清目标备份的事实与备份签名前 8 位", () => {
    renderDialog()
    expect(
      screen.getByText("snapshots-1791700000000-aaa111.sqlite3")
    ).toBeTruthy()
    expect(screen.getByText(/1\.0 GB · 手工创建 · 创建于/)).toBeTruthy()
    expect(screen.getByText("规模：12 表 / 340 行")).toBeTruthy()
    expect(screen.getByText("文件完整性：完整")).toBeTruthy()
    // 只展示备份签名前 8 位；当前库签名不在确认阶段比对
    expect(screen.getByText("1234abcd…")).toBeTruthy()
    expect(screen.queryByText("当前数据库的签名")).toBeNull()
  })

  it("复制按钮复制完整签名，不是截断后的 8 位", async () => {
    const user = userEvent.setup()
    // userEvent 会装上自己的剪贴板实现，所以要在它之后换成 spy
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    })
    renderDialog()
    await user.click(screen.getByRole("button", { name: /复制完整签名/ }))
    expect(writeText).toHaveBeenCalledWith(SIGNATURE)
  })

  it("关键影响用大字说明：提交不等于已恢复", () => {
    renderDialog()
    expect(
      screen.getByText(
        "提交后不会立刻恢复：计划在下次启动应用时执行，届时当前数据库会被整份替换；重启前可以取消。"
      )
    ).toBeTruthy()
  })

  it("规模未统计时不冒充 0", () => {
    renderDialog({ backup: backup({ tableCount: null, rowCount: null }) })
    expect(screen.getByText("规模：尚未统计")).toBeTruthy()
  })

  it("按钮是动作化文案，暂不恢复不提交", async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    expect(
      screen.getByRole("button", { name: "安排在下次启动时恢复" })
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "暂不恢复" }))
    expect(props.onConfirm).not.toHaveBeenCalled()
    // base-ui 的关闭回调带事件详情，只关心是否请求关闭
    expect(vi.mocked(props.onOpenChange).mock.calls[0]?.[0]).toBe(false)
  })

  it("恢复前备份当前库默认勾选，可以改", async () => {
    const user = userEvent.setup()
    const onBackupCurrentChange = vi.fn()
    renderDialog({ onBackupCurrentChange })
    const checkbox = screen.getByRole("checkbox", { checked: true })
    await user.click(checkbox)
    expect(onBackupCurrentChange).toHaveBeenCalledWith(false)
  })

  it("不可用于恢复的备份不允许提交，并常驻说明原因", () => {
    renderDialog({
      backup: backup({ restoreBlockedReason: "缺少应用必要表" }),
    })
    expect(screen.getByText("这份备份不能用于恢复")).toBeTruthy()
    expect(screen.getByText(/缺少应用必要表/)).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "安排在下次启动时恢复",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })

  it("完整性不通过时也不允许提交", () => {
    renderDialog({
      backup: backup({ integrity: { ok: false, reason: "文件头损坏" } }),
    })
    expect(screen.getByText("文件完整性检查没有通过")).toBeTruthy()
    expect(screen.getByText("文件头损坏")).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "安排在下次启动时恢复",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })

  it("结果未知时禁止再次提交，只能重新读取核实", async () => {
    const user = userEvent.setup()
    const onVerify = vi.fn()
    renderDialog({ unknownNotice: "提交没有得到确认的响应", onVerify })
    expect(screen.getByText("结果未知")).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "安排在下次启动时恢复",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    await user.click(screen.getByRole("button", { name: "重新读取核实" }))
    expect(onVerify).toHaveBeenCalledTimes(1)
  })

  it("提交中按钮禁用，不重复提交", () => {
    renderDialog({ busy: true })
    expect(
      (screen.getByRole("button", { name: "正在提交…" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    expect(toast).not.toHaveBeenCalled()
  })
})
