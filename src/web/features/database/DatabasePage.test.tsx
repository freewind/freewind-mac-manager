// @vitest-environment jsdom
import type {
  DatabaseRecord,
  DatabaseRecordLocatorKey,
  DatabaseTable,
  DatabaseTableSummary,
} from "@shared/api-contract"
import { ApiRequestError } from "@shared/client-api"
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DatabasePage } from "./DatabasePage"

const api = vi.hoisted(() => ({
  fetchDatabaseTables: vi.fn(),
  fetchDatabaseTable: vi.fn(),
  fetchDatabaseRecords: vi.fn(),
  fetchDatabaseRecord: vi.fn(),
  createDatabaseRecord: vi.fn(),
  updateDatabaseRecord: vi.fn(),
  deleteDatabaseRecords: vi.fn(),
}))

vi.mock("@shared/client-api", async (original) => ({
  ...(await original<typeof import("@shared/client-api")>()),
  ...api,
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

/** jsdom 没有 matchMedia；false 表示窄屏，走 Sheet 详情那条路径。 */
const stubMatchMedia = (desktop: boolean): void => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

const allowed = { operation: "read" as const, allowed: true as const }

const summary = (
  name: string,
  kind: DatabaseTableSummary["kind"],
  capabilities: DatabaseTableSummary["capabilities"]
): DatabaseTableSummary => ({ name, kind, rowCount: null, capabilities })

const writableCapabilities: DatabaseTableSummary["capabilities"] = [
  allowed,
  { operation: "insert", allowed: true },
  { operation: "update", allowed: true },
  { operation: "delete", allowed: true },
]

const readonlyCapabilities: DatabaseTableSummary["capabilities"] = [
  allowed,
  {
    operation: "insert",
    allowed: false,
    reason: "no_primary_key",
    message: "没有显式可靠的非空唯一主键，无法安全定位单条记录，只读",
  },
  {
    operation: "update",
    allowed: false,
    reason: "no_primary_key",
    message: "没有显式可靠的非空唯一主键，无法安全定位单条记录，只读",
  },
  {
    operation: "delete",
    allowed: false,
    reason: "no_primary_key",
    message: "没有显式可靠的非空唯一主键，无法安全定位单条记录，只读",
  },
]

const tableDetail = (name: string): DatabaseTable => ({
  name,
  kind: "table",
  rowCount: null,
  capabilities: name === "nopk" ? readonlyCapabilities : writableCapabilities,
  columns: [
    {
      name: "id",
      declaredType: "INTEGER",
      affinity: "integer",
      notNull: false,
      primaryKeyPosition: name === "nopk" ? 0 : 1,
      generated: false,
      hidden: false,
      write: { allowed: true },
    },
    {
      name: "name",
      declaredType: "TEXT",
      affinity: "text",
      notNull: true,
      primaryKeyPosition: 0,
      generated: false,
      hidden: false,
      write: { allowed: true },
    },
    {
      name: "total",
      declaredType: "INTEGER",
      affinity: "integer",
      notNull: false,
      primaryKeyPosition: 0,
      generated: true,
      hidden: false,
      write: {
        allowed: false,
        reason: "generated",
        message: "生成列由数据库计算，不能写入",
      },
    },
  ],
  constraints: {
    primaryKey: name === "nopk" ? [] : ["id"],
    unique: [],
    foreignKeys: [],
    checks: [],
  },
  signature: "sig",
  withoutRowId: false,
  triggers: [],
  referencedBy: [],
})

const key: DatabaseRecordLocatorKey = [
  { column: "id", value: { type: "integer", value: "7" } },
]

const record: DatabaseRecord = {
  key,
  values: {
    id: { type: "integer", value: "7" },
    name: { type: "text", value: "apple" },
    total: { type: "integer", value: "14" },
  },
  signature: "row-signature-7",
}

const recordsBody = (total: number | null) => ({
  table: "items",
  records: [record],
  page: 1,
  pageSize: 50,
  total,
  signature: "sig",
})

const setOnline = (online: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    value: online,
    configurable: true,
  })
}

const setUrl = (search: string): void => {
  window.history.replaceState({}, "", `/${search}`)
}

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <DatabasePage />
    </QueryClientProvider>
  )
  return client
}

