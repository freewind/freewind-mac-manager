// @vitest-environment jsdom
import type {
  CaddyRule,
  CaddyRuleChanges,
  CaddyRulesResponse,
  CaddyVersionSummary,
} from "@shared/api-contract"
import { ApiRequestError } from "@shared/client-api"
import { formatTimestamp } from "@shared/format"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { clearPendingRequests } from "@web/features/tasks/pending-requests"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CaddyPage } from "./CaddyPage"

const { api, toastMock } = vi.hoisted(() => ({
  api: {
    fetchCaddyRules: vi.fn(),
    fetchCaddyVersions: vi.fn(),
    createCaddyRule: vi.fn(),
    updateCaddyRule: vi.fn(),
    deleteCaddyRule: vi.fn(),
    importCaddyRules: vi.fn(),
    applyCaddyConfig: vi.fn(),
    restoreCaddyVersion: vi.fn(),
    fetchTask: vi.fn(),
  },
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

// 只替身 Caddy 相关调用；错误类型与请求标识工具保持真实，行为与生产一致。
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchCaddyRules: api.fetchCaddyRules,
  fetchCaddyVersions: api.fetchCaddyVersions,
  createCaddyRule: api.createCaddyRule,
  updateCaddyRule: api.updateCaddyRule,
  deleteCaddyRule: api.deleteCaddyRule,
  importCaddyRules: api.importCaddyRules,
  applyCaddyConfig: api.applyCaddyConfig,
  restoreCaddyVersion: api.restoreCaddyVersion,
  fetchTask: api.fetchTask,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

/** 手机与桌面走同一份数据，只有渲染差异，因此要能切换断点。 */
const setDesktop = (desktop: boolean): void => {
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

const setOnline = (online: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  })
}

const rule = (overrides: Partial<CaddyRule> = {}): CaddyRule => ({
  id: "r1",
  name: "模型服务",
  note: "",
  matchKind: "host",
  host: "llm.returncat.com",
  pathPrefix: null,
  stripPrefix: false,
  upstream: "127.0.0.1:52390",
  enabled: true,
  sortOrder: 0,
  createdAt: 1_699_000_000,
  updatedAt: 1_699_000_000,
  ...overrides,
})

const emptyChanges = (): CaddyRuleChanges => ({
  added: [],
  updated: [],
  removed: [],
  enabled: [],
  disabled: [],
})

const rulesResponse = (
  overrides: Partial<CaddyRulesResponse> = {}
): CaddyRulesResponse => ({
  status: {
    processRunning: true,
    version: "v2.11.4",
    configFile: "/tmp/caddy/Caddyfile",
    binaryPath: "/tmp/caddy/caddy",
    launchdLabel: "com.freewind.caddy",
    adminUrl: "http://127.0.0.1:2019",
    adminReachable: true,
    managedRegionPresent: true,
    readAt: 1_700_000_000,
  },
  rules: [rule()],
  externalRules: [],
  unsupportedLines: 0,
  unsupportedSamples: [],
  appliedSignature: "sig-1",
  appliedAt: 1_699_999_000,
  currentSignature: "sig-1",
  hasUnappliedChanges: false,
  managedRegionDrifted: false,
  changes: emptyChanges(),
  previewText: "",
  writable: true,
  blockedReason: null,
  ...overrides,
})

const version = (
  overrides: Partial<CaddyVersionSummary> = {}
): CaddyVersionSummary => ({
  id: "v1",
  // 与 status.readAt 不同，避免同一条时间文案在页面上出现两次。
  appliedAt: 1_699_500_000,
  status: "success",
  message: "已应用 1 条规则，并已在运行配置里核实",
  ruleCount: 1,
  ...overrides,
})

const applyResult = (message = "已应用 1 条规则，并已在运行配置里核实") => ({
  kind: "completed" as const,
  status: 200 as const,
  body: {
    message,
    versionId: "v-new",
    appliedAt: 1_700_000_100,
    ruleCount: 1,
    verified: true,
    backupFile: "/tmp/backups/20260101000000-Caddyfile",
  },
})

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CaddyPage />
    </QueryClientProvider>
  )
}

