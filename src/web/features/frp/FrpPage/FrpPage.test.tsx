// @vitest-environment jsdom

import type { FrpConfig } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { frpKeys } from "../queries"
import { FrpPage } from "./FrpPage"

const { api, toastMock } = vi.hoisted(() => ({
  api: { probeFrpProxy: vi.fn() },
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

// 只替身探测请求；配置仍由测试直接写进查询缓存。
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/client-api")>()),
  probeFrpProxy: api.probeFrpProxy,
}))
vi.mock("sonner", () => ({ toast: toastMock }))

/** 复现线上数据：极长的配置路径、frpc 路径、launchd 标识与服务端地址。 */
const CONFIG_PATH = "/Users/peng.li/.config/frp/frpc-xianyu.toml"
const BINARY_PATH = "/Users/peng.li/.local/bin/frpc"
const LAUNCHD_LABEL = "com.pengli.frpc-xianyu"
const SERVER_ADDR = "hm.wwszxc.tax:34080"

const config: FrpConfig = {
  server: {
    serverAddr: SERVER_ADDR.split(":")[0] ?? "",
    serverPort: 34080,
    authMethod: "token",
    authToken: "secret",
    configPath: CONFIG_PATH,
    binaryPath: BINARY_PATH,
    launchdLabel: LAUNCHD_LABEL,
    state: "running",
    pid: 4821,
    startedAt: 1_700_000_000,
  },
  proxies: [
    {
      name: "xianyu-web",
      type: "tcp",
      localIP: "127.0.0.1",
      localPort: 8080,
      remotePort: 38080,
    },
  ],
  savedSignature: "",
}

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(frpKeys.config, config)
  render(<FrpPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

beforeEach(() => {
  api.probeFrpProxy.mockReset()
  for (const fn of [
    toastMock,
    toastMock.success,
    toastMock.error,
    toastMock.warning,
    toastMock.info,
  ])
    fn.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("FRP 页", () => {
  it("服务端卡的长路径与服务标识仍是完整文本", () => {
    renderPage()

    // 断行只影响视觉：完整值必须原样可取
    expect(screen.getByText(CONFIG_PATH)).toBeTruthy()
    expect(screen.getByText(BINARY_PATH)).toBeTruthy()
    expect(screen.getByText(LAUNCHD_LABEL)).toBeTruthy()
    // 页头与服务端卡各显示一次服务地址
    expect(
      screen.getAllByText(`${SERVER_ADDR.split(":")[0]}:34080`)
    ).toHaveLength(2)
  })

  it("隧道表的六个列头齐全", () => {
    renderPage()

    for (const header of [
      "隧道名",
      "类型",
      "本地目标",
      "远程端口",
      "连通性",
      "操作",
    ]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy()
    }
    expect(screen.getByText("xianyu-web")).toBeTruthy()
  })

  it("窄屏给出左右滑动的提示", () => {
    renderPage()

    expect(screen.getByText("手机上可左右滑动查看远程端口与操作")).toBeTruthy()
  })

  it("探测说明改为悬停展示：Badge 是触发元素，操作按钮与短地址格都不在触发范围里", async () => {
    const user = userEvent.setup()
    api.probeFrpProxy.mockResolvedValue({
      reachable: false,
      latencyMs: 3000,
      message: "连接超时：hm.wwszxc.tax:34080 无响应",
      checkedAt: 1_700_000_000,
    })
    renderPage()

    await user.click(screen.getByRole("button", { name: "xianyu-web 的操作" }))
    await user.click(await screen.findByRole("menuitem", { name: "探测连通" }))

    const badge = await screen.findByText("不可达")
    expect(badge.closest('[data-slot="tooltip-trigger"]')).not.toBeNull()

    await user.hover(badge)
    expect(
      await screen.findByText("连接超时：hm.wwszxc.tax:34080 无响应")
    ).toBeTruthy()

    // 操作按钮在单独一格里：不能被 Tooltip 触发元素包住
    expect(
      screen
        .getByRole("button", { name: "xianyu-web 的操作" })
        .closest('[data-slot="tooltip-trigger"]')
    ).toBeNull()
    // 短地址格本身没被截断，不包 Tooltip，避免噪音
    expect(
      screen
        .getByText("127.0.0.1:8080")
        .closest('[data-slot="tooltip-trigger"]')
    ).toBeNull()
  })

  it("配置预览的滚动只在预览区内部，复制按钮留在预览之外", () => {
    renderPage()

    const preview = screen.getByRole("region", { name: "frpc 配置预览" })
    // 限高 + 内部滚动：不再用 max-h 的 ScrollArea，内容不会溢出遮住下方操作
    expect(preview.className).toContain("max-h-72")
    expect(preview.className).toContain("overflow-auto")

    const code = preview.querySelector("pre")
    expect(code).not.toBeNull()
    expect(code?.className).toContain("whitespace-pre")
    expect(code?.className).toContain("w-max")

    // 操作按钮在滚动容器外，不会被预览内容盖住
    const copy = screen.getByRole("button", { name: "复制" })
    expect(preview.contains(copy)).toBe(false)
  })
})
