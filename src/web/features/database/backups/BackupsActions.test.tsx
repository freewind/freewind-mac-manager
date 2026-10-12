// @vitest-environment jsdom
import type {
  DatabaseBackup,
  DatabaseBackupsResponse,
  DatabaseRestoreState,
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
import { clearPendingRequests } from "@web/features/tasks/pending-requests"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackupsPanel } from "./BackupsPanel"

const api = vi.hoisted(() => ({
  fetchDatabaseBackups: vi.fn(),
  fetchDatabaseRestoreState: vi.fn(),
  createDatabaseBackup: vi.fn(),
  uploadDatabaseBackup: vi.fn(),
  downloadDatabaseBackup: vi.fn(),
  deleteDatabaseBackups: vi.fn(),
  planDatabaseRestore: vi.fn(),
  cancelDatabaseRestore: vi.fn(),
}))

vi.mock("@shared/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/client-api")>()),
  ...api,
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

const SIGNATURE_A = "a".repeat(32)
const SIGNATURE_B = "b".repeat(32)
const FILE_A = "snapshots-1791700000000-aaa111.sqlite3"
const FILE_B = "snapshots-1791600000000-bbb222.sqlite3"

const backup = (over: Partial<DatabaseBackup> = {}): DatabaseBackup => ({
  id: "snap-1",
  fileName: FILE_A,
  createdAt: 1_791_700_000_000,
  sizeBytes: 1_073_741_824,
  source: "manual",
  integrity: { ok: true },
  contentSignature: SIGNATURE_A,
  tableCount: 12,
  rowCount: 340,
  originalFileName: null,
  restoreBlockedReason: null,
  ...over,
})

const listBody = (backups: DatabaseBackup[]): DatabaseBackupsResponse => ({
  backups,
  page: 1,
  pageSize: 50,
  total: backups.length,
  directory: "/tmp/backups",
  totalBytes: backups.reduce((sum, item) => sum + item.sizeBytes, 0),
})

const restorePlan = (
  status: NonNullable<DatabaseRestoreState["plan"]>["status"]
): NonNullable<DatabaseRestoreState["plan"]> => ({
  id: "restore-plan-1",
  backupId: "snap-1",
  backupFileName: FILE_A,
  status,
  createdAt: 1_791_700_000_000,
  updatedAt: 1_791_700_100_000,
  message: "重启服务后生效",
  unknownReason: status === "unknown" ? "重启过程中进程被中断" : null,
})

const idleRestore: DatabaseRestoreState = {
  plan: null,
  currentSignature: null,
  verified: false,
}

/** 结果未知：既不是成功也不是失败。 */
const unknownError = (): ApiRequestError =>
  new ApiRequestError(
    "等待响应超时，结果未知，请重新读取确认",
    null,
    undefined,
    undefined,
    true
  )

const conflict = (code: string, message: string): ApiRequestError =>
  new ApiRequestError(`请求失败（HTTP 409）：${message}`, 409, {
    message,
    code,
  })

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

const mount = () =>
  render(
    <QueryClientProvider client={createClient()}>
      <BackupsPanel />
    </QueryClientProvider>
  )

const selectRow = async (
  user: ReturnType<typeof userEvent.setup>,
  fileName: string
): Promise<void> => {
  await user.click(screen.getByRole("checkbox", { name: `选中 ${fileName}` }))
}

const waitForList = async (fileName = FILE_A): Promise<void> => {
  await screen.findByText(fileName)
}

beforeEach(() => {
  clearPendingRequests()
  onlineManager.setOnline(true)
  api.fetchDatabaseBackups.mockResolvedValue(listBody([backup()]))
  api.fetchDatabaseRestoreState.mockResolvedValue(idleRestore)
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock"),
    configurable: true,
    writable: true,
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  clearPendingRequests()
  vi.clearAllMocks()
})

