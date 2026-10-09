import type {
  GrowthEntry,
  ScanSnapshot,
  ScanStatus,
  TreeNode,
} from "@shared/api-contract"

type MockNode = {
  path: string
  kind: "dir" | "file"
  size: number
  delta: number
  folded?: boolean
  children?: MockNode[]
}

const gb = (value: number): number => Math.round(value * 1024 ** 3)
const mb = (value: number): number => Math.round(value * 1024 ** 2)

const dir = (
  path: string,
  size: number,
  delta: number,
  children: MockNode[] = []
): MockNode => ({ path, kind: "dir", size, delta, children })

const file = (path: string, size: number, delta: number): MockNode => ({
  path,
  kind: "file",
  size,
  delta,
})

const folded = (path: string, size: number, delta: number): MockNode => ({
  path,
  kind: "dir",
  size,
  delta,
  folded: true,
})

const HOME = "/Users/peng.li"
const WORKSPACE = `${HOME}/workspace`

/** 一个前端项目：node_modules 与 .git 折叠，dist 与锁文件留明细。 */
const project = (
  name: string,
  sizeMb: number,
  deltaMb: number,
  extra: MockNode[] = []
): MockNode =>
  dir(`${WORKSPACE}/${name}`, mb(sizeMb), mb(deltaMb), [
    folded(`${WORKSPACE}/${name}/node_modules`, mb(sizeMb * 0.45), mb(deltaMb * 0.55)),
    folded(`${WORKSPACE}/${name}/.git`, mb(sizeMb * 0.18), mb(deltaMb * 0.1)),
    dir(`${WORKSPACE}/${name}/dist`, mb(sizeMb * 0.12), mb(deltaMb * 0.2), [
      file(`${WORKSPACE}/${name}/dist/index.js`, mb(sizeMb * 0.06), mb(deltaMb * 0.15)),
    ]),
    file(`${WORKSPACE}/${name}/pnpm-lock.yaml`, mb(1.4), mb(0.2)),
    ...extra,
  ])

const cache = (name: string, sizeMb: number, deltaMb: number): MockNode =>
  dir(`${HOME}/Library/Caches/${name}`, mb(sizeMb), mb(deltaMb))

const download = (name: string, sizeMb: number, deltaMb: number): MockNode =>
  file(`${HOME}/Downloads/${name}`, mb(sizeMb), mb(deltaMb))

