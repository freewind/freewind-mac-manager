// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PageHeader } from "./PageHeader"

afterEach(cleanup)

describe("PageHeader", () => {
  it("标题保持一级标题语义", () => {
    render(<PageHeader title="硬件" />)

    expect(screen.getByRole("heading", { level: 1, name: "硬件" })).toBeTruthy()
  })

  it("首屏加载时在标题旁给出可读的加载状态，加载完成后消失", () => {
    const { rerender } = render(<PageHeader title="进程管理" loading />)

    expect(screen.getByRole("status", { name: "进程管理 加载中" })).toBeTruthy()

    rerender(<PageHeader title="进程管理" loading={false} />)

    expect(screen.queryByRole("status")).toBeNull()
  })

  it("默认用页面统一字号，现状不同的页面按现状传入", () => {
    render(<PageHeader title="Caddy 网关" titleClassName="text-base" />)

    const heading = screen.getByRole("heading", { level: 1 })
    expect(heading.className).toContain("text-base")
    expect(heading.className).toContain("font-medium")
  })

  it("标题与操作区一起渲染", () => {
    render(
      <PageHeader title="硬件" loading>
        <button type="button">刷新</button>
      </PageHeader>
    )

    expect(screen.getByRole("heading", { level: 1, name: "硬件" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy()
    expect(screen.getByRole("status", { name: "硬件 加载中" })).toBeTruthy()
  })
})