const pickFrom = async (label: string, option: string): Promise<void> => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("combobox", { name: label }))
  await user.click(await screen.findByRole("option", { name: option }))
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  // 每个用例都从在线开始：离线会暂停查询，而 onlineManager 是模块级单例，
  // 必须在用例之间显式恢复，否则后续用例的查询会一直处于暂停状态
  setOnline(true)
  onlineManager.setOnline(true)
  stubMatchMedia(false)
  setUrl("")
  api.fetchDatabaseTables.mockResolvedValue({
    tables: [
      summary("items", "table", writableCapabilities),
      summary("nopk", "table", readonlyCapabilities),
      summary("v_items", "view", readonlyCapabilities),
    ],
  })
  api.fetchDatabaseTable.mockImplementation(async (name: string) =>
    tableDetail(name)
  )
  api.fetchDatabaseRecords.mockResolvedValue(recordsBody(1))
  api.fetchDatabaseRecord.mockResolvedValue({ table: "items", record })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("DatabasePage 浏览", () => {
  it("提示直接操作底层数据，并给出表列表与最后读取时间", async () => {
    setUrl("?feature=database&dbTable=items")
    renderPage()
    expect(screen.getByText("直接操作底层数据")).toBeTruthy()
    expect(screen.getByText(/不会做业务校验/)).toBeTruthy()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    expect(screen.getByText(/最后读取/)).toBeTruthy()
    expect(api.fetchDatabaseTable).toHaveBeenCalledWith("items", {
      signal: expect.any(AbortSignal),
    })
  })

  it("展开表结构能看到字段、生成列与只读原因", async () => {
    setUrl("?feature=database&dbTable=nopk")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /表结构/ })).toBeTruthy()
    )
    await user.click(screen.getByRole("button", { name: /表结构/ }))
    expect(
      screen.getAllByText(/没有显式可靠的非空唯一主键/).length
    ).toBeGreaterThan(0)
    expect(screen.getByText("生成列")).toBeTruthy()
    expect(screen.getByText(/生成列由数据库计算/)).toBeTruthy()
    expect(screen.getByText("没有主键")).toBeTruthy()
  })

  it("表列表为空时给出明确空状态", async () => {
    api.fetchDatabaseTables.mockResolvedValue({ tables: [] })
    renderPage()
    await waitFor(() =>
      expect(screen.getByText("还没有可管理的表")).toBeTruthy()
    )
  })

  it("表列表读取失败时显示原因", async () => {
    // 4xx 不触发有界重试，错误立刻可见（5xx 的重试策略在 queries 单测里覆盖）
    api.fetchDatabaseTables.mockRejectedValue(
      new ApiRequestError("请求失败（HTTP 409）：操作未能完成", 409)
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("表列表读取失败")).toBeTruthy())
    expect(screen.getByText(/操作未能完成/)).toBeTruthy()
  })

  it("记录读取失败时显示原因，数量未知时不冒充 0", async () => {
    setUrl("?dbTable=items")
    api.fetchDatabaseRecords.mockRejectedValue(
      new ApiRequestError("请求失败（HTTP 409）：数据库结构已变化", 409)
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("记录读取失败")).toBeTruthy())
    expect(screen.getByText(/数据库结构已变化/)).toBeTruthy()

    cleanup()
    api.fetchDatabaseRecords.mockResolvedValue(recordsBody(null))
    renderPage()
    await waitFor(() => expect(screen.getByText(/数量未知/)).toBeTruthy())
  })

  it("刷新按钮重新读取当前数据", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() =>
      expect(api.fetchDatabaseTables).toHaveBeenCalledTimes(1)
    )
    await user.click(screen.getByRole("button", { name: /刷新/ }))
    await waitFor(() =>
      expect(api.fetchDatabaseTables.mock.calls.length).toBeGreaterThan(1)
    )
  })
})

describe("DatabasePage 筛选分页与切表", () => {
  it("筛选与翻页写进 URL 并触发新的查询", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())

    await user.type(screen.getByLabelText("取值"), "7")
    await user.click(screen.getByRole("button", { name: /添加筛选/ }))
    await waitFor(() =>
      expect(
        new URL(window.location.href).searchParams.get("dbFilters")
      ).toContain("id")
    )
    await waitFor(() =>
      expect(api.fetchDatabaseRecords).toHaveBeenLastCalledWith(
        "items",
        expect.objectContaining({
          filters: [
            {
              column: "id",
              operator: "eq",
              value: { type: "integer", value: "7" },
            },
          ],
        }),
        { signal: expect.any(AbortSignal) }
      )
    )
  })

  it("切换表时清空旧筛选", async () => {
    setUrl(
      "?dbTable=items&dbFilters=%5B%7B%22column%22%3A%22id%22%2C%22operator%22%3A%22eq%22%2C%22value%22%3A%7B%22type%22%3A%22integer%22%2C%22value%22%3A%227%22%7D%7D%5D"
    )
    renderPage()
    await waitFor(() => expect(api.fetchDatabaseTable).toHaveBeenCalled())
    await pickFrom("表", "nopk（表）")
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get("dbTable")).toBe(
        "nopk"
      )
    )
    expect(
      new URL(window.location.href).searchParams.get("dbFilters")
    ).toBeNull()
  })
})