const TREE: MockNode = dir("/", gb(1420.6), gb(14.9), [
  dir("/Users", gb(1310.4), gb(12.6), [
    dir(HOME, gb(1298.2), gb(12.5), [
      dir(WORKSPACE, gb(190.4), gb(8.1), [
        project("feelime", 12900, 3400),
        project("freewind-agent-hub", 8600, 1200),
        project("freewind-llm-providers", 2400, 420),
        project("freewind-paseo", 6800, 2400),
        project("freewind-mac-manager", 96, 96),
        project("freewind-remote-shell", 1800, 60),
        project("freewind-music-player", 3200, 180),
        project("freewind-git-diff", 1500, 40),
        project("agent-edit-stress-test", 34200, 1800),
        project("paseo-legacy", 12400, -2200),
      ]),
      dir(`${HOME}/Library`, gb(68.4), gb(2.1), [
        dir(`${HOME}/Library/Caches`, gb(24.6), gb(1.4), [
          cache("ms-playwright", 6200, 1100),
          cache("pnpm", 3800, 240),
          cache("Homebrew", 2400, 60),
          cache("Cypress", 1900, 0),
          cache("puppeteer", 1600, -320),
        ]),
        dir(`${HOME}/Library/Application Support`, gb(18.2), mb(320), [
          dir(`${HOME}/Library/Application Support/Cursor`, gb(4.6), mb(210)),
          dir(`${HOME}/Library/Application Support/Code`, gb(3.2), mb(48)),
          dir(`${HOME}/Library/Application Support/Claude`, gb(2.1), mb(36)),
        ]),
        dir(`${HOME}/Library/Containers`, gb(12.1), mb(210)),
        dir(`${HOME}/Library/Developer`, gb(9.4), mb(480), [
          dir(`${HOME}/Library/Developer/Xcode/DerivedData`, gb(6.8), mb(430)),
          dir(`${HOME}/Library/Developer/Xcode/iOS DeviceSupport`, gb(2.1), 0),
        ]),
        dir(`${HOME}/Library/Mobile Documents`, gb(3.6), mb(12)),
      ]),
      dir(`${HOME}/Downloads`, gb(42.8), gb(1.9), [
        download("Xcode_26.1.xip", 8400, 8400),
        download("ubuntu-24.04.2-desktop-amd64.iso", 5700, 0),
        download("node-v26.4.0-darwin-x64.tar.gz", 58, 58),
        download("ScreenRecording_10-08.mov", 3200, 3200),
        download("swift-6.0.3-RELEASE-ubuntu24.04.tar.gz", 820, 0),
        download("archive-old-projects.zip", 4200, -4200),
      ]),
      dir(`${HOME}/Movies`, gb(118.4), 0),
      dir(`${HOME}/Pictures`, gb(64.2), mb(24)),
      dir(`${HOME}/Music`, gb(22.6), 0),
      dir(`${HOME}/Documents`, gb(9.8), mb(160), [
        dir(`${HOME}/Documents/会议记录`, mb(420), mb(18)),
        file(`${HOME}/Documents/备份-2025-09.zip`, gb(4.2), 0),
      ]),
      dir(`${HOME}/.cache`, gb(6.4), mb(240), [
        dir(`${HOME}/.cache/huggingface`, gb(5.1), mb(180)),
        dir(`${HOME}/.cache/uv`, gb(1.1), mb(60)),
      ]),
      dir(`${HOME}/.npm`, gb(4.8), mb(320)),
      dir(`${HOME}/.cargo`, gb(3.2), mb(90)),
      dir(`${HOME}/.Trash`, gb(1.2), -gb(1.2)),
    ]),
    dir("/Users/Shared", mb(420), mb(2)),
    dir("/Users/Guest", mb(12), 0),
  ]),
  dir("/Applications", gb(52.6), gb(1.2), [
    dir("/Applications/Xcode.app", gb(18.4), 0, [
      dir("/Applications/Xcode.app/Contents/Developer/Platforms", gb(12.8), gb(1.1)),
    ]),
    dir("/Applications/Docker.app", gb(2.4), mb(120)),
    dir("/Applications/Cursor.app", gb(1.2), mb(64)),
    file("/Applications/Paseo.app.dmg", mb(680), mb(680)),
  ]),
  dir("/Library", gb(31.2), mb(640), [
    dir("/Library/Developer", gb(22.4), mb(560), [
      dir("/Library/Developer/CoreSimulator", gb(16.8), mb(520)),
      dir("/Library/Developer/CommandLineTools", gb(4.1), 0),
    ]),
    dir("/Library/Caches", gb(4.2), mb(60)),
    dir("/Library/Logs", mb(880), mb(120)),
  ]),
  dir("/private", gb(24.1), gb(1.1), [
    dir("/private/var/folders", gb(14.2), gb(0.98)),
    dir("/private/var/log", mb(640), mb(80)),
    dir("/private/tmp", mb(320), mb(96)),
  ]),
  dir("/opt", gb(6.2), mb(140), [
    dir("/opt/homebrew", gb(6.1), mb(140)),
  ]),
  dir("/usr/local", gb(14.8), mb(220), [
    dir("/usr/local/Cellar", gb(9.4), mb(160)),
    dir("/usr/local/var", gb(4.2), mb(50)),
  ]),
])

const findNode = (target: string, node: MockNode = TREE): MockNode | null => {
  if (node.path === target) return node
  for (const child of node.children ?? []) {
    const found = findNode(target, child)
    if (found) return found
  }
  return null
}

const toEntry = (node: MockNode, spanDays = 1): GrowthEntry => ({
  path: node.path,
  name: node.path.split("/").filter(Boolean).pop() ?? node.path,
  kind: node.kind,
  size: node.size,
  delta: node.delta * spanDays,
  folded: node.folded ?? false,
})

/**
 * 当前阶段界面一律用示例数据填充，方便先看交互。
 * 接真实快照时改写此函数（例如改为探测后端是否已有快照）。
 */
const DAY = 86_400
const LAST_SCAN = 1_791_543_600

const TOTALS_GB = [1420.6, 1405.7, 1398.2, 1412.9, 1401.4, 1388.6, 1376.1]

const MOCK_SNAPSHOTS: ScanSnapshot[] = TOTALS_GB.map((total, index) => ({
  id: TOTALS_GB.length - index,
  startedAt: LAST_SCAN - index * DAY,
  finishedAt: LAST_SCAN - index * DAY + 132,
  totalSize: gb(total),
  dirCount: 612_455 - index * 410,
  fileCount: 6_880_312 - index * 8_120,
  errorCount: 12,
  foldedCount: 2_841 - index * 7,
}))

