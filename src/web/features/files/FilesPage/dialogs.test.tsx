// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DeleteDialog } from "./DeleteDialog"
import { EntryNameDialog } from "./EntryNameDialog"
import { MoveDialog } from "./MoveDialog"

vi.mock("@web/features/files/queries", () => ({
  useDirectoryQuery: (path: string) => ({
    data: {
      path,
      entries:
        path === "/root/source"
          ? [{ name: "target", path: "/root/source/target", kind: "dir" }]
          : [],
    },
    isLoading: false,
    isError: false,
  }),
}))

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
afterEach(cleanup)

const deferred = () => {
  let resolve: (accepted: boolean) => void = () => {}
  const promise = new Promise<boolean>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const disabled = (element: HTMLElement) =>
  (element as HTMLButtonElement).disabled

describe("file operation dialogs", () => {
  it.each(["copy", "move"] as const)(
    "keeps %s targets stable until acceptance",
    async (mode) => {
      const result = deferred()
      const onSubmit = vi.fn(() => result.promise)
      const onOpenChange = vi.fn()
      render(
        <MoveDialog
          open
          mode={mode}
          rootPath="/root"
          startPath="/root/source"
          names={["notes.txt"]}
          onSubmit={onSubmit}
          onOpenChange={onOpenChange}
        />
      )
      await userEvent.click(screen.getByRole("button", { name: "target" }))
      await userEvent.click(
        screen.getByRole("button", {
          name: mode === "copy" ? "复制到这里" : "移动到这里",
        })
      )
      expect(onSubmit).toHaveBeenCalledWith("/root/source/target")
      expect(
        disabled(
          screen.getByRole("button", {
            name: mode === "copy" ? "复制中…" : "移动中…",
          })
        )
      ).toBe(true)
      expect(disabled(screen.getByRole("button", { name: "上一层" }))).toBe(
        true
      )
      expect(onOpenChange).not.toHaveBeenCalled()
      await act(async () => result.resolve(true))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    }
  )
  it("keeps the delete target visible, blocks repeats and closes after acceptance", async () => {
    const result = deferred()
    const onConfirm = vi.fn(() => result.promise)
    const onOpenChange = vi.fn()
    render(
      <DeleteDialog
        open
        names={["report.txt"]}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />
    )
    const button = screen.getByRole("button", { name: "删除" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByText("report.txt")).toBeTruthy()
    expect(disabled(screen.getByRole("button", { name: "删除中…" }))).toBe(true)
    expect(disabled(screen.getByRole("button", { name: "取消" }))).toBe(true)
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => result.resolve(true))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("删除确认框完整列出超长文件名，靠换行与框内滚动而不是省略号", () => {
    const longName =
      "2026-05-18-backup-of-very-long-directory-name-with-detail-report-final.txt"
    render(
      <DeleteDialog
        open
        names={[longName, "b.txt"]}
        onConfirm={async () => true}
        onOpenChange={() => undefined}
      />
    )

    const item = screen.getByText(longName)
    // 危险动作确认里对象名要能直接读全：不能靠省略号，也不能只靠 hover
    expect(item.className).not.toContain("truncate")
    expect(item.className).toContain("break-all")
    const list = item.closest("ul")
    expect(list?.className).toContain("max-h-48")
    expect(list?.className).toContain("overflow-y-auto")
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })

  it("移动确认能数出对象总数并完整列出全部名字", () => {
    const longName =
      "2026-05-18-backup-of-very-long-directory-name-with-detail-report-final.txt"
    render(
      <MoveDialog
        open
        mode="move"
        rootPath="/root"
        startPath="/root/source"
        names={[longName, "b.txt", "c.txt"]}
        onSubmit={async () => true}
        onOpenChange={() => undefined}
      />
    )

    // 数得出共有几个对象
    expect(
      screen.getByText("共有 3 个条目会移动到选定目录，完整清单如下：")
    ).toBeTruthy()
    const list = screen.getByRole("list", { name: "待移动的 3 个条目" })
    expect(list.className).toContain("max-h-24")
    expect(list.className).toContain("overflow-y-auto")
    // 每个名字都完整列出，不省略
    for (const name of [longName, "b.txt", "c.txt"]) {
      const item = within(list).getByText(name)
      expect(item.className).not.toContain("truncate")
    }
  })

  it("preserves the delete confirmation after a rejected operation", async () => {
    const onOpenChange = vi.fn()
    render(
      <DeleteDialog
        open
        names={["report.txt"]}
        onConfirm={async () => false}
        onOpenChange={onOpenChange}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "删除" }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(disabled(screen.getByRole("button", { name: "删除" }))).toBe(false)
    expect(screen.getByText("report.txt")).toBeTruthy()
  })

  it("preserves entered names after failure and closes only after success", async () => {
    const result = deferred()
    const onSubmit = vi.fn(() => result.promise)
    const onOpenChange = vi.fn()
    render(
      <EntryNameDialog
        open
        title="新建文件"
        description="当前目录"
        confirmText="创建"
        onSubmit={onSubmit}
        onOpenChange={onOpenChange}
      />
    )
    const input = screen.getByRole("textbox", { name: "名称" })
    await userEvent.type(input, "notes.txt")
    const form = input.closest("form")
    if (!form) throw new Error("未找到命名表单")
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith("notes.txt")
    expect(disabled(screen.getByRole("button", { name: "执行中…" }))).toBe(true)
    await act(async () => result.resolve(false))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe("notes.txt")
    onSubmit.mockResolvedValueOnce(true)
    await userEvent.click(screen.getByRole("button", { name: "创建" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("keeps the form open when an action throws and restores controls", async () => {
    const onOpenChange = vi.fn()
    render(
      <EntryNameDialog
        open
        title="重命名"
        description="当前名称"
        confirmText="保存"
        initialValue="old.txt"
        onSubmit={async () => {
          throw new Error("连接中断")
        }}
        onOpenChange={onOpenChange}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "保存" }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(disabled(screen.getByRole("button", { name: "保存" }))).toBe(false)
    expect(
      (screen.getByRole("textbox", { name: "名称" }) as HTMLInputElement).value
    ).toBe("old.txt")
  })
})