describe("DatabasePage 记录详情", () => {
  it("打开详情后能看到字段与签名，关闭按钮能关掉", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    expect(screen.queryByText("记录签名")).toBeNull()

    await user.click(screen.getByRole("button", { name: "查看" }))
    await waitFor(() => expect(screen.getByText("记录签名")).toBeTruthy())
    expect(screen.getByText("row-signature-7")).toBeTruthy()
    expect(screen.getAllByText(/id=7/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByText("记录签名")).toBeNull())
  })

  it("返回键先关闭详情浮层", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await user.click(screen.getByRole("button", { name: "查看" }))
    await waitFor(() => expect(screen.getByText("记录签名")).toBeTruthy())

    window.history.back()
    await waitFor(() => expect(screen.queryByText("记录签名")).toBeNull())
  })
})

/** 打开记录详情，拿到窄屏 Sheet 里的操作按钮。 */
const openDetails = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "查看" }))
  await waitFor(() => expect(screen.getByText("记录签名")).toBeTruthy())
}

describe("DatabasePage 新增记录", () => {
  it("填写后按契约提交，成功后关闭并重新读取", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    const readsBefore = api.fetchDatabaseRecords.mock.calls.length

    await user.click(screen.getByRole("button", { name: /新增记录/ }))
    const dialog = await screen.findByRole("dialog")
    await user.type(
      within(dialog).getByRole("textbox", { name: /^name/ }),
      "banana"
    )
    await user.click(within(dialog).getByRole("button", { name: /新增记录/ }))

    await waitFor(() =>
      expect(api.createDatabaseRecord).toHaveBeenCalledWith("items", {
        values: { name: { type: "text", value: "banana" } },
      })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // 成功后失效并重新读取，不做乐观更新
    await waitFor(() =>
      expect(api.fetchDatabaseRecords.mock.calls.length).toBeGreaterThan(
        readsBefore
      )
    )
  })

  it("重复点击只发送一次", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    let resolveCreate: (value: unknown) => void = () => {}
    api.createDatabaseRecord.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve
      })
    )

    await user.click(screen.getByRole("button", { name: /新增记录/ }))
    const dialog = await screen.findByRole("dialog")
    const submit = within(dialog).getByRole("button", { name: /新增记录/ })
    await user.click(submit)
    await user.click(submit)
    expect(api.createDatabaseRecord).toHaveBeenCalledTimes(1)
    resolveCreate({ table: "items", record })
  })

  it("离线时禁止提交并说明原因", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await user.click(screen.getByRole("button", { name: /新增记录/ }))
    const dialog = await screen.findByRole("dialog")

    setOnline(false)
    window.dispatchEvent(new Event("offline"))
    await user.click(within(dialog).getByRole("button", { name: /新增记录/ }))
    expect(api.createDatabaseRecord).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.getAllByText(/当前离线，操作未发送/).length
      ).toBeGreaterThan(0)
    )
  })

  it("约束错误把原因留在表单里，草稿不丢", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    api.createDatabaseRecord.mockRejectedValue(
      new ApiRequestError("请求失败（HTTP 409）：违反唯一约束", 409)
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await user.click(screen.getByRole("button", { name: /新增记录/ }))
    const dialog = await screen.findByRole("dialog")
    const nameField = within(dialog).getByRole("textbox", { name: /^name/ })
    await user.type(nameField, "banana")
    await user.click(within(dialog).getByRole("button", { name: /新增记录/ }))

    await waitFor(() => expect(screen.getByText(/违反唯一约束/)).toBeTruthy())
    // 表单还在，草稿也在
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(nameField).toHaveProperty("value", "banana")
    expect(api.createDatabaseRecord).toHaveBeenCalledTimes(1)
  })

  it("结果未知时不重发，只能重新读取核实且不宣称成功", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    api.createDatabaseRecord.mockRejectedValue(
      new ApiRequestError(
        "写入超过 5000 毫秒，结果未知，请重新读取确认",
        500,
        { message: "结果未知", executionStatus: "unknown" },
        undefined,
        true
      )
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await user.click(screen.getByRole("button", { name: /新增记录/ }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: /新增记录/ }))

    await waitFor(() => expect(screen.getByText("结果未知")).toBeTruthy())
    expect(api.createDatabaseRecord).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled()
    const submit = within(dialog).getByRole("button", { name: /新增记录/ })
    expect(submit).toHaveProperty("disabled", true)

    const readsBefore = api.fetchDatabaseRecords.mock.calls.length
    await user.click(
      within(dialog).getByRole("button", { name: "重新读取核实" })
    )
    // 核实只是重新读取，不重发写入、也不报成功
    await waitFor(() =>
      expect(api.fetchDatabaseRecords.mock.calls.length).toBeGreaterThan(
        readsBefore
      )
    )
    expect(api.createDatabaseRecord).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled()
  })

  it("带未保存草稿时切换表被拦住，不默默丢弃", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await user.click(screen.getByRole("button", { name: /新增记录/ }))
    const dialog = await screen.findByRole("dialog")
    await user.type(
      within(dialog).getByRole("textbox", { name: /^name/ }),
      "draft"
    )

    // 有草稿时表选择被禁用，并给出说明，不会默默丢掉草稿
    await waitFor(() => expect(screen.getByText(/有未保存的草稿/)).toBeTruthy())
    expect(document.getElementById("database-table")).toHaveProperty(
      "disabled",
      true
    )
    expect(new URL(window.location.href).searchParams.get("dbTable")).toBe(
      "items"
    )
  })

  it("返回键先关闭表单浮层", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await user.click(screen.getByRole("button", { name: /新增记录/ }))
    await screen.findByRole("dialog")

    window.history.back()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})