const inputValue = (element: HTMLElement): string =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value
    : ""

const changeInput = (element: HTMLElement, value: string): void => {
  fireEvent.change(element, { target: { value } })
}

beforeEach(() => {
  setDesktop(false)
  setOnline(true)
  api.fetchCaddyRules.mockResolvedValue(rulesResponse())
  api.fetchCaddyVersions.mockResolvedValue({ versions: [version()] })
  api.createCaddyRule.mockResolvedValue(rule({ id: "r-new", name: "新服务" }))
  api.updateCaddyRule.mockResolvedValue(rule())
  api.deleteCaddyRule.mockResolvedValue(undefined)
  api.importCaddyRules.mockResolvedValue({ imported: 1, skipped: 0 })
  api.applyCaddyConfig.mockResolvedValue(applyResult())
  api.restoreCaddyVersion.mockResolvedValue(applyResult("已恢复并核实"))
})

afterEach(() => {
  cleanup()
  // 上一条用例可能停在「执行中」的弹窗上：清掉待核实请求与 body 锁样式。
  clearPendingRequests()
  document.body.style.overflow = ""
  document.body.style.pointerEvents = ""
  window.history.replaceState({}, "", "/")
  for (const fn of Object.values(api)) fn.mockReset()
  for (const fn of [toastMock, toastMock.success, toastMock.error]) {
    fn.mockReset()
  }
  vi.unstubAllGlobals()
})

describe("Caddy 页面状态", () => {
  it("加载中、读取失败、规则为空都有明确文案", async () => {
    api.fetchCaddyRules.mockImplementationOnce(() => new Promise(() => {}))
    renderPage()
    expect(screen.getByText("正在读取 Caddy 状态…")).toBeTruthy()
    cleanup()

    api.fetchCaddyRules.mockRejectedValueOnce(new Error("无法读取配置文件"))
    renderPage()
    expect(await screen.findByText("读取 Caddy 状态失败")).toBeTruthy()
    expect(screen.getByText("无法读取配置文件")).toBeTruthy()
    cleanup()

    api.fetchCaddyRules.mockResolvedValue(rulesResponse({ rules: [] }))
    renderPage()
    expect(await screen.findByText("还没有受管规则")).toBeTruthy()
    expect(screen.getByText(/新增一条规则/)).toBeTruthy()
  })

  it("现状把进程、管理接口、受管区域分开表达，并给出读数时间", async () => {
    renderPage()
    expect(await screen.findByText("运行中")).toBeTruthy()
    expect(screen.getByText("v2.11.4")).toBeTruthy()
    expect(screen.getByText("可达")).toBeTruthy()
    expect(screen.getByText("已建立")).toBeTruthy()
    expect(screen.getByText("无")).toBeTruthy()
    expect(screen.getByText(formatTimestamp(1_700_000_000))).toBeTruthy()
    // 受管区域被手工改动时要持续提示，而不是一闪而过的 toast
    cleanup()
    api.fetchCaddyRules.mockResolvedValue(
      rulesResponse({ managedRegionDrifted: true })
    )
    renderPage()
    expect(await screen.findByText("受管区域被手工改动过")).toBeTruthy()
  })

  it("blockedReason 存在时应用按钮禁用且原因可见", async () => {
    api.fetchCaddyRules.mockResolvedValue(
      rulesResponse({
        writable: false,
        blockedReason: "配置文件里还有尚未接管的规则",
        externalRules: [
          {
            id: "path:/keep/*",
            matchKind: "path",
            host: null,
            pathPrefix: "/keep/*",
            stripPrefix: true,
            upstream: "127.0.0.1:15009",
            line: 6,
          },
        ],
      })
    )
    renderPage()
    expect(await screen.findByText("现在不能应用变更")).toBeTruthy()
    expect(
      screen.getByText(/现在不能应用：配置文件里还有尚未接管的规则/)
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "应用变更" }).hasAttribute("disabled")
    ).toBe(true)
  })

  it("无法识别的行与未接管的规则分别展示，并可导入", async () => {
    api.fetchCaddyRules.mockResolvedValue(
      rulesResponse({
        unsupportedLines: 2,
        unsupportedSamples: ["第 6 行：encode gzip", "第 7 行：import other"],
        externalRules: [
          {
            id: "host:old.returncat.com",
            matchKind: "host",
            host: "old.returncat.com",
            pathPrefix: null,
            stripPrefix: false,
            upstream: "127.0.0.1:15009",
            line: 12,
          },
        ],
      })
    )
    renderPage()
    expect(await screen.findByText(/2 行无法识别/)).toBeTruthy()
    expect(screen.getByText("第 6 行：encode gzip")).toBeTruthy()
    expect(screen.getByText(/第 12 行：old.returncat.com/)).toBeTruthy()
    expect(screen.getByText("→ 127.0.0.1:15009")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "导入现有规则" }))
    await waitFor(() => expect(api.importCaddyRules).toHaveBeenCalledTimes(1))
  })

  it("桌面用表格展示规则，手机用卡片", async () => {
    setDesktop(true)
    renderPage()
    expect(await screen.findByRole("table")).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "上游" })).toBeTruthy()
    cleanup()

    setDesktop(false)
    renderPage()
    await screen.findByText("模型服务")
    expect(screen.queryByRole("table")).toBeNull()
  })
})