describe("删除备份", () => {
  it("确认框逐条列出对象与影响，按下去之前不提交", async () => {
    const user = userEvent.setup()
    mount()
    await waitForList()
    await selectRow(user, FILE_A)
    await user.click(screen.getByRole("button", { name: /删除选中的 1 份/ }))

    const dialog = within(await screen.findByRole("alertdialog"))
    expect(dialog.getByText("删除 1 份备份？")).toBeTruthy()
    // 文件名 · 大小 · 来源 · 时间
    expect(
      dialog.getByText(/snapshots-1791700000000-aaa111\.sqlite3/)
    ).toBeTruthy()
    expect(
      dialog.getByText(/1\.0 GB · 手工创建 · \d{4}-\d{2}-\d{2}/)
    ).toBeTruthy()
    expect(
      dialog.getByText(/共 1 份，合计 1\.0 GB；其中 1 份本来可用于恢复。/)
    ).toBeTruthy()
    expect(dialog.getByText(/删除不可恢复/)).toBeTruthy()

    // 停在确认框：还没有提交
    expect(api.deleteDatabaseBackups).not.toHaveBeenCalled()

    await user.click(dialog.getByRole("button", { name: "删除这 1 份备份" }))
    await waitFor(() =>
      expect(api.deleteDatabaseBackups).toHaveBeenCalledWith({
        items: [{ id: "snap-1", expectedSignature: SIGNATURE_A }],
      })
    )
  })

  it("提交后以重新读取的列表为准，不做本地假删", async () => {
    api.deleteDatabaseBackups.mockResolvedValue({
      deleted: ["snap-1"],
      failed: [],
    })
    const user = userEvent.setup()
    mount()
    await waitForList()
    await selectRow(user, FILE_A)
    await user.click(screen.getByRole("button", { name: /删除选中的 1 份/ }))
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "删除这 1 份备份",
      })
    )

    // 服务端这次仍然返回同一份（说明它并没有真的删掉）：界面必须照实显示，不能自己抹掉
    await waitFor(() =>
      expect(api.fetchDatabaseBackups).toHaveBeenCalledTimes(2)
    )
    expect(await screen.findByText(FILE_A)).toBeTruthy()
    expect(await screen.findByText("已删除 1 份备份")).toBeTruthy()
  })

  it("部分失败逐条列出，失败条目保持选中", async () => {
    api.fetchDatabaseBackups.mockResolvedValue(
      listBody([backup(), backup({ id: "snap-2", fileName: FILE_B })])
    )
    api.deleteDatabaseBackups.mockResolvedValue({
      deleted: ["snap-1"],
      failed: [{ id: "snap-2", message: "备份内容签名与提交的不一致" }],
    })
    const user = userEvent.setup()
    mount()
    await waitForList(FILE_B)
    await selectRow(user, FILE_A)
    await selectRow(user, FILE_B)
    await user.click(screen.getByRole("button", { name: /删除选中的 2 份/ }))
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "删除这 2 份备份",
      })
    )

    expect(
      await screen.findByText("删除了 1 份，另有 1 份没有删除")
    ).toBeTruthy()
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent === `${FILE_B}：备份内容签名与提交的不一致`
      )
    ).toBeTruthy()
    // 失败的那一份还选着，可以看清后重新处理
    expect(screen.getByRole("button", { name: /删除选中的 1 份/ })).toBeTruthy()
    expect(
      screen.getByRole("checkbox", { name: `选中 ${FILE_B}`, checked: true })
    ).toBeTruthy()
  })

  it("一份都没删掉时标题写「没有删除任何备份」，绝不写删除成功", async () => {
    api.deleteDatabaseBackups.mockResolvedValue({
      deleted: [],
      failed: [{ id: "snap-1", message: "备份不存在" }],
    })
    const user = userEvent.setup()
    mount()
    await waitForList()
    await selectRow(user, FILE_A)
    await user.click(screen.getByRole("button", { name: /删除选中的 1 份/ }))
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "删除这 1 份备份",
      })
    )

    expect(await screen.findByText("没有删除任何备份")).toBeTruthy()
    expect(screen.queryByText(/删除成功/)).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("整批失败留在确认框里，说明没有提交成功", async () => {
    api.deleteDatabaseBackups.mockRejectedValue(
      new ApiRequestError("请求失败（HTTP 500）：内部错误", 500, {
        message: "内部错误",
      })
    )
    const user = userEvent.setup()
    mount()
    await waitForList()
    await selectRow(user, FILE_A)
    await user.click(screen.getByRole("button", { name: /删除选中的 1 份/ }))
    const dialog = within(await screen.findByRole("alertdialog"))
    await user.click(dialog.getByRole("button", { name: "删除这 1 份备份" }))

    expect(await dialog.findByText("删除没有提交成功")).toBeTruthy()
    expect(dialog.getByText(/HTTP 500/)).toBeTruthy()
    // 还在确认框里，没有装作已经删除
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(screen.queryByText("没有删除任何备份")).toBeNull()
  })

  it("结果未知时禁止再次提交，只能重新读取核实", async () => {
    api.deleteDatabaseBackups.mockRejectedValue(unknownError())
    const user = userEvent.setup()
    mount()
    await waitForList()
    await selectRow(user, FILE_A)
    await user.click(screen.getByRole("button", { name: /删除选中的 1 份/ }))
    const dialog = within(await screen.findByRole("alertdialog"))
    await user.click(dialog.getByRole("button", { name: "删除这 1 份备份" }))

    expect(await dialog.findByText("结果未知")).toBeTruthy()
    expect(
      (
        dialog.getByRole("button", {
          name: "删除这 1 份备份",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
    expect(dialog.queryByText("删除没有提交成功")).toBeNull()

    await user.click(dialog.getByRole("button", { name: "重新读取核实" }))
    await waitFor(() =>
      expect(api.fetchDatabaseBackups).toHaveBeenCalledTimes(2)
    )
  })
})

describe("提交恢复计划", () => {
  it("确认框写清影响与签名，确认后带签名提交且不说已恢复", async () => {
    api.fetchDatabaseRestoreState.mockResolvedValue({
      plan: null,
      currentSignature: SIGNATURE_B,
      verified: false,
    })
    api.planDatabaseRestore.mockResolvedValue(restorePlan("planned"))
    const user = userEvent.setup()
    mount()
    await waitForList()
    await user.click(screen.getByRole("button", { name: /^恢复$/ }))

    const dialog = within(await screen.findByRole("alertdialog"))
    expect(
      dialog.getByText(
        "提交后不会立刻恢复：计划在下次启动应用时执行，届时当前数据库会被整份替换；重启前可以取消。"
      )
    ).toBeTruthy()
    expect(dialog.getByText("aaaaaaaa…")).toBeTruthy()
    expect(dialog.getByText("bbbbbbbb…")).toBeTruthy()
    expect(
      dialog.getByText(
        "当前数据库与这份备份不同：恢复会用这份备份整份替换当前数据库"
      )
    ).toBeTruthy()
    // 停在确认框
    expect(api.planDatabaseRestore).not.toHaveBeenCalled()

    await user.click(
      dialog.getByRole("button", { name: "安排在下次启动时恢复" })
    )
    await waitFor(() =>
      expect(api.planDatabaseRestore).toHaveBeenCalledWith({
        backupId: "snap-1",
        expectedSignature: SIGNATURE_A,
        backupCurrent: true,
      })
    )
    expect(toast.success).toHaveBeenCalledWith("恢复计划已创建，重启后生效")
    const texts = vi
      .mocked(toast.success)
      .mock.calls.map((call) => String(call[0]))
      .join(" ")
    expect(texts).not.toContain("已恢复")
    // 提交之后重新读取恢复状态
    await waitFor(() =>
      expect(api.fetchDatabaseRestoreState).toHaveBeenCalledTimes(2)
    )
  })

  it("签名不匹配（409）：说清备份被换过，不谎称计划已建立", async () => {
    api.planDatabaseRestore.mockRejectedValue(
      conflict("signature_mismatch", "备份内容签名与计划不一致，可能已被替换")
    )
    const user = userEvent.setup()
    mount()
    await waitForList()
    await user.click(screen.getByRole("button", { name: /^恢复$/ }))
    const dialog = within(await screen.findByRole("alertdialog"))
    await user.click(
      dialog.getByRole("button", { name: "安排在下次启动时恢复" })
    )

    expect(await dialog.findByText("没有建立恢复计划")).toBeTruthy()
    expect(
      dialog.getByText(/备份内容签名与计划不一致，可能已被替换/)
    ).toBeTruthy()
    expect(dialog.getByText(/这份备份在选中之后被改过/)).toBeTruthy()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("已有计划（409）：说清等待执行或正在执行", async () => {
    api.planDatabaseRestore.mockRejectedValue(
      conflict(
        "restore_plan_pending",
        "已有恢复计划在等待执行，请先取消或等它完成"
      )
    )
    const user = userEvent.setup()
    mount()
    await waitForList()
    await user.click(screen.getByRole("button", { name: /^恢复$/ }))
    const dialog = within(await screen.findByRole("alertdialog"))
    await user.click(
      dialog.getByRole("button", { name: "安排在下次启动时恢复" })
    )

    expect(await dialog.findByText(/这次没有建立新计划/)).toBeTruthy()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("结果未知：既不报成功也不报失败，只给重新读取核实", async () => {
    api.planDatabaseRestore.mockRejectedValue(unknownError())
    const user = userEvent.setup()
    mount()
    await waitForList()
    await user.click(screen.getByRole("button", { name: /^恢复$/ }))
    const dialog = within(await screen.findByRole("alertdialog"))
    await user.click(
      dialog.getByRole("button", { name: "安排在下次启动时恢复" })
    )

    expect(await dialog.findByText("结果未知")).toBeTruthy()
    expect(dialog.queryByText("没有建立恢复计划")).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
    expect(
      (
        dialog.getByRole("button", {
          name: "安排在下次启动时恢复",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })

  it("不可用于恢复的备份没有恢复入口，但删除保持可用", async () => {
    api.fetchDatabaseBackups.mockResolvedValue(
      listBody([backup({ restoreBlockedReason: "缺少应用必要表" })])
    )
    const user = userEvent.setup()
    mount()
    await waitForList()
    expect(
      (screen.getByRole("button", { name: /^恢复$/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    expect(
      (screen.getByRole("button", { name: /^下载$/ }) as HTMLButtonElement)
        .disabled
    ).toBe(false)

    await selectRow(user, FILE_A)
    expect(screen.getByRole("button", { name: /删除选中的 1 份/ })).toBeTruthy()
  })
})

describe("取消恢复计划", () => {
  it("只有等待执行的计划给取消入口", async () => {
    api.fetchDatabaseRestoreState.mockResolvedValue({
      plan: restorePlan("planned"),
      currentSignature: null,
      verified: false,
    })
    const { unmount } = mount()
    expect(
      await screen.findByRole("button", { name: "取消恢复计划" })
    ).toBeTruthy()
    unmount()

    api.fetchDatabaseRestoreState.mockResolvedValue({
      plan: restorePlan("applying"),
      currentSignature: null,
      verified: false,
    })
    mount()
    await waitForList()
    expect(screen.queryByRole("button", { name: "取消恢复计划" })).toBeNull()
  })

  it("取消成功：提示重启不再执行恢复，并重新读取状态", async () => {
    api.fetchDatabaseRestoreState.mockResolvedValue({
      plan: restorePlan("planned"),
      currentSignature: null,
      verified: false,
    })
    api.cancelDatabaseRestore.mockResolvedValue(restorePlan("cancelled"))
    const user = userEvent.setup()
    mount()
    await user.click(
      await screen.findByRole("button", { name: "取消恢复计划" })
    )

    await waitFor(() =>
      expect(api.cancelDatabaseRestore).toHaveBeenCalledTimes(1)
    )
    expect(toast.success).toHaveBeenCalledWith(
      "已取消恢复计划：重启不再执行恢复"
    )
    await waitFor(() =>
      expect(api.fetchDatabaseRestoreState).toHaveBeenCalledTimes(2)
    )
  })

  it("已经开始执行（409）：写明无法取消并隐藏入口", async () => {
    api.fetchDatabaseRestoreState.mockResolvedValue({
      plan: restorePlan("planned"),
      currentSignature: null,
      verified: false,
    })
    api.cancelDatabaseRestore.mockRejectedValue(
      conflict("restore_not_cancellable", "恢复正在执行，不能取消")
    )
    const user = userEvent.setup()
    mount()
    await user.click(
      await screen.findByRole("button", { name: "取消恢复计划" })
    )

    expect(
      await screen.findByText(
        "计划已开始执行，无法取消；请等重启完成后重新读取状态核实。"
      )
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "取消恢复计划" })).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("结果未知：页内提示重新读取核实，不报成功也不报失败", async () => {
    api.fetchDatabaseRestoreState.mockResolvedValue({
      plan: restorePlan("planned"),
      currentSignature: null,
      verified: false,
    })
    api.cancelDatabaseRestore.mockRejectedValue(unknownError())
    const user = userEvent.setup()
    mount()
    await user.click(
      await screen.findByRole("button", { name: "取消恢复计划" })
    )

    expect(await screen.findByText("结果未知")).toBeTruthy()
    expect(screen.queryByText("取消恢复计划没有成功")).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
