// @vitest-environment jsdom

import type { SystemService } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@web/components/ui/tooltip"
import { clearPendingRequests } from "@web/features/tasks/pending-requests"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { systemServiceKeys } from "../queries"
import { SystemServicesPage } from "./SystemServicesPage"

const { stopService, toastMock, overlayCalls } = vi.hoisted(() => ({
  stopService: vi.fn(),
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  /** 记录浮层开关回调，用来断言「返回先关详情」而不是离开页面。 */
  overlayCalls: [] as { open: boolean; close: () => void }[],
}))
vi.mock("@shared/client-api", async (original) => ({
  ...(await original<typeof import("@shared/client-api")>()),
  stopSystemService: stopService,
}))
vi.mock("sonner", () => ({ toast: toastMock }))
vi.mock("@web/hooks/use-history-overlay", () => ({
  useHistoryOverlay: (open: boolean, close: () => void) => {
    overlayCalls.push({ open, close })
  },
}))

/** 复现线上宽度问题：极长的 plist 路径、多参数、长日志路径与环境变量。 */
const PLIST_PATH =
  "/Users/peng.li/Library/LaunchAgents/ai.openclaw.gateway.plist"
const STDOUT_PATH = "/Users/peng.li/Library/Logs/ai.openclaw.gateway.stdout.log"
const ARGS = [
  "--config=/Users/peng.li/workspace/openclaw-gateway/config/gateway.toml",
  "--listen=127.0.0.1:18789",
  "--log-level=debug",
  "--max-connections=256",
]
const ENVIRONMENT = {
  PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
  NODE_ENV: "production",
}

const service: SystemService = {
  label: "ai.openclaw.gateway",
  domain: "user",
  filePath: PLIST_PATH,
  exists: true,
  loaded: true,
  disabled: false,
  state: "running",
  pid: 4821,
  lastExitCode: null,
  startedAt: 1_700_000_000,
  program: "/Users/peng.li/.local/bin/openclaw",
  args: ARGS,
  runAtLoad: true,
  keepAlive: true,
  startInterval: null,
  workingDirectory: "/Users/peng.li/workspace/openclaw-gateway",
  stdoutPath: STDOUT_PATH,
  stderrPath: "/Users/peng.li/Library/Logs/ai.openclaw.gateway.stderr.log",
  environment: ENVIRONMENT,
  processType: "Interactive",
  throttleInterval: 10,
  requiresRoot: false,
  plist: '<?xml version="1.0" encoding="UTF-8"?><plist><dict/></plist>',
}

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { enabled: false, retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(systemServiceKeys.list, {
    services: [service],
    skipped: [],
  })
  render(<SystemServicesPage />, {
    // 与 main.tsx 一致挂上 Provider：否则 Tooltip 走默认延时，悬停断言会变成计时竞态。
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    ),
  })
}

let desktop = true

/** 与 useIsDesktop 一致的匹配媒体查询替身：改 desktop 就切换断点。 */
const setDesktop = (value: boolean) => {
  desktop = value
}

beforeEach(() => {
  desktop = true
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
  overlayCalls.length = 0
  clearPendingRequests()
  stopService.mockReset()
  toastMock.success.mockClear()
  toastMock.error.mockClear()
})

afterEach(() => {
  cleanup()
  clearPendingRequests()
  vi.unstubAllGlobals()
})

