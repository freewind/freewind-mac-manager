// @vitest-environment jsdom
import type {
  DatabaseBackup,
  DatabaseBackupCreated,
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

const SIGNATURE = "a".repeat(32)

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

const listBody = (
  backups: DatabaseBackup[],
  over: Partial<DatabaseBackupsResponse> = {}
): DatabaseBackupsResponse => ({
  backups,
  page: 1,
  pageSize: 50,
  total: backups.length,
  directory: "/Users/demo/Library/Application Support/mac-manager/backups",
  totalBytes: backups.reduce((sum, item) => sum + item.sizeBytes, 0),
  ...over,
})

const idleRestore: DatabaseRestoreState = {
  plan: null,
  verified: false,
}

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

const mount = (client = createClient()) =>
  render(
    <QueryClientProvider client={client}>
      <BackupsPanel />
    </QueryClientProvider>
  )

beforeEach(() => {
  // 待核实请求是持久化的全局状态：上一个用例的 202 受理会锁住同一目标，必须先清
  clearPendingRequests()
  // 写操作要求在线：jsdom 里 onlineManager 默认可能判为离线，会让动作根本没发出去
  onlineManager.setOnline(true)
  api.fetchDatabaseBackups.mockResolvedValue(listBody([backup()]))
  api.fetchDatabaseRestoreState.mockResolvedValue(idleRestore)
  // jsdom 没有实现对象 URL；下载只验证调用链，不真的存盘
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

const rowOf = (fileName: string): HTMLElement =>
  screen.getByText(fileName).closest("tr") as HTMLElement

const openImport = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByText("snapshots-1791700000000-aaa111.sqlite3")
  await user.click(screen.getByRole("button", { name: /导入备份/ }))
  await screen.findByRole("dialog")
}

describe("备份列表", () => {
  it("不确定的信息如实说清：null 不是 0，阻塞原因与不完整原因都要显示", async () => {
    const imported = backup({
      id: "snap-2",
      fileName: "snapshots-1791600000000-bbb222.sqlite3",
      source: "import",
      originalFileName: "旧机器.sqlite3",
      integrity: { ok: false, reason: "文件头损坏" },
      restoreBlockedReason: "缺少应用必要表",
      tableCount: null,
      rowCount: null,
    })
    api.fetchDatabaseBackups.mockResolvedValue(listBody([backup(), imported]))
    mount()

    const importedName = "snapshots-1791600000000-bbb222.sqlite3"
    await screen.findByText(importedName)
    const importedRow = within(rowOf(importedName))
    await waitFor(() => expect(importedRow.getByText("导入自 旧机器.sqlite3")))
    expect(importedRow.getByText("文件不完整")).toBeTruthy()
    expect(importedRow.getByText("文件头损坏")).toBeTruthy()
    expect(importedRow.getByText("不可用于恢复")).toBeTruthy()
    expect(importedRow.getByText("缺少应用必要表")).toBeTruthy()
    // 尚未统计就直说，不冒充 0
    expect(importedRow.getByText("尚未统计")).toBeTruthy()

    const manualRow = within(rowOf("snapshots-1791700000000-aaa111.sqlite3"))
    expect(manualRow.getByText("12 表 / 340 行")).toBeTruthy()
    expect(manualRow.getByText("手工创建")).toBeTruthy()
    // 只有导入来源才显示原始文件名
    expect(manualRow.queryByText(/导入自/)).toBeNull()
    expect(screen.getByText(/共 2 份/)).toBeTruthy()
  })

  it("没有备份时给空态而不是空表格", async () => {
    api.fetchDatabaseBackups.mockResolvedValue(listBody([]))
    mount()
    expect(await screen.findByText("还没有备份")).toBeTruthy()
  })

  it("读取失败时显示错误，不显示成空列表", async () => {
    api.fetchDatabaseBackups.mockRejectedValue(new Error("连接失败"))
    mount()
    expect(await screen.findByText("备份列表读取失败")).toBeTruthy()
    expect(screen.queryByText("还没有备份")).toBeNull()
  })

  it("来源筛选进查询参数，并回到第一页", async () => {
    api.fetchDatabaseBackups.mockResolvedValue(
      listBody([backup()], { page: 2, total: 120 })
    )
    const user = userEvent.setup()
    mount()
    await screen.findByText("snapshots-1791700000000-aaa111.sqlite3")

    await user.click(screen.getByRole("button", { name: "导入" }))
    await waitFor(() =>
      expect(api.fetchDatabaseBackups).toHaveBeenCalledWith(
        { page: 1, pageSize: 50, source: "import" },
        expect.anything()
      )
    )
  })
})

describe("备份表选中反馈", () => {
  const fileName = "snapshots-1791700000000-aaa111.sqlite3"

  it("勾选后整行带官方 TableRow 匹配的选中属性，与复选框状态一致", async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText(fileName)

    // 未选中时不带标记，避免官方样式误命中
    expect(rowOf(fileName).hasAttribute("data-state")).toBe(false)

    await user.click(screen.getByRole("checkbox", { name: `选中 ${fileName}` }))

    // 官方 TableRow 的样式是 data-[state=selected]:bg-muted，属性名必须对上
    expect(rowOf(fileName).getAttribute("data-state")).toBe("selected")
    expect(
      screen
        .getByRole("checkbox", { name: `选中 ${fileName}` })
        .getAttribute("aria-checked")
    ).toBe("true")
  })

  it("表头吸顶：thead 带 sticky top-0，与本项目其它表格一致", async () => {
    mount()
    await screen.findByText(fileName)

    const thead = screen
      .getByRole("columnheader", { name: "文件名" })
      .closest("thead")
    expect(thead?.className).toContain("sticky")
    expect(thead?.className).toContain("top-0")
    expect(thead?.className).toContain("bg-background")
  })
})

describe("备份表列宽", () => {
  it("选择列与短标记列有宽度基准，文件名与创建时间没有", async () => {
    mount()
    await screen.findByText("snapshots-1791700000000-aaa111.sqlite3")
    for (const name of ["大小", "来源", "状态", "规模"]) {
      const header = screen.getByRole("columnheader", { name })
      expect(header.className).toContain("w-[1%]")
      expect(header.className).toContain("whitespace-nowrap")
    }
    const select = screen
      .getByRole("checkbox", { name: "选中当前页全部备份" })
      .closest("th")
    expect(select?.className).toContain("w-[1%]")
    // 文件名是内容列、创建时间是固定格式时间，都不给 nowrap
    for (const name of ["文件名", "创建时间"]) {
      expect(
        screen.getByRole("columnheader", { name }).className
      ).not.toContain("w-[1%]")
    }
  })

  it("操作列固定在右侧，按钮容器按整排按钮计算列宽", async () => {
    mount()
    const fileName = "snapshots-1791700000000-aaa111.sqlite3"
    await screen.findByText(fileName)
    const header = screen.getByRole("columnheader", { name: "操作" })
    for (const className of [
      "sticky",
      "right-0",
      "z-10",
      "w-[1%]",
      "whitespace-nowrap",
      "bg-background",
    ]) {
      expect(header.className).toContain(className)
    }
    const download = within(rowOf(fileName)).getByRole("button", {
      name: /下载/,
    })
    const cell = download.closest("td")
    for (const className of ["sticky", "right-0", "bg-background"]) {
      expect(cell?.className).toContain(className)
    }
    expect(download.parentElement?.className).toContain("min-w-max")
  })
})

describe("创建备份", () => {
  it("202 受理只提示已交给后台，不谎报已创建", async () => {
    api.createDatabaseBackup.mockResolvedValue({
      kind: "accepted",
      body: {
        taskId: "task-1",
        kind: "database_backup_create",
        status: "running",
        startedAt: 1_791_700_000,
      },
    })
    const user = userEvent.setup()
    mount()
    await screen.findByText("snapshots-1791700000000-aaa111.sqlite3")

    await user.click(screen.getByRole("button", { name: /创建备份/ }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining("已交给后台执行")
      )
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(api.fetchDatabaseBackups).toHaveBeenCalledTimes(1)
  })

  it("201 完成才提示成功并重新读取列表", async () => {
    const created: DatabaseBackupCreated = {
      backup: backup({
        id: "snap-9",
        fileName: "snapshots-1791700500000-ccc333.sqlite3",
      }),
      message: "备份已创建",
    }
    api.createDatabaseBackup.mockResolvedValue({
      kind: "completed",
      status: 201,
      body: created,
    })
    const user = userEvent.setup()
    mount()
    await screen.findByText("snapshots-1791700000000-aaa111.sqlite3")

    await user.click(screen.getByRole("button", { name: /创建备份/ }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("备份已创建")
    )
    await waitFor(() =>
      expect(api.fetchDatabaseBackups).toHaveBeenCalledTimes(2)
    )
  })

  it("执行中不重复提交", async () => {
    api.createDatabaseBackup.mockReturnValue(new Promise(() => undefined))
    const user = userEvent.setup()
    mount()
    await screen.findByText("snapshots-1791700000000-aaa111.sqlite3")

    const button = screen.getByRole("button", { name: /创建备份/ })
    await user.click(button)
    await waitFor(() =>
      expect(api.createDatabaseBackup).toHaveBeenCalledTimes(1)
    )
    await user.click(button)
    expect(api.createDatabaseBackup).toHaveBeenCalledTimes(1)
  })
})

describe("导入备份", () => {
  it("超过 8GiB 的文件在本地就拒绝，不发请求", async () => {
    const user = userEvent.setup()
    mount()
    await openImport(user)

    const file = new File(["x"], "超大备份.sqlite3")
    Object.defineProperty(file, "size", { value: 9 * 1024 ** 3 })
    await user.upload(screen.getByLabelText("备份文件"), file)

    expect(await screen.findByText("文件超过上限")).toBeTruthy()
    const submit = screen.getByRole("button", { name: /开始导入/ })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    await user.click(submit)
    expect(api.uploadDatabaseBackup).not.toHaveBeenCalled()
  })

  it("正常导入把原始文件名一起交给服务端，成功后重新读取列表", async () => {
    api.uploadDatabaseBackup.mockResolvedValue({
      backup: backup({ id: "snap-3", source: "import" }),
      message: "已导入",
    })
    const user = userEvent.setup()
    mount()
    await openImport(user)

    const file = new File(["x"], "旧机器.sqlite3")
    await user.upload(screen.getByLabelText("备份文件"), file)
    await user.click(screen.getByRole("button", { name: /开始导入/ }))

    await waitFor(() =>
      expect(api.uploadDatabaseBackup).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ originalFileName: "旧机器.sqlite3" })
      )
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("已导入")
      )
    )
    await waitFor(() =>
      expect(api.fetchDatabaseBackups).toHaveBeenCalledTimes(2)
    )
  })

  it("上传中断只说结果未知并要求重新核实，不自动重传", async () => {
    api.uploadDatabaseBackup.mockRejectedValue(new Error("连接中断"))
    const user = userEvent.setup()
    mount()
    await openImport(user)

    const file = new File(["x"], "旧机器.sqlite3")
    await user.upload(screen.getByLabelText("备份文件"), file)
    await user.click(screen.getByRole("button", { name: /开始导入/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    const message = String(vi.mocked(toast.error).mock.calls[0]?.[0] ?? "")
    expect(message).toContain("重新读取列表核实")
    expect(api.uploadDatabaseBackup).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe("下载备份", () => {
  it("下载中可以取消，取消后不提示成功", async () => {
    let aborted = false
    api.downloadDatabaseBackup.mockImplementation(
      (_id: string, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            aborted = true
            reject(new DOMException("aborted", "AbortError"))
          })
        })
    )
    const user = userEvent.setup()
    mount()
    await screen.findByText("snapshots-1791700000000-aaa111.sqlite3")

    await user.click(screen.getByRole("button", { name: /^下载$/ }))
    await waitFor(() =>
      expect(api.downloadDatabaseBackup).toHaveBeenCalledWith(
        "snap-1",
        expect.objectContaining({ signal: expect.anything() })
      )
    )

    await user.click(screen.getByRole("button", { name: /取消下载/ }))
    await waitFor(() => expect(aborted).toBe(true))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringContaining("已取消下载"))
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("下载成功后按服务端给的文件名保存", async () => {
    api.downloadDatabaseBackup.mockResolvedValue({
      blob: new Blob(["x"]),
      fileName: "snapshots-1791700000000-aaa111.sqlite3",
      sizeBytes: 1_073_741_824,
    })
    const user = userEvent.setup()
    mount()
    await screen.findByText("snapshots-1791700000000-aaa111.sqlite3")

    await user.click(screen.getByRole("button", { name: /^下载$/ }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("snapshots-1791700000000-aaa111.sqlite3")
      )
    )
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})

describe("传输进度", () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((next) => {
      resolve = next
    })
    return { promise, resolve }
  }

  it("导入时显示已传字节与总量", async () => {
    const pending = deferred<DatabaseBackupCreated>()
    api.uploadDatabaseBackup.mockImplementation(
      async (
        _file: File,
        options?: { onProgress?: (loaded: number, total?: number) => void }
      ) => {
        options?.onProgress?.(10 * 1024 * 1024, 20 * 1024 * 1024)
        return pending.promise
      }
    )
    const user = userEvent.setup()
    mount()
    await openImport(user)
    await user.upload(
      screen.getByLabelText("备份文件"),
      new File(["x"], "旧机器.sqlite3")
    )
    await user.click(screen.getByRole("button", { name: /开始导入/ }))

    expect(
      await screen.findByText("已传 10.0 MB / 共 20.0 MB（50%）")
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "取消上传" })).toBeTruthy()

    pending.resolve({ backup: backup({ id: "snap-9" }), message: "已导入" })
  })

  it("下载时显示进度，取消入口仍在", async () => {
    const pending = deferred<{
      blob: Blob
      fileName: string
      sizeBytes: number
    }>()
    api.downloadDatabaseBackup.mockImplementation(
      async (
        _id: string,
        options?: { onProgress?: (loaded: number, total?: number) => void }
      ) => {
        options?.onProgress?.(1024 * 1024, 4 * 1024 * 1024)
        return pending.promise
      }
    )
    const user = userEvent.setup()
    mount()
    await screen.findByText("snapshots-1791700000000-aaa111.sqlite3")

    await user.click(screen.getByRole("button", { name: /^下载$/ }))

    expect(
      await screen.findByText("已传 1.0 MB / 共 4.0 MB（25%）")
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: /取消下载/ })).toBeTruthy()
  })

  it("拿不到总量时只显示已传字节，不编造百分比", async () => {
    const pending = deferred<{
      blob: Blob
      fileName: string
      sizeBytes: number
    }>()
    api.downloadDatabaseBackup.mockImplementation(
      async (
        _id: string,
        options?: { onProgress?: (loaded: number, total?: number) => void }
      ) => {
        options?.onProgress?.(3 * 1024 * 1024)
        return pending.promise
      }
    )
    const user = userEvent.setup()
    mount()
    await screen.findByText("snapshots-1791700000000-aaa111.sqlite3")

    await user.click(screen.getByRole("button", { name: /^下载$/ }))

    expect(await screen.findByText("已传 3.0 MB")).toBeTruthy()
    expect(screen.queryByText(/共 .*（\d+%）/)).toBeNull()
  })

  it("413 分支文案不变：照实转述服务端的超限原因", async () => {
    api.uploadDatabaseBackup.mockRejectedValue(
      new ApiRequestError(
        "请求失败（HTTP 413）：上传文件超过 8 GiB 上限",
        413,
        {
          message: "上传文件超过 8 GiB 上限",
          code: "too_large",
        }
      )
    )
    const user = userEvent.setup()
    mount()
    await openImport(user)
    await user.upload(
      screen.getByLabelText("备份文件"),
      new File(["x"], "旧机器.sqlite3")
    )
    await user.click(screen.getByRole("button", { name: /开始导入/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    const message = String(vi.mocked(toast.error).mock.calls[0]?.[0] ?? "")
    expect(message).toContain("HTTP 413")
    expect(message).toContain("上传文件超过 8 GiB 上限")
    expect(message).toContain("重新读取列表核实")
  })
})
