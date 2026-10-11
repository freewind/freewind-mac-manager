// @vitest-environment jsdom

import type { TreeNode } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { IcicleChart } from "@web/features/disk-growth/IcicleChart"
import { diskGrowthKeys } from "@web/features/disk-growth/queries"
import { afterEach, describe, expect, it } from "vitest"

/** 受控树：两个匹配 /Library 的路径 + 一个不匹配，用来验证匹配计数。 */
const tree: TreeNode = {
  path: "/",
  name: "/",
  kind: "dir",
  size: 900,
  delta: 0,
  folded: false,
  children: [
    {
      path: "/Library",
      name: "Library",
      kind: "dir",
      size: 500,
      delta: 0,
      folded: false,
      children: [
        {
          path: "/Library/Caches",
          name: "Caches",
          kind: "dir",
          size: 300,
          delta: 0,
          folded: false,
          children: [],
        },
      ],
    },
    {
      path: "/Library/Caches/Library",
      name: "Library",
      kind: "dir",
      size: 200,
      delta: 0,
      folded: false,
      children: [],
    },
    {
      path: "/Applications",
      name: "Applications",
      kind: "dir",
      size: 200,
      delta: 0,
      folded: false,
      children: [],
    },
  ],
}

const makeClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  })

const renderChart = (keyword?: string) => {
  const client = makeClient()
  // IcicleChart 固定请求 depth = MAX_DEPTH + 1 = 5 的树
  client.setQueryData(diskGrowthKeys.tree(1, null, "", 5), tree)
  return render(
    <QueryClientProvider client={client}>
      <IcicleChart scanId={1} baselineScanId={null} keyword={keyword} />
    </QueryClientProvider>
  )
}

afterEach(cleanup)

describe("IcicleChart 搜索高亮", () => {
  it("有关键字时仍渲染全部节点，并显示匹配数量", () => {
    renderChart("Library")

    // /Library、/Library/Caches/Library 两个同名节点各渲染一次
    expect(
      screen.getAllByRole("button", { name: "/Library，500 B" }).length
    ).toBe(1)
    expect(
      screen.getByRole("button", { name: "/Applications，200 B" })
    ).toBeTruthy()
    expect(screen.getByText("匹配 3 个路径")).toBeTruthy()
  })

  it("关键字无匹配时显示没有匹配的路径，块仍然渲染", () => {
    renderChart("不存在的东西")

    expect(screen.getByText("没有匹配的路径")).toBeTruthy()
    expect(screen.getByRole("button", { name: "/Library，500 B" })).toBeTruthy()
  })

  it("不带关键字时不显示匹配计数", () => {
    renderChart()

    expect(screen.queryByText(/匹配 \d+ 个路径/)).toBeNull()
    expect(screen.queryByText("没有匹配的路径")).toBeNull()
  })
})
