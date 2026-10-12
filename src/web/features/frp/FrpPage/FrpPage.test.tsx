// @vitest-environment jsdom

import type { FrpConfig } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@web/components/ui/tooltip"
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

let desktop = true

/** 与 useIsDesktop 一致的匹配媒体查询替身：改 desktop 就切换断点。 */
const setDesktop = (value: boolean) => {
  desktop = value
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

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(frpKeys.config, config)
  render(<FrpPage />, {
    // 与 main.tsx 一致挂上 Provider：否则 Tooltip 走默认延时，悬停断言会变成计时竞态。
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    ),
  })
}

beforeEach(() => {
  setDesktop(true)
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
  it("服务端卡的长路径与服务标识仍是完整文本", async () => {
    renderPage()
    // 服务端详情默认收起：先展开再看完整字段
    screen.getByRole("button", { name: "展开服务端详情" }).click()

    // 断行只影响视觉：完整值必须原样可取
    expect(await screen.findByText(CONFIG_PATH)).toBeTruthy()
    expect(screen.getByText(BINARY_PATH)).toBeTruthy()
    expect(screen.getByText(LAUNCHD_LABEL)).toBeTruthy()
    // 页头状态行、服务端折叠首行与展开后的详情各一次
    expect(
      screen.getAllByText(`${SERVER_ADDR.split(":")[0]}:34080`)
    ).toHaveLength(3)
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

  it("启动命令是完整可执行文件加 -c 配置路径，不是只有 -c 片段", () => {
    renderPage()

    // 只是参数片段会让人看不出真正启动了什么
    const command = `${BINARY_PATH} -c ${CONFIG_PATH}`
    // 启动命令常驻服务端折叠首行：收起状态也能一眼看到完整命令
    expect(screen.getByText(command)).toBeTruthy()
    expect(screen.queryByText(`-c ${CONFIG_PATH}`)).toBeNull()
    // 隧道列表本身没有命令列，命令只属于服务级的一份配置
    expect(screen.queryByRole("columnheader", { name: "命令" })).toBeNull()
  })

  it("悬停启动命令能看到全文，复制按钮不在 Tooltip 触发范围里", async () => {
    const user = userEvent.setup()
    renderPage()

    const command = `${BINARY_PATH} -c ${CONFIG_PATH}`
    const cell = screen.getByText(command)
    expect(cell.closest('[data-slot="tooltip-trigger"]')).not.toBeNull()

    await user.hover(cell)
    expect(await screen.findAllByText(command)).toHaveLength(2)

    expect(
      screen
        .getByRole("button", { name: "复制 frpc 启动命令" })
        .closest('[data-slot="tooltip-trigger"]')
    ).toBeNull()
  })

  it("复制启动命令写入完整命令，列宽规范未受影响", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    renderPage()

    await user.click(screen.getByRole("button", { name: "复制 frpc 启动命令" }))
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${BINARY_PATH} -c ${CONFIG_PATH}`)
    })
    expect(toastMock.success).toHaveBeenCalledWith("已复制 frpc 启动命令")

    // 任务 30 的列宽约束与任务 41 的 sticky 操作列都不动
    const actionHead = screen.getByRole("columnheader", { name: "操作" })
    expect(actionHead.className).toContain("w-[1%]")
    expect(actionHead.className).toContain("whitespace-nowrap")
  })

  it("隧道列表在首屏，保存入口在常驻底栏", () => {
    renderPage()

    // 服务端详情默认收起：它的长内容不会把隧道列表推到下面
    expect(screen.queryByText(CONFIG_PATH)).toBeNull()
    expect(screen.getByRole("columnheader", { name: "隧道名" })).toBeTruthy()
    // 启动命令这类服务级信息仍在折叠首行可见
    expect(screen.getByText(`${BINARY_PATH} -c ${CONFIG_PATH}`)).toBeTruthy()

    // 保存入口在主体滚动区之外：长列表滚动时不会消失
    const scroller = document.querySelector(
      ".min-h-0.min-w-0.flex-1.overflow-auto"
    )
    expect(scroller).not.toBeNull()
    const save = screen.getByRole("button", { name: "保存" })
    expect(scroller?.contains(save)).toBe(false)
    // 未保存状态同样常驻可见（三种状态之一，不会什么都不显示）
    expect(
      screen.getAllByText(/有未保存的改动|已保存|配置未读到/).length
    ).toBeGreaterThan(0)
  })

  it("配置预览的滚动只在预览区内部，复制按钮留在预览之外", async () => {
    renderPage()
    // 预览按需打开：默认不占首屏
    screen.getByRole("button", { name: "打开预览" }).click()

    const preview = await screen.findByRole("region", {
      name: "frpc 配置预览",
    })
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
