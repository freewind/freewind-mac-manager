// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SidebarProvider } from "@web/components/ui/sidebar"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppSidebar } from "./AppSidebar"

/** 侧栏内部会读断点，jsdom 没有 matchMedia，这里给出固定值。 */
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

beforeEach(() => stubMatchMedia())

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("侧栏功能入口", () => {
  it("服务分组里有 Caddy 网关，点击后切到 caddy", () => {
    const onSelect = vi.fn()
    render(
      <SidebarProvider>
        <AppSidebar active="frp" onSelect={onSelect} />
      </SidebarProvider>
    )
    // 服务子项由官方 SidebarMenuSubButton 渲染为 <a>（无 href，无 button 角色），
    // 因此按可见文案定位后点击，事件由 React 代理冒泡到该元素。
    const entry = screen.getByText("Caddy 网关")
    expect(entry.closest("a")).toBeTruthy()
    fireEvent.click(entry)
    expect(onSelect).toHaveBeenCalledWith("caddy")
  })
})
