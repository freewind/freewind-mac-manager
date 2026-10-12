// @vitest-environment jsdom
import type { DatabaseRecord, DatabaseTable } from "@shared/api-contract"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { recordKeyFingerprint } from "./format"
import { RecordList, type RecordListProps } from "./RecordList"

const stubMatchMedia = (): void => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

const column = (
  name: string,
  declaredType: string,
  affinity: DatabaseTable["columns"][number]["affinity"],
  extra: Partial<DatabaseTable["columns"][number]> = {}
): DatabaseTable["columns"][number] => ({
  name,
  declaredType,
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
    column("id", "INTEGER", "integer", { primaryKeyPosition: 1 }),
    column("name", "TEXT", "text", { notNull: true }),
    column("note", "TEXT", "text"),
    column("payload", "BLOB", "blob", {
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

const bigId = "9007199254740993"

const records: DatabaseRecord[] = [
  {
    key: [{ column: "id", value: { type: "integer", value: bigId } }],
    values: {
      id: { type: "integer", value: bigId },
      name: { type: "text", value: "apple" },
      note: { type: "null" },
      payload: { type: "blob", base64: "QUJD" },
    },
    signature: "sig-1",
  },
  {
    key: [{ column: "id", value: { type: "integer", value: "2" } }],
    values: {
      id: { type: "integer", value: "2" },
      name: { type: "text", value: "" },
      note: { type: "text", value: "n".repeat(120) },
      payload: { type: "null" },
    },
    signature: "sig-2",
  },
]

const renderList = (overrides: Partial<RecordListProps> = {}) => {
  const props: RecordListProps = {
    table,
    records,
    total: 2,
    pending: false,
    error: null,
    page: 1,
    pageSize: 50,
    filters: [],
    sorts: [],
    selectedKey: null,
    checkedFingerprints: new Set<string>(),
    canDelete: true,
    deleteBusy: false,
    onToggleChecked: vi.fn(),
    onClearChecked: vi.fn(),
    onRequestDeleteChecked: vi.fn(),
    onSelectRecord: vi.fn(),
    onFiltersChange: vi.fn(),
    onSortsChange: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...overrides,
  }
  render(<RecordList {...props} />)
  return props
}

const pickFrom = async (label: string, option: string): Promise<void> => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("combobox", { name: label }))
  await user.click(await screen.findByRole("option", { name: option }))
}

beforeEach(() => stubMatchMedia())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("RecordList 取值展示", () => {
  it("区分 NULL、空字符串、整数与 BLOB", () => {
    renderList()
    // NULL 与空串必须能分开看
    expect(screen.getAllByText("NULL").length).toBeGreaterThan(0)
    expect(screen.getByText("空字符串")).toBeTruthy()
    // 大整数按十进制字符串原样展示，不经过 Number
    expect(screen.getByText(bigId)).toBeTruthy()
    expect(screen.getByText("BLOB 3 字节")).toBeTruthy()
  })

  it("长内容先折叠，展开后看全文", async () => {
    const user = userEvent.setup()
    renderList()
    expect(screen.queryByText("n".repeat(120))).toBeNull()
    await user.click(screen.getByRole("button", { name: "展开" }))
    expect(screen.getByText("n".repeat(120))).toBeTruthy()
    expect(screen.getByRole("button", { name: "收起" })).toBeTruthy()
  })

  it("读取失败与空结果显示明确状态", () => {
    renderList({ error: new Error("记录读取失败：表结构已变化") })
    expect(screen.getByText("记录读取失败")).toBeTruthy()
    expect(screen.getByText(/表结构已变化/)).toBeTruthy()

    cleanup()
    renderList({ records: [], total: 0 })
    expect(screen.getByText("没有符合条件的记录")).toBeTruthy()
  })

  it("数量未知时明确说明，不冒充 0", () => {
    renderList({ total: null })
    expect(screen.getByText(/数量未知/)).toBeTruthy()
  })
})

describe("RecordList 筛选排序分页", () => {
  it("添加筛选时按列的亲和性构造取值", async () => {
    const user = userEvent.setup()
    const props = renderList()
    await user.type(screen.getByLabelText("取值"), "7")
    await user.click(screen.getByRole("button", { name: /添加筛选/ }))
    expect(props.onFiltersChange).toHaveBeenCalledWith([
      { column: "id", operator: "eq", value: { type: "integer", value: "7" } },
    ])
  })

  it("展示并移除已生效的筛选", async () => {
    const user = userEvent.setup()
    const props = renderList({
      filters: [
        {
          column: "name",
          operator: "contains",
          value: { type: "text", value: "ap" },
        },
      ],
    })
    expect(screen.getByText(/name 包含 ap/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "移除筛选 name" }))
    expect(props.onFiltersChange).toHaveBeenCalledWith([])
  })

  it("选择排序字段时带上方向", async () => {
    const props = renderList()
    await pickFrom("排序字段", "name")
    expect(props.onSortsChange).toHaveBeenCalledWith([
      { column: "name", direction: "asc" },
    ])
  })

  it("翻页与每页条数都走 URL 状态回调", async () => {
    const user = userEvent.setup()
    const props = renderList({ total: 100 })
    await user.click(screen.getByRole("button", { name: "下一页" }))
    expect(props.onPageChange).toHaveBeenCalledWith(2)
    expect(screen.getByRole("button", { name: "上一页" })).toHaveProperty(
      "disabled",
      true
    )
    await pickFrom("每页", "20 条")
    expect(props.onPageSizeChange).toHaveBeenCalledWith(20)
  })
})

describe("RecordList 当前页勾选与详情入口", () => {
  it("勾选把记录交给页面，计数由页面状态驱动", async () => {
    const user = userEvent.setup()
    const props = renderList()
    expect(screen.queryByText(/已选/)).toBeNull()
    await user.click(
      screen.getByRole("checkbox", { name: `选择记录 id=${bigId}` })
    )
    expect(props.onToggleChecked).toHaveBeenCalledWith(records[0], true)
    // 勾选状态由页面持有，这里不自己记
    expect(screen.queryByText(/已选/)).toBeNull()
  })

  it("已选数量、取消选择与批量删除入口都走页面回调", async () => {
    const user = userEvent.setup()
    const props = renderList({
      checkedFingerprints: new Set([recordKeyFingerprint(records[0].key)]),
    })
    expect(screen.getByText(/已选 1 条/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: /删除选中 1 条/ }))
    expect(props.onRequestDeleteChecked).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "取消选择" }))
    expect(props.onClearChecked).toHaveBeenCalledTimes(1)
  })

  it("表不支持删除时批量删除按钮禁用", () => {
    renderList({
      canDelete: false,
      checkedFingerprints: new Set([recordKeyFingerprint(records[0].key)]),
    })
    expect(
      screen.getByRole("button", { name: /删除选中 1 条/ })
    ).toHaveProperty("disabled", true)
  })

  it("查看按钮把主键交给详情", async () => {
    const user = userEvent.setup()
    const props = renderList()
    await user.click(screen.getAllByRole("button", { name: "查看" })[0])
    expect(props.onSelectRecord).toHaveBeenCalledWith([
      { column: "id", value: { type: "integer", value: bigId } },
    ])
  })
})
