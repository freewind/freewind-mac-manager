// @vitest-environment jsdom

import type { FileEntry } from "@shared/api-contract"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FilesModel } from "@web/features/files/useFiles"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FilesPage } from "./FilesPage"
import { FileTable } from "./FileTable"

/** 捕获传给 ResizablePanel 的尺寸参数，用来断言传的是百分比字符串而不是像素数字。 */
const { panelProps } = vi.hoisted(() => ({
  panelProps: [] as {
    defaultSize?: unknown
    minSize?: unknown
    maxSize?: unknown
  }[],
}))

type MockPanelProps = {
  children?: ReactNode
  defaultSize?: unknown
  minSize?: unknown
  maxSize?: unknown
}

// 真实 ResizablePanel 的尺寸只在有布局宽度时才落到 DOM；jsdom 里量不到宽度，
// 所以这里替身掉它，只捕获传入的 props（不改官方源码）
vi.mock("@web/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children?: ReactNode }) => children,
  ResizablePanel: ({ children, ...sizes }: MockPanelProps) => {
    panelProps.push({
      defaultSize: sizes.defaultSize,
      minSize: sizes.minSize,
      maxSize: sizes.maxSize,
    })
    return children
  },
  ResizableHandle: () => null,
}))

let modelOverrides: Partial<FilesModel> = {}

vi.mock("@web/features/files/useFiles", () => ({
  useFiles: () => createFilesModel(modelOverrides),
}))

vi.mock("@web/features/files/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@web/features/files/queries")>()),
  useDirectoryQuery: () => ({
    data: { path: "/Users/demo", entries: [] },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  filesKeys: { all: ["files"] },
}))

const fileEntry = (overrides: Partial<FileEntry> = {}): FileEntry => ({
  name: "notes.txt",
  path: "/Users/demo/notes.txt",
  kind: "file",
  size: 2048,
  modified: 1_700_000_000,
  ...overrides,
})

const createFilesModel = (overrides: Partial<FilesModel> = {}): FilesModel => ({
  rootPath: "/Users/demo",
  currentPath: "/Users/demo",
  entries: [],
  crumbs: [{ name: "/Users/demo", path: "/Users/demo" }],
  selectedEntries: [],
  isLoading: false,
  isFetching: false,
  isMutating: false,
  error: null,
  isExpanded: () => false,
  toggleExpanded: () => undefined,
  collapseAll: () => undefined,
  search: {
    query: "",
    mode: "substring",
    caseSensitive: false,
    searchContent: true,
    scope: "current",
    active: false,
  },
  setSearchQuery: () => undefined,
  setSearchScope: () => undefined,
  setSearchMode: () => undefined,
  setSearchCaseSensitive: () => undefined,
  setSearchContent: () => undefined,
  submitSearch: () => undefined,
  clearSearch: () => undefined,
  searchResult: null,
  searchLoading: false,
  searchError: null,
  openSearchResult: () => undefined,
  selected: [],
  isSelected: () => false,
  selectOnly: () => undefined,
  toggleSelected: () => undefined,
  setSelectedForPaths: () => undefined,
  clearSelection: () => undefined,
  enterDirectory: () => undefined,
  goToParent: () => undefined,
  canGoUp: false,
  refresh: () => undefined,
  createEntry: async () => false,
  renameEntry: async () => false,
  deleteEntries: async () => false,
  transferEntries: async () => false,
  downloadEntry: () => undefined,
  ...overrides,
})

let desktop = true

/** 与 useIsDesktop 一致的匹配媒体查询替身：改 desktop 就切换断点。 */
const setDesktop = (value: boolean) => {
  desktop = value
}

beforeEach(() => {
  desktop = true
  modelOverrides = {}
  panelProps.length = 0
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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.style.overflow = ""
  document.body.style.pointerEvents = ""
  window.history.replaceState({}, "", "/")
})

