// @vitest-environment jsdom

import { CLASH_VERGE_MERGE_MAX_CHARS } from "@shared/api-contract/schemas/clash-verge"
import { ApiRequestError } from "@shared/client-api"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MergeFilePanel } from "./MergeFilePanel"
import { MERGE_ALIAS_TEMPLATE } from "./merge-template"

const { fetchers } = vi.hoisted(() => ({
  fetchers: {
    read: vi.fn(),
    save: vi.fn(),
  },
}))

vi.mock("@shared/client-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/client-api")>()
  return {
    ...actual,
    fetchClashVergeMergeFile: fetchers.read,
    saveClashVergeMergeFile: fetchers.save,
  }
})

const baseFile = {
  path: "/tmp/profiles/Merge.yaml",
  content: "prepend-rules:\n  - MATCH,DIRECT\n",
  size: 120,
  modified: 1_700_000_000,
}

const renderPanel = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={client}>
      <MergeFilePanel />
    </QueryClientProvider>
  )
}

/** 等待只读内容出现后再进行交互。 */
const renderLoaded = async () => {
  renderPanel()
  await screen.findByText(/MATCH,DIRECT/)
}

afterEach(() => {
  cleanup()
  fetchers.read.mockReset()
  fetchers.save.mockReset()
})

describe("MergeFilePanel", () => {
  it("展示路径、大小与修改时间，并常驻落盘重载提示", async () => {
    fetchers.read.mockResolvedValue(baseFile)
    await renderLoaded()
    expect(screen.getByText("/tmp/profiles/Merge.yaml")).toBeTruthy()
    expect(screen.getByText("120 B")).toBeTruthy()
    expect(screen.getByText(/保存只落盘/)).toBeTruthy()
    expect(screen.getByText(/不修改订阅专属 merge/)).toBeTruthy()
  })

  it("文件超过上限时禁用编辑并给出提示", async () => {
    fetchers.read.mockResolvedValue({
      ...baseFile,
      content: "x".repeat(CLASH_VERGE_MERGE_MAX_CHARS + 1),
    })
    renderPanel()
    const edit = await screen.findByRole("button", { name: "编辑" })
    expect(edit.hasAttribute("disabled")).toBe(true)
    expect(screen.getByText(/已禁用编辑/)).toBeTruthy()
  })

  it("保存中按钮不可重复提交", async () => {
    const user = userEvent.setup()
    fetchers.read.mockResolvedValue(baseFile)
    let resolveSave: (value: { message: string }) => void = () => {}
    fetchers.save.mockImplementation(
      () =>
        new Promise<{ message: string }>((resolve) => {
          resolveSave = resolve
        })
    )
    await renderLoaded()
    await user.click(screen.getByRole("button", { name: "编辑" }))
    const textarea = screen.getByLabelText("编辑 Merge 规则内容")
    await user.type(textarea, "# 改动")
    const saveButton = screen.getByRole("button", { name: "保存" })
    await user.click(saveButton)
    // 保存中：按钮文案变化并禁用，再点不会发出第二次请求。
    expect(await screen.findByRole("button", { name: "保存中…" })).toBeTruthy()
    const busy = screen.getByRole("button", { name: "保存中…" })
    expect(busy.hasAttribute("disabled")).toBe(true)
    await user.click(busy)
    resolveSave({ message: "已写入" })
    await waitFor(() => expect(fetchers.save).toHaveBeenCalledTimes(1))
  })

  it("保存前预检发现外部修改时提示冲突，不发出写入", async () => {
    const user = userEvent.setup()
    fetchers.read
      .mockResolvedValueOnce(baseFile) // 初次加载
      .mockResolvedValue({ ...baseFile, modified: 1_700_000_999 }) // 预检
    await renderLoaded()
    await user.click(screen.getByRole("button", { name: "编辑" }))
    const textarea = screen.getByLabelText("编辑 Merge 规则内容")
    await user.type(textarea, "# 改动")
    await user.click(screen.getByRole("button", { name: "保存" }))
    const alert = await screen.findByText("检测到外部修改")
    expect(alert).toBeTruthy()
    expect(fetchers.save).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "重新加载" })).toBeTruthy()
    // 显式覆盖是知情选择，点击后才写入。
    await user.click(screen.getByRole("button", { name: "显式覆盖保存" }))
    await waitFor(() => expect(fetchers.save).toHaveBeenCalledTimes(1))
    expect(fetchers.save).toHaveBeenCalledWith(
      expect.stringContaining("# 改动")
    )
  })

  it("超时中断显示结果未知，禁止再次提交，只能重新读取核实", async () => {
    const user = userEvent.setup()
    fetchers.read.mockResolvedValue(baseFile)
    fetchers.save.mockRejectedValue(
      new ApiRequestError(
        "等待响应超时，结果未知，请重新读取确认",
        null,
        undefined,
        undefined,
        true
      )
    )
    await renderLoaded()
    await user.click(screen.getByRole("button", { name: "编辑" }))
    const textarea = screen.getByLabelText("编辑 Merge 规则内容")
    await user.type(textarea, "# 改动")
    await user.click(screen.getByRole("button", { name: "保存" }))
    const unknown = await screen.findByText("结果未知")
    expect(unknown).toBeTruthy()
    expect(screen.getByText(/可能已写入，也可能没有/)).toBeTruthy()
    // 结果未知期间：保存按钮禁用，不自动重试，也不谎报成功。
    const saveButton = screen.getByRole("button", { name: "保存" })
    expect(saveButton.hasAttribute("disabled")).toBe(true)
    expect(fetchers.save).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "重新读取核实" })).toBeTruthy()
  })

  it("复制别名行模板到剪贴板，不直接写入用户文件", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    fetchers.read.mockResolvedValue(baseFile)
    await renderLoaded()
    await user.click(screen.getByRole("button", { name: "复制别名行模板" }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(MERGE_ALIAS_TEMPLATE)
    expect(MERGE_ALIAS_TEMPLATE).toContain("prepend-rules")
    expect(MERGE_ALIAS_TEMPLATE).toContain("prepend-proxy-groups")
    expect(MERGE_ALIAS_TEMPLATE).toContain("include-all-proxies: true")
    // 复制只是入口：没有任何保存请求，文件内容保持原样。
    expect(fetchers.save).not.toHaveBeenCalled()
    expect(screen.getByText(/MATCH,DIRECT/)).toBeTruthy()
  })

  it("读取失败时如实展示错误并提供重新读取", async () => {
    const user = userEvent.setup()
    fetchers.read.mockRejectedValue(
      new ApiRequestError(
        "请求失败（HTTP 404）：找不到 Clash Verge 全局 Merge 文件",
        404
      )
    )
    renderPanel()
    expect(await screen.findByText("读取失败")).toBeTruthy()
    expect(screen.getByText(/找不到 Clash Verge 全局 Merge 文件/)).toBeTruthy()
    fetchers.read.mockResolvedValue(baseFile)
    await user.click(screen.getByRole("button", { name: "重新读取" }))
    await screen.findByText(/MATCH,DIRECT/)
  })
})