/** Mock 期间保留一份可变快照列表，删除/合并后界面才会跟着变。 */
let mockSnapshotState: ScanSnapshot[] = [...MOCK_SNAPSHOTS]

export const mockSnapshots = (): ScanSnapshot[] => mockSnapshotState

export const deleteMockSnapshots = (ids: number[]): void => {
  mockSnapshotState = mockSnapshotState.filter(
    (snapshot) => !ids.includes(snapshot.id)
  )
}

export const appendMockSnapshot = (): ScanSnapshot => {
  const next = mockNextSnapshot(mockSnapshotState[0])
  mockSnapshotState = [next, ...mockSnapshotState]
  return next
}

export const mockEntries = (
  path: string,
  spanDays = 1
): { current: GrowthEntry | null; entries: GrowthEntry[] } => {
  // 界面上「根」用空字符串表示，示例树的根是 "/"。
  const node = findNode(path === "" ? "/" : path)
  if (!node) return { current: null, entries: [] }
  const entry = toEntry(node, spanDays)
  const current: GrowthEntry = node.path === "/" ? { ...entry, name: "根" } : entry
  const entries = (node.children ?? [])
    .map((child) => toEntry(child, spanDays))
    .sort((left, right) => right.delta - left.delta)
  return { current, entries }
}

export type MockSubtree = TreeNode

/** 取某个节点的完整子树，供分布图逐层铺开。 */
export const mockTree = (path: string): TreeNode | null => {
  const node = findNode(path === "" ? "/" : path)
  if (!node) return null
  const build = (current: MockNode): TreeNode => ({
    path: current.path,
    name:
      current.path === "/"
        ? "根"
        : (current.path.split("/").filter(Boolean).pop() ?? current.path),
    kind: current.kind,
    size: current.size,
    delta: current.delta,
    folded: current.folded ?? false,
    children: (current.children ?? [])
      .slice()
      .sort((left, right) => right.size - left.size)
      .map(build),
  })
  return build(node)
}

/** 按层截断到指定深度，和真实后端的 subtree 行为保持一致。 */
export const truncateTree = (node: TreeNode, depth: number): TreeNode => ({
  ...node,
  children:
    depth <= 1 ? [] : node.children.map((child) => truncateTree(child, depth - 1)),
})

/** Mock 模式是否启用，由数据源决定。 */
export const shouldUseMockData = (dataSource: "server" | "demo"): boolean =>
  dataSource === "demo"

export const mockSearch = (keyword: string, spanDays = 1): GrowthEntry[] => {
  const needle = keyword.toLowerCase()
  const found: GrowthEntry[] = []
  const walk = (node: MockNode): void => {
    for (const child of node.children ?? []) {
      if (child.path.toLowerCase().includes(needle)) {
        found.push(toEntry(child, spanDays))
      }
      walk(child)
    }
  }
  walk(TREE)
  return found.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
}

export const mockStatus = (latest: ScanSnapshot | undefined): ScanStatus => ({
  running: false,
  phase: latest ? `扇描完成，快照 #${latest.id}` : "尚未扇描",
  startedAt: latest?.startedAt ?? null,
  finishedAt: latest?.finishedAt ?? null,
  scannedEntries: latest?.fileCount ?? 0,
  lastError: null,
})

/** 模拟一次扇描的过程文案，供界面展示进度。 */
export const mockScanPhases = (): string[] => [
  "开始扇描 6 个目标目录",
  "已统计 200000 个文件",
  "已统计 1400000 个文件",
  "已统计 3200000 个文件",
  "已统计 5200000 个文件",
  "已统计 6880312 个文件",
  "扇描完成：612871 个目录、6880312 个文件",
  "写入快照",
]

/** 基于上一份快照造一份新的。 */
export const mockNextSnapshot = (
  latest: ScanSnapshot | undefined
): ScanSnapshot => {
  const id = (latest?.id ?? 0) + 1
  const startedAt = Math.round(Date.now() / 1000)
  const grownBytes = gb(3.4)
  return {
    id,
    startedAt,
    finishedAt: startedAt + 128,
    totalSize: (latest?.totalSize ?? gb(1420.6)) + grownBytes,
    dirCount: 613_112,
    fileCount: 6_883_204,
    errorCount: 12,
    foldedCount: 2_848,
  }
}
