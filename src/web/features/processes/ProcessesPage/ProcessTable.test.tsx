// @vitest-environment jsdom

import type { ProcessEntry } from "@shared/api-contract"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { useProcesses } from "@web/features/processes/useProcesses"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ProcessTable } from "./ProcessTable"

/** 复现线上裁切数据：多线程进程实测 148.4% / 176.0% / 153.3%。 */
const processEntry = (overrides: Partial<ProcessEntry> = {}): ProcessEntry => ({
  pid: 4821,
  ppid: 1,
  name: "vite",
  command: "node node_modules/.bin/vite --host 127.0.0.1",
  path: "/usr/local/bin/node",
  user: "freewind",
  state: "running",
  kind: "app",
  cpu: 148.4,
  memoryBytes: 512 * 1024 ** 2,
  threads: 37,
  ports: [51509, 51510],
  startedAt: 1_700_000_000,
  ...overrides,
})

/** ProcessTable 只消费 model 的这些字段，其余用空实现补齐类型。 */
const createModel = (
  items: ProcessEntry[]
): ReturnType<typeof useProcesses> => ({
  processes: items,
  filteredProcesses: items,
  overview: null,
  currentUser: "freewind",
  peakMemoryBytes: 512 * 1024 ** 2,
  threadCount: 37,
  isLoading: false,
  isFetching: false,
  error: null,
  updatedAt: 1_700_000_000_000,
  nowMs: 1_700_000_600_000,
  secondsSinceUpdate: 0,
  scope: "all",
  setScope: () => undefined,
  search: "",
  setSearch: () => undefined,
  autoRefresh: false,
  setAutoRefresh: () => undefined,
  checkedPids: [],
  toggleChecked: () => undefined,
  setChecked: () => undefined,
  selectedPid: null,
  selectProcess: () => undefined,
  refresh: () => undefined,
  terminate: () => undefined,
  killBusy: false,
  checkedProcesses: [],
  checkedSummary: { cpu: 0, memory: 0 },
})

const renderTable = (items: ProcessEntry[]) => {
  const onRequestTerminate = vi.fn()
  render(
    <ProcessTable
      model={createModel(items)}
      onRequestTerminate={onRequestTerminate}
    />
  )
  return { onRequestTerminate }
}

afterEach(() => {
  cleanup()
})

describe("进程表", () => {
  it("超过 100% 的 CPU 数值在 DOM 里是完整文本", () => {
    renderTable([processEntry({ cpu: 148.4 })])

    // CPU 仍按语义作为可排序列头暴露
    expect(screen.getByRole("columnheader", { name: /CPU/ })).toBeTruthy()

    // 截断是视觉问题：完整数值必须原样可取
    expect(screen.getByText("148.4%")).toBeTruthy()
  })

  it("进程行可按语义访问，打开「更多操作」菜单不触发结束进程", async () => {
    const user = userEvent.setup()
    const { onRequestTerminate } = renderTable([processEntry()])

    // 进程名、PID、状态与勾选入口都能按语义取到
    expect(screen.getByText("vite")).toBeTruthy()
    expect(screen.getByText("4821")).toBeTruthy()
    expect(screen.getByText("运行中")).toBeTruthy()
    expect(screen.getByRole("checkbox", { name: "选择 vite" })).toBeTruthy()

    // 危险动作只在菜单里显式点选后才触发；仅仅打开菜单不触发
    await user.click(screen.getByRole("button", { name: "更多操作" }))
    expect(await screen.findByText("结束进程")).toBeTruthy()
    expect(onRequestTerminate).not.toHaveBeenCalled()
  })

  it("没有匹配进程时显示空状态", () => {
    renderTable([])
    expect(screen.getByText("没有匹配的进程")).toBeTruthy()
  })

  it("多端口只显示第一个与 +N，点击后弹出全部端口", async () => {
    const user = userEvent.setup()
    renderTable([processEntry({ ports: [59094, 59095, 59108, 59200] })])

    // 行内只留第一个端口，其余不再平铺
    expect(screen.getByText(":59094")).toBeTruthy()
    expect(screen.queryByText(":59095")).toBeNull()

    const trigger = screen.getByRole("button", { name: "查看全部 4 个端口" })
    expect(trigger.textContent).toBe("+3")

    await user.click(trigger)
    for (const port of [59094, 59095, 59108, 59200]) {
      expect(await screen.findByText(`端口 ${port}`)).toBeTruthy()
    }
  })

  it("只有一个端口时不出现 +N", () => {
    renderTable([processEntry({ ports: [51509] })])

    expect(screen.getByText(":51509")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /查看全部/ })).toBeNull()
    expect(screen.queryByText(/^\+\d+$/)).toBeNull()
  })

  it("没有端口时仍显示占位符", () => {
    renderTable([processEntry({ ports: [] })])

    expect(screen.getByText("—")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /查看全部/ })).toBeNull()
  })
})