describe("DatabasePage 修改记录", () => {
  it("只提交改动过的字段", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await openDetails(user)

    await user.click(screen.getByRole("button", { name: "修改记录" }))
    const dialog = await screen.findByRole("dialog")
    const nameField = within(dialog).getByRole("textbox", { name: /^name/ })
    await user.clear(nameField)
    await user.type(nameField, "cherry")
    await user.click(within(dialog).getByRole("button", { name: /保存修改/ }))

    await waitFor(() =>
      expect(api.updateDatabaseRecord).toHaveBeenCalledWith("items", {
        key,
        expectedSignature: record.signature,
        values: { name: { type: "text", value: "cherry" } },
      })
    )
  })

  it("没改动就提交空字段集合", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await openDetails(user)

    await user.click(screen.getByRole("button", { name: "修改记录" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: /保存修改/ }))
    await waitFor(() =>
      expect(api.updateDatabaseRecord).toHaveBeenCalledWith("items", {
        key,
        expectedSignature: record.signature,
        values: {},
      })
    )
  })
})

describe("DatabasePage 删除记录", () => {
  it("单条删除显示对象并提交完整主键与签名", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await openDetails(user)

    await user.click(screen.getByRole("button", { name: "删除记录" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("删除 1 条记录？")).toBeTruthy()
    expect(within(dialog).getByText("id=7")).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: "删除 1 条记录" })
    )
    await waitFor(() =>
      expect(api.deleteDatabaseRecords).toHaveBeenCalledWith("items", {
        items: [{ key, expectedSignature: record.signature }],
      })
    )
  })

  it("当前页勾选后可以批量删除", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await user.click(screen.getByRole("checkbox", { name: "选择记录 id=7" }))
    await user.click(screen.getByRole("button", { name: /删除选中 1 条/ }))

    const dialog = await screen.findByRole("alertdialog")
    await user.click(
      within(dialog).getByRole("button", { name: "删除 1 条记录" })
    )
    await waitFor(() =>
      expect(api.deleteDatabaseRecords).toHaveBeenCalledWith("items", {
        items: [{ key, expectedSignature: record.signature }],
      })
    )
  })

  it("取消不发删除请求", async () => {
    setUrl("?dbTable=items")
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText("apple")).toBeTruthy())
    await openDetails(user)
    await user.click(screen.getByRole("button", { name: "删除记录" }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "取消" }))
    expect(api.deleteDatabaseRecords).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("只读表禁止删除与修改", async () => {
    setUrl("?dbTable=nopk")
    const user = userEvent.setup()
    api.fetchDatabaseRecords.mockResolvedValue({
      ...recordsBody(1),
      table: "nopk",
      records: [
        {
          // 没有可靠主键的表：记录主键是空数组
          key: [],
          values: {
            id: { type: "integer", value: "1" },
            name: { type: "text", value: "only" },
            total: { type: "integer", value: "2" },
          },
          signature: "row-sig-nopk",
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.getByText("only")).toBeTruthy())
    await user.click(screen.getByRole("button", { name: "查看" }))
    await waitFor(() => expect(screen.getByText("记录签名")).toBeTruthy())
    expect(screen.getByRole("button", { name: "修改记录" })).toHaveProperty(
      "disabled",
      true
    )
    expect(screen.getByRole("button", { name: "删除记录" })).toHaveProperty(
      "disabled",
      true
    )
    expect(screen.getByText(/不能删除：/)).toBeTruthy()
  })
})