describe("Caddy 规则写入", () => {
  it("新增规则：提交调用 createCaddyRule，409 的中文原因留在表单里", async () => {
    api.createCaddyRule.mockResolvedValueOnce(rule({ id: "r-new" }))
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "新增规则" }))
    const dialog = await screen.findByRole("dialog")

    changeInput(within(dialog).getByLabelText("名称（必填）"), "新服务")
    changeInput(
      within(dialog).getByLabelText("域名（必填）"),
      "new.returncat.com"
    )
    changeInput(
      within(dialog).getByLabelText("上游地址（必填）"),
      "127.0.0.1:15001"
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "新增规则" }))
    await waitFor(() => expect(api.createCaddyRule).toHaveBeenCalledTimes(1))
    expect(api.createCaddyRule.mock.calls[0][0]).toEqual({
      name: "新服务",
      note: "",
      matchKind: "host",
      host: "new.returncat.com",
      pathPrefix: null,
      stripPrefix: false,
      upstream: "127.0.0.1:15001",
      enabled: true,
    })

    // 409 这类已知冲突要留在表单里持续展示，不能只用 toast
    api.createCaddyRule.mockRejectedValueOnce(
      new ApiRequestError(
        "请求失败（HTTP 409）：已有规则「模型服务」使用同样的匹配条件",
        409
      )
    )
    fireEvent.click(await screen.findByRole("button", { name: "新增规则" }))
    const again = await screen.findByRole("dialog")
    changeInput(within(again).getByLabelText("名称（必填）"), "重复服务")
    changeInput(
      within(again).getByLabelText("域名（必填）"),
      "dup.returncat.com"
    )
    changeInput(
      within(again).getByLabelText("上游地址（必填）"),
      "127.0.0.1:15002"
    )
    fireEvent.click(within(again).getByRole("button", { name: "新增规则" }))
    expect(await within(again).findByText(/同样的匹配条件/)).toBeTruthy()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("编辑规则：表单预填当前值，提交调用 updateCaddyRule", async () => {
    renderPage()
    fireEvent.click(
      await screen.findByRole("button", { name: "编辑规则「模型服务」" })
    )
    const dialog = await screen.findByRole("dialog")
    expect(inputValue(within(dialog).getByLabelText("名称（必填）"))).toBe(
      "模型服务"
    )
    expect(inputValue(within(dialog).getByLabelText("域名（必填）"))).toBe(
      "llm.returncat.com"
    )
    expect(inputValue(within(dialog).getByLabelText("上游地址（必填）"))).toBe(
      "127.0.0.1:52390"
    )

    changeInput(within(dialog).getByLabelText("名称（必填）"), "模型服务（改）")
    fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }))
    await waitFor(() => expect(api.updateCaddyRule).toHaveBeenCalledTimes(1))
    expect(api.updateCaddyRule.mock.calls[0][0]).toBe("r1")
    expect(api.updateCaddyRule.mock.calls[0][1]).toMatchObject({
      name: "模型服务（改）",
      host: "llm.returncat.com",
      upstream: "127.0.0.1:52390",
      enabled: true,
    })
  })

  it("删除规则：确认文案写明对象，取消不发请求", async () => {
    renderPage()
    fireEvent.click(
      await screen.findByRole("button", { name: "删除规则「模型服务」" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("删除规则「模型服务」？")
    expect(dialog.textContent).toContain("llm.returncat.com")
    expect(dialog.textContent).toContain("127.0.0.1:52390")
    expect(api.deleteCaddyRule).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(api.deleteCaddyRule).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("button", { name: "删除规则「模型服务」" })
    )
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(
      within(confirm).getByRole("button", { name: "删除规则「模型服务」" })
    )
    await waitFor(() => expect(api.deleteCaddyRule).toHaveBeenCalledWith("r1"))
    expect(toastMock.success).toHaveBeenCalledWith("已删除规则「模型服务」")
  })

  it("停用要确认且只改 enabled；启用直接提交", async () => {
    renderPage()
    fireEvent.click(
      await screen.findByRole("button", { name: "停用规则「模型服务」" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("停用规则「模型服务」？")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "停用规则「模型服务」" })
    )
    await waitFor(() => expect(api.updateCaddyRule).toHaveBeenCalledTimes(1))
    expect(api.updateCaddyRule.mock.calls[0][1]).toEqual({
      name: "模型服务",
      note: "",
      matchKind: "host",
      host: "llm.returncat.com",
      pathPrefix: null,
      stripPrefix: false,
      upstream: "127.0.0.1:52390",
      enabled: false,
    })
    cleanup()

    api.updateCaddyRule.mockClear()
    api.fetchCaddyRules.mockResolvedValue(
      rulesResponse({ rules: [rule({ enabled: false })] })
    )
    renderPage()
    fireEvent.click(
      await screen.findByRole("button", { name: "启用规则「模型服务」" })
    )
    // 启用不需要确认：没有对话框，请求直接发出
    expect(screen.queryByRole("alertdialog")).toBeNull()
    await waitFor(() => expect(api.updateCaddyRule).toHaveBeenCalledTimes(1))
    expect(api.updateCaddyRule.mock.calls[0][1]).toMatchObject({
      enabled: true,
    })
  })
})

