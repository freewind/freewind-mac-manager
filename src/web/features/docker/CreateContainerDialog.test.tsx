// @vitest-environment jsdom

import type { DockerImage } from "@shared/api-contract"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CreateContainerDialog } from "./CreateContainerDialog"

const images: DockerImage[] = [
  {
    id: "sha256:abc",
    repository: "alpine",
    tag: "3.20",
    sizeBytes: 12_200_000,
    createdAt: 1_790_000_000_000,
    containers: 0,
  },
]

const renderDialog = (
  overrides: Partial<Parameters<typeof CreateContainerDialog>[0]> = {}
) => {
  const onSubmit = vi.fn()
  render(
    <CreateContainerDialog
      open
      onOpenChange={() => undefined}
      images={images}
      busy={false}
      failure={null}
      onSubmit={onSubmit}
      {...overrides}
    />
  )
  return { onSubmit }
}

/** React 受控输入需要原生 setter + input 事件。 */
const setValue = (element: HTMLElement, value: string): void => {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

afterEach(cleanup)

describe("新建容器表单", () => {
  it("镜像必填，缺失时在字段旁提示且不提交", async () => {
    const { onSubmit } = renderDialog()
    screen.getByRole("button", { name: "创建并启动" }).click()
    expect(await screen.findByText("请填写镜像地址")).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("端口越界时在字段旁提示且不提交", async () => {
    const { onSubmit } = renderDialog()
    setValue(screen.getByLabelText("镜像（必填）"), "alpine:3.20")
    setValue(screen.getByLabelText("第 1 行宿主机端口"), "70000")
    setValue(screen.getByLabelText("第 1 行容器端口"), "80")
    screen.getByRole("button", { name: "创建并启动" }).click()
    expect(
      await screen.findByText("端口必须是 1–65535 的整数，且成对填写")
    ).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("容器内路径不是绝对路径时提示且不提交", async () => {
    const { onSubmit } = renderDialog()
    setValue(screen.getByLabelText("镜像（必填）"), "alpine:3.20")
    setValue(screen.getByLabelText("第 1 行宿主路径或卷名"), "myvol")
    setValue(screen.getByLabelText("第 1 行容器内路径"), "data")
    screen.getByRole("button", { name: "创建并启动" }).click()
    expect(
      await screen.findByText("容器内路径必须是绝对路径（以 / 开头）")
    ).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("合法提交：载荷正确，多行命令按行拆成 argv（不按空格分词）", () => {
    const { onSubmit } = renderDialog()
    setValue(screen.getByLabelText("镜像（必填）"), "alpine:3.20")
    setValue(screen.getByLabelText("容器名（可选）"), "smoke-web")
    setValue(screen.getByLabelText("第 1 行宿主机端口"), "8080")
    setValue(screen.getByLabelText("第 1 行容器端口"), "80")
    setValue(screen.getByLabelText("第 1 行宿主路径或卷名"), "myvol")
    setValue(screen.getByLabelText("第 1 行容器内路径"), "/data")
    setValue(screen.getByLabelText("第 1 行变量名"), "MODE")
    setValue(screen.getByLabelText("第 1 行变量值"), "prod")
    setValue(
      screen.getByLabelText("覆盖启动命令（可选，每行一个参数）"),
      "redis-server\n--save 60 1\nyes"
    )
    screen.getByRole("button", { name: "创建并启动" }).click()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      image: "alpine:3.20",
      name: "smoke-web",
      ports: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }],
      volumes: [{ source: "myvol", destination: "/data" }],
      env: [{ name: "MODE", value: "prod" }],
      restartPolicy: "no",
      // 「--save 60 1」是一整行，因此是数组里的一个元素
      command: ["redis-server", "--save 60 1", "yes"],
    })
  })

  it("服务端失败文案在对话框内持续展示", () => {
    renderDialog({ failure: "本地没有该镜像，请先在镜像页拉取" })
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("本地没有该镜像，请先在镜像页拉取")
  })

  it("提交中禁用所有输入与按钮", () => {
    renderDialog({ busy: true })
    const dialog = screen.getByRole("dialog")
    // 逐个按可访问标签断言输入被禁用
    for (const label of [
      "镜像（必填）",
      "容器名（可选）",
      "第 1 行宿主机端口",
      "第 1 行容器端口",
      "第 1 行宿主路径或卷名",
      "第 1 行容器内路径",
      "第 1 行变量名",
      "第 1 行变量值",
      "覆盖启动命令（可选，每行一个参数）",
    ]) {
      expect(screen.getByLabelText(label)).toHaveProperty("disabled", true)
    }
    const enabledButtons = within(dialog)
      .getAllByRole("button")
      .filter((button) => !button.hasAttribute("disabled"))
      .map(
        (button) =>
          button.getAttribute("aria-label") ?? button.textContent?.trim()
      )
    // 唯一例外是官方 Dialog 自带的关闭按钮（源码禁改），业务按钮全部禁用
    expect(enabledButtons).toEqual(["Close"])
  })
})
