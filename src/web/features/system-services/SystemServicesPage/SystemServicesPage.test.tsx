// @vitest-environment jsdom

import type { SystemService } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { clearPendingRequests } from "@web/features/tasks/pending-requests"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { systemServiceKeys } from "../queries"
import { SystemServicesPage } from "./SystemServicesPage"

const { stopService } = vi.hoisted(() => ({ stopService: vi.fn() }))
vi.mock("@shared/client-api", async (original) => ({
  ...(await original<typeof import("@shared/client-api")>()),
  stopSystemService: stopService,
}))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock("@web/hooks/use-history-overlay", () => ({
  useHistoryOverlay: () => {},
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
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

beforeEach(() => {
  clearPendingRequests()
  stopService.mockReset()
})

afterEach(() => {
  cleanup()
  clearPendingRequests()
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
