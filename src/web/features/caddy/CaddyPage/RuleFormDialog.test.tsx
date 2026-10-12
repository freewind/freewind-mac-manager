// @vitest-environment jsdom

import type { CaddyRuleInput } from "@shared/api-contract"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RuleFormDialog } from "./RuleFormDialog"

const renderForm = () => {
  const onSubmit = vi.fn(async (_input: CaddyRuleInput) => true)
  render(
    <RuleFormDialog
      open
      onOpenChange={() => undefined}
      rule={null}
      busy={false}
      failure={null}
      onSubmit={onSubmit}
    />
  )
  return { onSubmit }
}

/** 受控输入需要原生 setter + input 事件。 */
const setValue = (element: HTMLElement, value: string): void => {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

afterEach(() => {
  cleanup()
})

describe("规则表单的匹配方式选择", () => {
  it("选中「路径前缀」后写入表单并进入提交体，不是 undefined", async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    setValue(screen.getByLabelText("名称（必填）"), "api")

    // ComboboxItem 必须传对象本身：传字符串时回调里读 .value 会拿到 undefined
    const combo = screen.getByRole("combobox", { name: "匹配方式" })
    await user.click(combo)
    await user.click(await screen.findByRole("option", { name: "路径前缀" }))

    // 选中生效的直接证据：匹配方式已切换，表单换成路径前缀输入
    const pathInput = screen.getByLabelText("路径前缀（必填）")
    setValue(pathInput, "/api")
    setValue(screen.getByLabelText("上游地址（必填）"), "localhost:8080")

    screen.getByRole("button", { name: "新增规则" }).click()

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const input = onSubmit.mock.calls[0]?.[0]
    expect(input.matchKind).toBe("path")
    expect(input.pathPrefix).toBe("/api")
    expect(input.host).toBeNull()
  })
})
