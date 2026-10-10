// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ActionButton } from "./ActionButton"

afterEach(cleanup)

const disabledOf = (button: HTMLElement): boolean =>
  (button as HTMLButtonElement).disabled

describe("ActionButton", () => {
  it("shows an in-progress state and blocks repeats while busy", async () => {
    const onClick = vi.fn()
    render(
      <ActionButton busy busyLabel="删除中…" onClick={onClick}>
        删除
      </ActionButton>
    )

    const button = screen.getByRole("button", { name: /删除中/ })
    expect(disabledOf(button)).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")

    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("keeps the original label when not busy", async () => {
    const onClick = vi.fn()
    render(<ActionButton onClick={onClick}>立即扫描</ActionButton>)

    const button = screen.getByRole("button", { name: "立即扫描" })
    expect(disabledOf(button)).toBe(false)
    expect(button.getAttribute("aria-busy")).toBeNull()
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("stays out of reach for keyboard activation while busy", async () => {
    const onClick = vi.fn()
    render(
      <ActionButton busy onClick={onClick}>
        保存
      </ActionButton>
    )
    await userEvent.tab()
    await userEvent.keyboard("{Enter}")
    expect(onClick).not.toHaveBeenCalled()
  })

  it("respects an externally disabled button", async () => {
    const onClick = vi.fn()
    render(
      <ActionButton disabled onClick={onClick}>
        保存
      </ActionButton>
    )
    const button = screen.getByRole("button", { name: "保存" })
    expect(disabledOf(button)).toBe(true)
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
