// @vitest-environment jsdom

import type { FrpConfig } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { frpKeys } from "../queries"
import { FrpPage } from "./FrpPage"

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
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
})
