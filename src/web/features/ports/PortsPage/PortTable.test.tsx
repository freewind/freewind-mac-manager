// @vitest-environment jsdom

import type { PortBinding } from "@shared/api-contract"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { buildPortGroups, type PortGroup } from "@web/features/ports/domain"
import type { usePorts } from "@web/features/ports/usePorts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PortTable } from "./PortTable"

/**
 * 复现线上撑宽数据：端口 443 上 50+ 个监听地址、15 个进程名、19 个 PID。
 * 这些值必须仍然完整可取得，截断只发生在视觉层。
 */
const ADDRESSES = Array.from(
  { length: 52 },
  (_, index) => `10.0.${Math.floor(index / 8)}.${index + 1}`
)
const PROCESS_NAMES = Array.from(
  { length: 15 },
  (_, index) => `worker-${index}`
)
const PIDS = Array.from({ length: 19 }, (_, index) => 40000 + index)
const STARTERS = Array.from({ length: 12 }, (_, index) => `launcher-${index}`)

const toBinding = (address: string, index: number): PortBinding => ({
  key: `tcp4-443-${index}`,
  port: 443,
  protocol: "TCP",
  family: "IPv4",
  address,
  peer: null,
  state: "LISTEN",
  pid: PIDS[index % PIDS.length],
  processName: PROCESS_NAMES[index % PROCESS_NAMES.length],
  user: "freewind",
  startedBy: STARTERS[index % STARTERS.length],
  command: `/Applications/Some/App.app/Contents/MacOS/worker-${index} --serve`,
  cwd: "/Users/freewind/workspace/freewind-mac-manager",
  startedAt: 1_700_000_000,
})

const groups = buildPortGroups(
  ADDRESSES.map((address, index) => toBinding(address, index))
)

/** PortTable 只消费 model 的这几项，其余用空实现补齐类型。 */
const createModel = (items: PortGroup[]): ReturnType<typeof usePorts> => ({
  groups: items,
  totals: {
    listening: items.length,
    connected: 0,
    exposed: 0,
    processCount: new Set(items.flatMap((group) => group.pids)).size,
    bindings: items.reduce((sum, group) => sum + group.bindings.length, 0),
  },
  viewCounts: {
    all: items.length,
    listening: items.length,
    connected: 0,
    exposed: 0,
    dev: 0,
    database: 0,
    proxy: 0,
    system: 0,
    app: 0,
  },
  isLoading: false,
  error: null,
  updatedAt: 1_700_000_000_000,
  view: "all",
  setView: () => undefined,
  search: "",
  setSearch: () => undefined,
  protocol: "all",
  setProtocol: () => undefined,
  scope: "all",
  setScope: () => undefined,
  exposure: "all",
  setExposure: () => undefined,
  isExpanded: () => false,
  toggleExpanded: () => undefined,
  selectedPort: null,
  selectPort: () => undefined,
  autoRefresh: false,
  setAutoRefresh: () => undefined,
  refresh: () => undefined,
  terminate: async () => true,
  killBusy: false,
  // notify 的真实实现返回 sonner 的 toast id（string | number）
  notify: () => "toast-id",
})

const renderTable = (items: PortGroup[] = groups) => {
  const onRequestKill = vi.fn()
  render(
    <PortTable
      model={createModel(items)}
      onCopy={vi.fn()}
      onRequestKill={onRequestKill}
    />
  )
  return { onRequestKill }
}

afterEach(() => {
  cleanup()
})

describe("端口聚合表", () => {
  it("超长地址、进程、PID、启动者在 DOM 里仍是完整值", () => {
    renderTable()

    // 四个易撑宽的列头依然按语义暴露
    for (const header of ["监听地址", "进程", "PID", "启动者"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy()
    }

    // 截断只影响视觉：完整字符串仍能取到，Tooltip 与复制功能依赖它
    expect(screen.getByText(ADDRESSES.join(" · "))).toBeTruthy()
    expect(screen.getByText(PROCESS_NAMES.join(", "))).toBeTruthy()
    expect(screen.getByText(PIDS.join(", "))).toBeTruthy()
    expect(screen.getByText(STARTERS.join(", "))).toBeTruthy()
  })

  it("端口行仍可按语义访问，且渲染时不触发结束进程", () => {
    const { onRequestKill } = renderTable()

    // 展开入口与暴露状态保持可访问
    expect(screen.getByRole("button", { name: "443" })).toBeTruthy()
    expect(screen.getByText("仅本机")).toBeTruthy()

    // 危险动作只在用户显式操作后才可能触发
    expect(onRequestKill).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "操作" })).toBeTruthy()
    expect(onRequestKill).not.toHaveBeenCalled()
  })

  it("没有匹配端口时给出空状态提示", () => {
    renderTable([])
    expect(screen.getByText("没有匹配的端口")).toBeTruthy()
  })

  it("悬停截断的单元格后，浮层里也能取到完整值", async () => {
    const user = userEvent.setup()
    renderTable()
    const full = ADDRESSES.join(" · ")
    expect(screen.getAllByText(full)).toHaveLength(1)

    await user.hover(screen.getAllByText(full)[0])

    await waitFor(() => expect(screen.getAllByText(full)).toHaveLength(2))
  })
})
