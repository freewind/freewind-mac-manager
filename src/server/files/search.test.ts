import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  type FileSearchInput,
  findSnippet,
  matchFileName,
  searchFiles,
} from "./search"

let root: string

const search = (overrides: Partial<FileSearchInput> = {}) =>
  searchFiles({
    root,
    query: "needle",
    mode: "substring",
    caseSensitive: false,
    searchContent: false,
    maxDepth: 3,
    limit: 200,
    ...overrides,
  })

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "mac-manager-search-")))
  writeFileSync(
    path.join(root, "alpha.txt"),
    "first line\nsecond NEEDLE line\n"
  )
  writeFileSync(path.join(root, "beta.log"), "nothing here\n")
  mkdirSync(path.join(root, "sub"))
  writeFileSync(path.join(root, "sub", "gamma.txt"), "needle in sub\n")
  mkdirSync(path.join(root, "sub", "deep"))
  writeFileSync(path.join(root, "sub", "deep", "delta.txt"), "needle deep\n")
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("matchFileName", () => {
  it("子串、精确与通配三种模式，各按大小写开关工作", () => {
    expect(matchFileName("gamma.txt", "amma", "substring", false)).toBe(true)
    expect(matchFileName("gamma.txt", "gamma.txt", "exact", false)).toBe(true)
    expect(matchFileName("gamma.txt", "gamma", "exact", false)).toBe(false)
    expect(matchFileName("gamma.txt", "*.txt", "wildcard", false)).toBe(true)
    expect(matchFileName("gamma.txt", "*.log", "wildcard", false)).toBe(false)
    // 通配模式里 . 按字面处理，不会变成任意字符
    expect(matchFileName("gammaXtxt", "*.txt", "wildcard", false)).toBe(false)
    expect(matchFileName("Gamma.txt", "gamma", "substring", true)).toBe(false)
    expect(matchFileName("Gamma.txt", "gamma", "substring", false)).toBe(true)
  })
})

describe("findSnippet", () => {
  it("返回首个命中行与行号，行号从 1 开始", () => {
    expect(
      findSnippet("a\nneedle here\nneedle again", "needle", false)
    ).toEqual({ lineNumber: 2, text: "needle here" })
    expect(findSnippet("a\nb\n", "needle", false)).toBeNull()
  })
})

describe("目录内搜索", () => {
  it("文件名命中如实标出来源为 name", async () => {
    const result = await search({ query: "gamma" })

    expect(result.root).toBe(root)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.source).toBe("name")
    expect(result.matches[0]?.path).toBe(path.join(root, "sub", "gamma.txt"))
    expect(result.matches[0]?.snippet).toBeNull()
    expect(result.truncated).toBe(false)
  })

  it("内容命中带出匹配行与行号", async () => {
    const result = await search({ query: "needle", searchContent: true })

    const hit = result.matches.find(
      (item) => item.path === path.join(root, "sub", "gamma.txt")
    )
    expect(hit?.source).toBe("content")
    expect(hit?.snippet).toBe("needle in sub")
    expect(hit?.lineNumber).toBe(1)
    // alpha.txt 里是大写 NEEDLE：不区分大小写时命中第 2 行
    const upper = result.matches.find(
      (item) => item.path === path.join(root, "alpha.txt")
    )
    expect(upper?.lineNumber).toBe(2)
    expect(upper?.snippet).toBe("second NEEDLE line")
    // 未开内容搜索时只有文件名参与匹配
    const nameOnly = await search({ query: "needle" })
    expect(nameOnly.matches).toHaveLength(0)
  })

  it("大小写开关生效：区分大小写时小写查询不命中大写内容", async () => {
    const insensitive = await search({
      query: "needle",
      searchContent: true,
      caseSensitive: false,
    })
    const sensitive = await search({
      query: "needle",
      searchContent: true,
      caseSensitive: true,
    })

    expect(
      insensitive.matches.some(
        (item) => item.path === path.join(root, "alpha.txt")
      )
    ).toBe(true)
    expect(
      sensitive.matches.some(
        (item) => item.path === path.join(root, "alpha.txt")
      )
    ).toBe(false)
    // 小写内容仍能命中，说明是大小写开关而不是整体关掉了匹配
    expect(
      sensitive.matches.some(
        (item) => item.path === path.join(root, "sub", "gamma.txt")
      )
    ).toBe(true)
  })

  it("限深生效：深于上限的文件不返回", async () => {
    const shallow = await search({
      query: "delta",
      searchContent: true,
      maxDepth: 1,
    })
    const deeper = await search({
      query: "delta",
      searchContent: true,
      maxDepth: 3,
    })

    expect(shallow.matches).toHaveLength(0)
    expect(deeper.matches.map((item) => item.path)).toContain(
      path.join(root, "sub", "deep", "delta.txt")
    )
  })

  it("达到条数上限时截断并如实置位", async () => {
    const result = await search({
      query: "needle",
      searchContent: true,
      limit: 1,
    })

    expect(result.matches).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it("通配模式按文件名筛选整棵子树", async () => {
    const result = await search({ query: "*.txt", mode: "wildcard" })

    expect(result.matches.map((item) => item.name).sort()).toEqual([
      "alpha.txt",
      "delta.txt",
      "gamma.txt",
    ])
    expect(result.matches.every((item) => item.source === "name")).toBe(true)
  })

  it("范围：仅当前目录不返回子目录文件，含子目录才递归", async () => {
    const currentOnly = await search({ query: "gamma", maxDepth: 1 })
    const subtree = await search({ query: "gamma", maxDepth: 3 })

    expect(currentOnly.matches).toHaveLength(0)
    expect(subtree.matches.map((item) => item.path)).toEqual([
      path.join(root, "sub", "gamma.txt"),
    ])
    // 当前层的文件在两种范围下都能找到
    expect((await search({ query: "beta", maxDepth: 1 })).matches).toHaveLength(
      1
    )
  })

  it("内容搜索同样遵守范围：仅当前目录不会命中子目录文件的内容", async () => {
    // gamma.txt 的内容里有 sub，alpha.txt 没有；只有递归到子目录才该命中
    const currentOnly = await search({
      query: "sub",
      searchContent: true,
      maxDepth: 1,
    })
    const subtree = await search({
      query: "sub",
      searchContent: true,
      maxDepth: 3,
    })

    expect(currentOnly.matches).toHaveLength(0)
    expect(subtree.matches.map((item) => item.path)).toContain(
      path.join(root, "sub", "gamma.txt")
    )
    expect(subtree.matches.every((item) => item.source === "content")).toBe(
      true
    )
  })

  it("不是目录的根路径被拒绝", async () => {
    await expect(
      search({ root: path.join(root, "alpha.txt") })
    ).rejects.toThrow("不是目录")
  })

  it("根路径不在允许范围时拒绝，防目录穿越", async () => {
    // FILE_ROOT 在模块加载时求值：重置模块并改环境变量后再取一份实现
    vi.resetModules()
    vi.stubEnv("FILE_ROOT", path.join(root, "sub"))
    const { searchFiles: scoped } = await import("./search")

    await expect(
      scoped({
        root,
        query: "needle",
        mode: "substring",
        caseSensitive: false,
        searchContent: false,
        maxDepth: 1,
        limit: 10,
      })
    ).rejects.toThrow("路径不在允许范围")
    // 在允许范围内的子目录仍可用
    await expect(
      scoped({
        root: path.join(root, "sub"),
        query: "gamma",
        mode: "substring",
        caseSensitive: false,
        searchContent: false,
        maxDepth: 1,
        limit: 10,
      })
    ).resolves.toMatchObject({ truncated: false })

    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
