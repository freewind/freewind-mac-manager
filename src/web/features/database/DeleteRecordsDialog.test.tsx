// @vitest-environment jsdom
import type { DatabaseTable } from "@shared/api-contract"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DeleteRecordsDialog,
  type DeleteRecordsDialogProps,
  type DeleteTarget,
} from "./DeleteRecordsDialog"

const table: DatabaseTable = {
  name: "items",
  kind: "table",
  rowCount: null,
  capabilities: [
    { operation: "read", allowed: true },
    { operation: "insert", allowed: true },
    { operation: "update", allowed: true },
    { operation: "delete", allowed: true },
  ],
  columns: [
    {
      name: "id",
      declaredType: "INTEGER",
      affinity: "integer",
      notNull: false,
      primaryKeyPosition: 1,
      generated: false,
      hidden: false,
      write: { allowed: true },
    },
  ],
  constraints: { primaryKey: ["id"], unique: [], foreignKeys: [], checks: [] },
  signature: "sig",
  withoutRowId: false,
  triggers: ["trg_items_after_delete"],
  referencedBy: [
    {
      table: "child",
      columns: ["item_id"],
      referencedColumns: ["id"],
      onDelete: "CASCADE",
      onUpdate: "NO ACTION",
    },
  ],
}

const target = (id: string): DeleteTarget => ({
  key: [{ column: "id", value: { type: "integer", value: id } }],
  expectedSignature: `sig-${id}`,
})

const renderDialog = (overrides: Partial<DeleteRecordsDialogProps> = {}) => {
  const props: DeleteRecordsDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    table,
    targets: [target("7")],
    busy: false,
    failure: null,
    unknownNotice: null,
    onVerify: vi.fn(),
    onDismissUnknown: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  }
  render(<DeleteRecordsDialog {...props} />)
  return props
}

afterEach(cleanup)

describe("DeleteRecordsDialog 对象与数量", () => {
  it("单条删除显示表名、完整主键与动作化按钮", async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    expect(screen.getByText("删除 1 条记录？")).toBeTruthy()
    expect(screen.getByText("items")).toBeTruthy()
    expect(screen.getByText("id=7")).toBeTruthy()
    const action = screen.getByRole("button", { name: "删除 1 条记录" })
    await user.click(action)
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
  })

  it("批量删除列出记录数、选中数量与前若干条主键", () => {
    renderDialog({ targets: [target("1"), target("2"), target("3")] })
    expect(screen.getByText("删除 3 条记录？")).toBeTruthy()
    expect(screen.getByText(/已选 3 条/)).toBeTruthy()
    for (const id of ["id=1", "id=2", "id=3"]) {
      expect(screen.getByText(id)).toBeTruthy()
    }
    expect(screen.getByRole("button", { name: "删除 3 条记录" })).toBeTruthy()
  })

  it("超过十条只列出前十条并说明其余数量", () => {
    const targets = Array.from({ length: 12 }, (_, index) =>
      target(String(index + 1))
    )
    renderDialog({ targets })
    expect(screen.getByText(/以及另外 2 条/)).toBeTruthy()
    expect(screen.getByText("id=1")).toBeTruthy()
    expect(screen.queryByText("id=11")).toBeNull()
  })

  it("提示外键级联与写触发器的额外影响", () => {
    renderDialog()
    expect(screen.getByText(/级联影响/)).toBeTruthy()
    expect(screen.getByText(/ON DELETE CASCADE/)).toBeTruthy()
    expect(screen.getByText(/trg_items_after_delete/)).toBeTruthy()
    // 批量删除是原子的
    expect(screen.getByText(/要么全部成功，要么整批回滚/)).toBeTruthy()
  })

  it("取消不发删除请求", async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(props.onConfirm).not.toHaveBeenCalled()
    // base-ui 的关闭回调可能带事件详情，只关心是否请求关闭
    expect(vi.mocked(props.onOpenChange).mock.calls[0]?.[0]).toBe(false)
  })
})

describe("DeleteRecordsDialog 失败与结果未知", () => {
  it("失败原因留在确认框里", () => {
    renderDialog({ failure: "请求失败（HTTP 409）：第 2 条记录已变化" })
    expect(screen.getByText("删除失败")).toBeTruthy()
    expect(screen.getByText(/第 2 条记录已变化/)).toBeTruthy()
  })

  it("结果未知时禁止再次删除，只能重新读取核实", async () => {
    const user = userEvent.setup()
    const props = renderDialog({
      unknownNotice: "写入结果未知：可能已经写入，请重新读取确认后再决定下一步",
    })
    const action = screen.getByRole("button", { name: "删除 1 条记录" })
    expect(action).toHaveProperty("disabled", true)
    await user.click(action)
    expect(props.onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "重新读取核实" }))
    expect(props.onVerify).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "已核对，继续" }))
    expect(props.onDismissUnknown).toHaveBeenCalledTimes(1)
  })

  it("删除中禁用按钮，防重复提交", async () => {
    const user = userEvent.setup()
    const props = renderDialog({ busy: true })
    const action = screen.getByRole("button", { name: /正在删除/ })
    expect(action).toHaveProperty("disabled", true)
    await user.click(action)
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
})
