// @vitest-environment jsdom
import type { AuthStatus } from "@shared/client-api"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"

const { authStatus } = vi.hoisted(() => ({
  authStatus: { current: null as AuthStatus | null },
}))

vi.mock("@web/hooks/use-auth-status", () => ({
  useAuthStatus: () => ({ status: authStatus.current, error: null }),
  refreshAuthStatus: async () => undefined,
  markAuthenticated: vi.fn(),
  markUnauthenticated: vi.fn(),
}))

/** 侧栏与任务中心会读断点，jsdom 没有 matchMedia，这里给出固定值。 */
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

beforeEach(() => {
  stubMatchMedia()
  // 页面数据不联网：请求失败即可，本测试只看外壳的高度与滚动边界。
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderApp = (status: AuthStatus) => {
  authStatus.current = status
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  )
}

const classListOf = (element: Element | null): string[] =>
  element === null ? [] : [...element.classList]

describe("应用外壳的高度边界", () => {
  it("外壳占满视口并隐藏溢出，侧栏内容区拿到确定高度", () => {
    renderApp({ authenticated: true, configured: true })

    expect(
      classListOf(document.querySelector('[data-slot="sidebar-wrapper"]'))
    ).toEqual(expect.arrayContaining(["h-svh", "overflow-hidden"]))
    expect(
      classListOf(document.querySelector('[data-slot="sidebar-inset"]'))
    ).toEqual(expect.arrayContaining(["min-h-0", "overflow-hidden"]))
  })

  it("顶栏不参与滚动，页面主区带局部滚动", () => {
    renderApp({ authenticated: true, configured: true })

    const inset = document.querySelector('[data-slot="sidebar-inset"]')
    const [toolbar, content] = [...(inset?.children ?? [])]

    expect(classListOf(toolbar ?? null)).toEqual(
      expect.arrayContaining(["shrink-0"])
    )
    expect(classListOf(content ?? null)).toEqual(
      expect.arrayContaining(["min-h-0", "flex-1", "overflow-y-auto"])
    )
    // 页面自己的局部滚动区（概览页主区）在内容区里，因此不再撑长整页。
    expect(content?.querySelector(".overflow-auto")).toBeTruthy()
  })

  it("登录页不在外壳内，保留页面级滚动", () => {
    renderApp({ authenticated: false, configured: true })

    expect(document.querySelector('[data-slot="sidebar-wrapper"]')).toBeNull()
    expect(classListOf(screen.getByRole("main"))).toEqual(
      expect.arrayContaining(["min-h-dvh"])
    )
  })
})