describe("系统服务页", () => {
  it("超长 plist 路径、日志路径与多参数仍是完整文本", () => {
    renderPage()

    // 截断/断行只影响视觉：完整值必须原样可取
    expect(screen.getByText(PLIST_PATH)).toBeTruthy()
    expect(screen.getByText(STDOUT_PATH)).toBeTruthy()
    expect(screen.getByText(ARGS.join(" "))).toBeTruthy()
    // 环境变量用两个空格分隔，关掉断行后仍是原样字符串
    const environmentText = Object.entries(ENVIRONMENT)
      .map(([key, value]) => `${key}=${value}`)
      .join("  ")
    expect(
      screen.getByText(environmentText, { normalizer: (text) => text })
    ).toBeTruthy()
  })

  it("服务选择与动作入口按语义可达，且打开确认框不会触发真实停止", async () => {
    const user = userEvent.setup()
    renderPage()

    // 左侧列表项可按语义选中
    const listItem = screen.getByRole("button", {
      name: /ai\.openclaw\.gateway/,
    })
    await user.click(listItem)

    // 危险动作入口在，但只走确认流程
    await user.click(screen.getByRole("button", { name: "停止" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("ai.openclaw.gateway")
    expect(stopService).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "取消" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(stopService).not.toHaveBeenCalled()
  })

  it("启动命令含可执行文件与全部参数，不是只剩参数片段", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      screen.getByRole("button", { name: /ai\.openclaw\.gateway/ })
    )

    // 只有参数时看不出真正启动了什么（用户反馈的 -c … 就是这个片段）
    expect(screen.getByText(ARGS.join(" "))).toBeTruthy()
    expect(screen.getByText("启动命令")).toBeTruthy()
    expect(
      screen.getByText(`${service.program} ${ARGS.join(" ")}`)
    ).toBeTruthy()
  })

  it("悬停启动命令能看到完整命令", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      screen.getByRole("button", { name: /ai\.openclaw\.gateway/ })
    )

    const command = `${service.program} ${ARGS.join(" ")}`
    const cell = screen.getByText(command)
    expect(cell.closest('[data-slot="tooltip-trigger"]')).not.toBeNull()

    await user.hover(cell)
    expect(await screen.findAllByText(command)).toHaveLength(2)
  })

  it("下拉里的「复制启动命令」写进剪贴板的是完整命令", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    renderPage()
    await user.click(
      screen.getByRole("button", { name: /ai\.openclaw\.gateway/ })
    )

    await user.click(screen.getByRole("button", { name: "更多操作" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "复制启动命令" })
    )

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${service.program} ${ARGS.join(" ")}`
      )
    })
    expect(toastMock.success).toHaveBeenCalledWith("已复制启动命令")
  })

  it("状态与域筛选默认收起，需要时才展开", async () => {
    const user = userEvent.setup()
    renderPage()

    // 收起时只留搜索与筛选摘要
    expect(screen.queryByRole("button", { name: "全部状态" })).toBeNull()
    expect(screen.getByText(/状态 全部 · 域 全部 · 显示 1 个/)).toBeTruthy()

    await user.click(screen.getByRole("button", { name: /详细筛选/ }))
    expect(screen.getByRole("button", { name: "全部状态" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "全部域" })).toBeTruthy()
  })

  it("详情里能读到启动命令，plist 原文按需展开且滚动留在面板内", async () => {
    const user = userEvent.setup()
    renderPage()

    // 身份与主要操作固定，元数据里的启动命令始终可达
    expect(screen.getByText("启动命令")).toBeTruthy()
    // 原文默认收起，不再常驻占高
    expect(document.querySelector(".max-h-80.overflow-auto")).toBeNull()

    await user.click(screen.getByRole("button", { name: "查看原文" }))
    const scroller = document.querySelector(".max-h-80.overflow-auto")
    expect(scroller).not.toBeNull()
    const pre = scroller?.querySelector("pre")
    // 面板自己的滚动与等宽不换行保持不变
    expect(pre?.className).toContain("whitespace-pre")
    expect(pre?.className).toContain("w-max")
  })

  it("手机点选服务后用 Sheet 显示详情，返回先关它而不是离开页面", async () => {
    setDesktop(false)
    const user = userEvent.setup()
    renderPage()

    // 默认只显示列表，不预先打开详情
    expect(screen.queryByRole("dialog")).toBeNull()

    await user.click(
      screen.getByRole("button", { name: /ai\.openclaw\.gateway/ })
    )
    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).getByText("服务元数据")).toBeTruthy()

    // 系统返回：调用浮层自己的关闭回调，随后浮层消失
    const call = overlayCalls.filter((item) => item.open).at(-1)
    expect(call).toBeDefined()
    await act(async () => call?.close())
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("桌面切换服务后详情滚动容器重建，回到顶部", async () => {
    const user = userEvent.setup()
    const client = new QueryClient({
      defaultOptions: {
        queries: { enabled: false, retry: false },
        mutations: { retry: false },
      },
    })
    client.setQueryData(systemServiceKeys.list, {
      services: [service, { ...service, label: "second.service", pid: 99 }],
      skipped: [],
    })
    render(<SystemServicesPage />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })

    const selector = ".min-h-0.min-w-0.flex-1.overflow-auto"
    const before = document.querySelector(selector)
    expect(before).not.toBeNull()
    expect(before?.textContent).toContain("ai.openclaw.gateway")

    await user.click(screen.getByRole("button", { name: /second\.service/ }))
    // 固定的身份区已切到新服务（列表项与身份区各一次）
    expect(screen.getAllByText("second.service").length).toBeGreaterThan(1)
    const after = document.querySelector(selector)
    // key 变化重建滚动容器，滚动位置自然回到顶部
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
  })

  it("需 root 的服务启停入口为禁用态，且标明原因、点击不触发动作", async () => {
    const user = userEvent.setup()
    const rootClient = new QueryClient({
      defaultOptions: {
        queries: { enabled: false, retry: false },
        mutations: { retry: false },
      },
    })
    rootClient.setQueryData(systemServiceKeys.list, {
      services: [{ ...service, requiresRoot: true, domain: "system" }],
      skipped: [],
    })
    render(<SystemServicesPage />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={rootClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    const stop = screen.getByRole("button", {
      name: "停止",
    }) as HTMLButtonElement
    // 用户能看到禁用原因，而不是按钮默默无反应
    expect(stop.disabled).toBe(true)
    expect(stop.getAttribute("title")).toContain("root")
    await user.click(stop)
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(stopService).not.toHaveBeenCalled()
  })
})