describe("文件页布局尺寸", () => {
  it("目录面板传的是无单位百分比字符串，而不是被当成像素的数字", () => {
    render(<FilesPage />)

    const treePanel = panelProps[0]
    expect(treePanel).toBeDefined()
    // 数字会被 react-resizable-panels 解释成像素（22px），这正是面板塌缩的成因
    expect(typeof treePanel?.defaultSize).toBe("string")
    expect(treePanel?.defaultSize).toBe("22")
    expect(treePanel?.minSize).toBe("12")
    expect(treePanel?.maxSize).toBe("45")

    for (const size of [
      treePanel?.defaultSize,
      treePanel?.minSize,
      treePanel?.maxSize,
    ]) {
      expect(String(size)).toMatch(/^\d+(?:\.\d+)?%?$/)
    }
  })

  it("手机断点下不渲染「大小」列，名称与修改时间仍在，且「返回上一层」跨列与可见列数一致", () => {
    setDesktop(false)
    render(
      <FileTable
        model={createFilesModel({
          entries: [fileEntry()],
          canGoUp: true,
        })}
        rowActions={[]}
      />
    )

    expect(screen.queryByRole("columnheader", { name: /大小/ })).toBeNull()
    expect(screen.getByRole("columnheader", { name: /名称/ })).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: /修改时间/ })).toBeTruthy()
    // 名称列可用：文件名完整可取
    expect(screen.getByText("notes.txt")).toBeTruthy()

    // 可见列只有勾选 + 名称 + 修改时间，跨列单元格必须跟着少一列
    const upRowCell = screen
      .getByRole("button", { name: /返回上一层/ })
      .closest("td")
    expect(upRowCell?.getAttribute("colspan")).toBe("2")
  })

  it("桌面断点下「大小」列存在", () => {
    setDesktop(true)
    render(
      <FileTable
        model={createFilesModel({ entries: [fileEntry()] })}
        rowActions={[]}
      />
    )
    expect(screen.getByRole("columnheader", { name: /大小/ })).toBeTruthy()
  })

  it("未选中任何条目时，操作菜单里的五个动作都是禁用态", async () => {
    const user = userEvent.setup()
    render(<FilesPage />)

    await user.click(screen.getByRole("button", { name: /操作/ }))

    for (const label of ["重命名", "复制到…", "移动到…", "下载", "删除"]) {
      const item = await screen.findByRole("menuitem", { name: label })
      expect(item.getAttribute("aria-disabled")).toBe("true")
    }
  })

  it("操作入口的可访问名称带上对象：单选用文件名，多选用数量", () => {
    modelOverrides = {
      selectedEntries: [fileEntry({ name: "network-rules.yaml" })],
    }
    const single = render(<FilesPage />)
    expect(
      screen.getByRole("button", { name: "对 network-rules.yaml 的操作" })
    ).toBeTruthy()
    single.unmount()

    modelOverrides = {
      selectedEntries: [
        fileEntry({ name: "a.txt", path: "/Users/demo/a.txt" }),
        fileEntry({ name: "b.txt", path: "/Users/demo/b.txt" }),
      ],
    }
    render(<FilesPage />)
    expect(
      screen.getByRole("button", { name: "对选中的 2 个条目的操作" })
    ).toBeTruthy()
  })

  it("选中一个文件后同样的五个动作可用（对照：不是菜单整体被禁用）", async () => {
    const user = userEvent.setup()
    modelOverrides = { selectedEntries: [fileEntry()] }
    render(<FilesPage />)

    await user.click(screen.getByRole("button", { name: /操作/ }))

    for (const label of ["重命名", "复制到…", "移动到…", "下载", "删除"]) {
      const item = await screen.findByRole("menuitem", { name: label })
      expect(item.getAttribute("aria-disabled")).not.toBe("true")
    }
  })
})

describe("目录内搜索", () => {
  it("搜索激活时展示来源、条数、截断标志与内容摘要", () => {
    modelOverrides = {
      search: {
        query: "needle",
        mode: "substring",
        caseSensitive: false,
        searchContent: true,
        scope: "subtree",
        active: true,
      },
      searchResult: {
        root: "/Users/demo",
        query: "needle",
        matches: [
          {
            path: "/Users/demo/sub/gamma.txt",
            name: "gamma.txt",
            kind: "file",
            size: 12,
            modified: 1_700_000_000,
            source: "content",
            snippet: "needle in sub",
            lineNumber: 7,
          },
          {
            path: "/Users/demo/needle.txt",
            name: "needle.txt",
            kind: "file",
            size: 20,
            modified: 1_700_000_100,
            source: "name",
            snippet: null,
            lineNumber: null,
          },
        ],
        scannedFiles: 12,
        truncated: true,
      },
    }
    render(<FilesPage />)

    expect(screen.getByText(/命中 2 条 · 已扫描 12 个文件/)).toBeTruthy()
    expect(screen.getByText("结果已截断，只显示前一部分")).toBeTruthy()
    // 两种来源可区分：内容命中带摘要与行号，文件名命中没有摘要
    expect(screen.getByText("内容")).toBeTruthy()
    expect(screen.getByText("文件名")).toBeTruthy()
    expect(screen.getByText(/第 7 行：needle in sub/)).toBeTruthy()
    // 深层结果显示相对搜索根的路径，能看出来自哪个子目录
    expect(screen.getByText("sub/gamma.txt")).toBeTruthy()
    // 当前层结果的相对路径就是文件名，与按钮同名，用 getAll 断言其在
    expect(screen.getAllByText("needle.txt").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole("button", { name: "退出搜索" })).toBeTruthy()
  })

  it("仅当前目录没有结果时提示可以切到含子目录", () => {
    modelOverrides = {
      search: {
        query: "needle",
        mode: "substring",
        caseSensitive: false,
        searchContent: true,
        scope: "current",
        active: true,
      },
      searchResult: {
        root: "/Users/demo",
        query: "needle",
        matches: [],
        scannedFiles: 3,
        truncated: false,
      },
    }
    render(<FilesPage />)

    expect(
      screen.getByText(/当前目录没有匹配的文件；子目录里可能有/)
    ).toBeTruthy()
  })
})