describe("Caddy 应用与恢复", () => {
  it("应用：先确认并写明变更条数，确认后带上当前指纹", async () => {
    api.fetchCaddyRules.mockResolvedValue(
      rulesResponse({
        hasUnappliedChanges: true,
        currentSignature: "sig-2",
        changes: {
          ...emptyChanges(),
          added: [
            rule({ id: "r2", name: "新服务", host: "new.returncat.com" }),
            rule({ id: "r3", name: "另一个服务", host: "x.returncat.com" }),
          ],
        },
        previewText: "\thandle_path /llm/* {\n",
      })
    )
    renderPage()
    expect(await screen.findByText(/共 2 处变化：新增 2 条/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "应用变更" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("新增 2 条")
    expect(dialog.textContent).toContain("重新加载 Caddy")
    expect(api.applyCaddyConfig).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole("button", { name: "应用变更" }))
    await waitFor(() => expect(api.applyCaddyConfig).toHaveBeenCalledTimes(1))
    const [requestId, input] = api.applyCaddyConfig.mock.calls[0]
    expect(requestId).toMatch(/^req_/)
    expect(input).toEqual({ expectedSignature: "sig-2" })
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        "已应用 1 条规则，并已在运行配置里核实"
      )
    )
  })

  it("没有未应用变更时应用按钮禁用并说明", async () => {
    renderPage()
    await screen.findByText("模型服务")
    expect(
      screen.getByRole("button", { name: "应用变更" }).hasAttribute("disabled")
    ).toBe(true)
    expect(screen.getByText(/当前没有未应用的变更/)).toBeTruthy()
  })

  it("恢复历史版本：确认文案写明时间与条数", async () => {
    renderPage()
    const time = formatTimestamp(1_699_500_000)
    expect(await screen.findByText(time)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "恢复此版本" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain(`恢复 ${time} 的版本？`)
    expect(dialog.textContent).toContain("1 条规则")
    expect(api.restoreCaddyVersion).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole("button", { name: "恢复此版本" }))
    await waitFor(() =>
      expect(api.restoreCaddyVersion).toHaveBeenCalledTimes(1)
    )
    const [requestId, versionId] = api.restoreCaddyVersion.mock.calls[0]
    expect(requestId).toMatch(/^req_/)
    expect(versionId).toBe("v1")
  })

  it("没有历史版本时给出空状态", async () => {
    api.fetchCaddyVersions.mockResolvedValue({ versions: [] })
    renderPage()
    expect(await screen.findByText("还没有应用历史")).toBeTruthy()
  })
})

