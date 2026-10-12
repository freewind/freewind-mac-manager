// @vitest-environment jsdom
import type { DatabaseRecord, DatabaseTable } from "@shared/api-contract"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  emptyRecordForm,
  type RecordFormState,
  recordFormFromRecord,
} from "./form-values"
import {
  RecordFormDialog,
  type RecordFormDialogProps,
} from "./RecordFormDialog"

const column = (
  name: string,
  affinity: DatabaseTable["columns"][number]["affinity"],
  extra: Partial<DatabaseTable["columns"][number]> = {}
): DatabaseTable["columns"][number] => ({
  name,
  declaredType: affinity.toUpperCase(),
  affinity,
  notNull: false,
  primaryKeyPosition: 0,
  generated: false,
  hidden: false,
  write: { allowed: true },
  ...extra,
})

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
    column("id", "integer", { primaryKeyPosition: 1 }),
    column("name", "text", { notNull: true }),
    column("qty", "integer", {
      notNull: true,
      defaultValue: { type: "integer", value: "0" },
    }),
    column("note", "text"),
    column("total", "integer", {
      generated: true,
      write: {
        allowed: false,
        reason: "generated",
        message: "生成列由数据库计算，不能写入",
      },
    }),
    column("payload", "blob", {
      write: {
        allowed: false,
        reason: "blob_read_only",
        message: "首期 BLOB 只读",
      },
    }),
  ],
  constraints: { primaryKey: ["id"], unique: [], foreignKeys: [], checks: [] },
  signature: "sig",
  withoutRowId: false,
  triggers: [],
  referencedBy: [],
}

const record: DatabaseRecord = {
  key: [{ column: "id", value: { type: "integer", value: "7" } }],
  values: {
    id: { type: "integer", value: "7" },
    name: { type: "text", value: "apple" },
    qty: { type: "integer", value: "3" },
    note: { type: "null" },
    total: { type: "integer", value: "6" },
    payload: { type: "blob", base64: "QUJD" },
  },
  signature: "row-sig",
}

const recordWithNote: DatabaseRecord = {
  ...record,
  values: {
    ...record.values,
    note: { type: "text", value: "x" },
  },
}

/** 与页面一致：草稿由外层持有，子组件只上报「改了哪一列」。 */
const Harness = (
  props: Omit<RecordFormDialogProps, "state" | "onChangeColumn"> & {
    initial: RecordFormState
  }
) => {
  const [state, setState] = useState(props.initial)
  return (
    <RecordFormDialog
      {...props}
      state={state}
      onChangeColumn={(name, next) =>
        setState((previous) => ({ ...previous, [name]: next }))
      }
    />
  )
}

const renderDialog = (overrides: Partial<RecordFormDialogProps> = {}) => {
  const recordValue = overrides.record ?? null
  const initial =
    recordValue === null
      ? emptyRecordForm(table)
      : recordFormFromRecord(table, recordValue)
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    table,
    record: recordValue,
    busy: false,
    failure: null,
    unknownNotice: null,
    onVerify: vi.fn(),
    onDismissUnknown: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  }
  render(<Harness {...props} initial={initial} />)
  return props
}

const nameField = () => screen.getByRole("textbox", { name: /^name/ })
const noteMode = () => screen.getByRole("combobox", { name: "note 取值方式" })
const nullCheckbox = () => screen.getByRole("checkbox", { name: "设为 NULL" })

const pickMode = async (label: string, option: string): Promise<void> => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("combobox", { name: label }))
  await user.click(await screen.findByRole("option", { name: option }))
}

afterEach(cleanup)

describe("RecordFormDialog 新增", () => {
  it("按真实字段生成输入，生成列与 BLOB 列只读", () => {
    renderDialog()
    expect(nameField()).toBeTruthy()
    // 有默认值的列默认「用默认值」，可空列默认 NULL
    expect(screen.getByRole("combobox", { name: "qty 取值方式" })).toBeTruthy()
    expect(noteMode()).toBeTruthy()
    // 生成列与 BLOB 列只出现在只读区
    expect(
      screen.getAllByText("生成列由数据库计算，不能写入").length
    ).toBeGreaterThan(0)
    expect(screen.getAllByText("首期 BLOB 只读").length).toBeGreaterThan(0)
    expect(screen.queryByRole("textbox", { name: /^total/ })).toBeNull()
    expect(screen.queryByRole("textbox", { name: /^payload/ })).toBeNull()
  })

  it("省略的列不进请求，默认值列与 NULL 列按选择提交", async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.type(nameField(), "apple")
    await user.click(screen.getByRole("button", { name: /新增记录/ }))
    // qty 省略：交给数据库默认值；note 默认 NULL
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: { type: "text", value: "apple" },
      note: { type: "null" },
    })
  })

  it("主键可以自己填，也可以交给数据库生成", async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.type(nameField(), "apple")
    await pickMode("id 取值方式", "输入值")
    await user.type(
      screen.getByRole("textbox", { name: /^id/ }),
      "9007199254740993"
    )
    await user.click(screen.getByRole("button", { name: /新增记录/ }))
    expect(props.onSubmit).toHaveBeenCalledWith({
      id: { type: "integer", value: "9007199254740993" },
      name: { type: "text", value: "apple" },
      note: { type: "null" },
    })
  })

  it("空字符串会作为值提交，与 NULL 区分", async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    // name 留空：提交空串；note 填值：提交文本
    await pickMode("note 取值方式", "输入值")
    await user.type(screen.getByRole("textbox", { name: /^note/ }), "写点东西")
    await user.click(screen.getByRole("button", { name: /新增记录/ }))
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: { type: "text", value: "" },
      note: { type: "text", value: "写点东西" },
    })
  })

  it("字段级错误留在表单里，不发请求", () => {
    const props = renderDialog()
    fireEvent.change(nameField(), {
      target: { value: "a".repeat(70 * 1024) },
    })
    fireEvent.click(screen.getByRole("button", { name: /新增记录/ }))
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/超过单值上限/)).toBeTruthy()
  })
})

describe("RecordFormDialog 修改", () => {
  it("主键只读，只提交改动过的字段", async () => {
    const user = userEvent.setup()
    const props = renderDialog({ record })
    // 主键不提供输入，只作为只读值展示
    expect(screen.queryByRole("textbox", { name: /^id/ })).toBeNull()
    expect(screen.getByText("7")).toBeTruthy()

    await user.clear(nameField())
    await user.type(nameField(), "banana")
    await user.click(screen.getByRole("button", { name: /保存修改/ }))
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: { type: "text", value: "banana" },
    })
  })

  it("没改动就提交空对象，不会把整行都发出去", async () => {
    const user = userEvent.setup()
    const props = renderDialog({ record })
    await user.click(screen.getByRole("button", { name: /保存修改/ }))
    expect(props.onSubmit).toHaveBeenCalledWith({})
  })

  it("把 NULL 改成空串时提交空文本，不是 NULL", async () => {
    const user = userEvent.setup()
    const props = renderDialog({ record })
    // 取消「设为 NULL」后就是空串，与 NULL 严格区分
    await user.click(nullCheckbox())
    await user.click(screen.getByRole("button", { name: /保存修改/ }))
    expect(props.onSubmit).toHaveBeenCalledWith({
      note: { type: "text", value: "" },
    })
  })

  it("把有值的列改成 NULL 会提交显式 NULL", async () => {
    const user = userEvent.setup()
    const props = renderDialog({ record: recordWithNote })
    expect(screen.getByRole("textbox", { name: /^note/ })).toHaveProperty(
      "value",
      "x"
    )
    await user.click(nullCheckbox())
    await user.click(screen.getByRole("button", { name: /保存修改/ }))
    expect(props.onSubmit).toHaveBeenCalledWith({
      note: { type: "null" },
    })
  })

  it("本来就是 NULL 的列不因为残留文本被当成改动", async () => {
    const user = userEvent.setup()
    const props = renderDialog({ record })
    await user.click(screen.getByRole("button", { name: /保存修改/ }))
    expect(props.onSubmit).toHaveBeenCalledWith({})
  })
})

describe("RecordFormDialog 失败与结果未知", () => {
  it("失败原因留在表单里，草稿不丢", async () => {
    const user = userEvent.setup()
    renderDialog({
      record,
      failure: "请求失败（HTTP 409）：违反唯一约束（items.name）",
    })
    expect(screen.getByText("提交失败")).toBeTruthy()
    expect(screen.getByText(/违反唯一约束/)).toBeTruthy()
    await user.clear(nameField())
    await user.type(nameField(), "banana")
    expect(nameField()).toHaveProperty("value", "banana")
  })

  it("结果未知时禁止再次提交，只能重新读取核实", async () => {
    const user = userEvent.setup()
    const props = renderDialog({
      record,
      unknownNotice: "写入结果未知：可能已经写入，请重新读取确认后再决定下一步",
    })
    expect(screen.getByText("结果未知")).toBeTruthy()
    const submit = screen.getByRole("button", { name: /保存修改/ })
    expect(submit).toHaveProperty("disabled", true)
    await user.click(submit)
    expect(props.onSubmit).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "重新读取核实" }))
    expect(props.onVerify).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "已核对，继续" }))
    expect(props.onDismissUnknown).toHaveBeenCalledTimes(1)
  })

  it("提交中禁用按钮，防重复提交", async () => {
    const user = userEvent.setup()
    const props = renderDialog({ record, busy: true })
    const submit = screen.getByRole("button", { name: /正在保存/ })
    expect(submit).toHaveProperty("disabled", true)
    await user.click(submit)
    expect(props.onSubmit).not.toHaveBeenCalled()
  })
})