describe("Caddy 页面离线与可达性", () => {
  it("离线时所有写入口禁用并说明原因", async () => {
    setOnline(false)
    api.fetchCaddyRules.mockResolvedValue(
      rulesResponse({
        hasUnappliedChanges: true,
        currentSignature: "sig-2",
        changes: {
          ...emptyChanges(),
          added: [rule({ id: "r2", name: "新服务" })],
        },
        externalRules: [
          {
            id: "path:/keep/*",
            matchKind: "path",
            host: null,
            pathPrefix: "/keep/*",
            stripPrefix: true,
            upstream: "127.0.0.1:15009",
            line: 6,
          },
        ],
      })
    )
    renderPage()
    expect(await screen.findByText("当前处于离线状态")).toBeTruthy()
    const disabledNames = [
      "新增规则",
      "编辑规则「模型服务」",
      "停用规则「模型服务」",
      "删除规则「模型服务」",
      "导入现有规则",
      "应用变更",
      "恢复此版本",
    ]
    for (const name of disabledNames) {
      expect(
        screen.getByRole("button", { name }).hasAttribute("disabled"),
        `${name} 应当被禁用`
      ).toBe(true)
    }
  })

  it("关键交互元素都有可访问名称", async () => {
    renderPage()
    expect(await screen.findByRole("button", { name: "重新读取" })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "搜索规则" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "编辑规则「模型服务」" })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "删除规则「模型服务」" })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "停用规则「模型服务」" })
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "恢复此版本" })).toBeTruthy()
  })

  it("搜索按名称、域名或上游过滤", async () => {
    api.fetchCaddyRules.mockResolvedValue(
      rulesResponse({
        rules: [
          rule(),
          rule({
            id: "r2",
            name: "文件服务",
            host: "files.returncat.com",
            upstream: "127.0.0.1:54740",
          }),
        ],
      })
    )
    renderPage()
    await screen.findByText("模型服务")
    expect(screen.getByText("文件服务")).toBeTruthy()

    changeInput(screen.getByRole("textbox", { name: "搜索规则" }), "54740")
    await waitFor(() => expect(screen.queryByText("模型服务")).toBeNull())
    expect(screen.getByText("文件服务")).toBeTruthy()

    changeInput(screen.getByRole("textbox", { name: "搜索规则" }), "没有这个")
    expect(await screen.findByText(/没有匹配「没有这个」的规则/)).toBeTruthy()
  })
})
