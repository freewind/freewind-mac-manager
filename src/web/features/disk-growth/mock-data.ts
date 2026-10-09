import type { GrowthEntry, ScanSnapshot, ScanStatus } from "@shared/api-contract"

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

const TREE: MockNode = {
  path: "/",
  kind: "dir",
  size: gb(1420.6),
  delta: gb(14.9),
  children: [
    {
      path: "/Users",
      kind: "dir",
      size: gb(1310.4),
      delta: gb(12.6),
      children: [
        {
          path: "/Users/peng.li",
          kind: "dir",
          size: gb(1298.2),
          delta: gb(12.5),
          children: [
            {
              path: "/Users/peng.li/workspace",
              kind: "dir",
              size: gb(190.4),
              delta: gb(8.1),
              children: [
                {
                  path: "/Users/peng.li/workspace/feelime",
                  kind: "dir",
                  size: gb(12.6),
                  delta: gb(3.4),
                  children: [
                    {
                      path: "/Users/peng.li/workspace/feelime/node_modules",
                      kind: "dir",
                      size: gb(9.8),
                      delta: gb(3.2),
                      folded: true,
                    },
                    {
                      path: "/Users/peng.li/workspace/feelime/build",
                      kind: "dir",
                      size: gb(2.1),
                      delta: gb(180),
                    },
                  ],
                },
                {
                  path: "/Users/peng.li/workspace/freewind-llm-providers",
                  kind: "dir",
                  size: gb(2.4),
                  delta: mb(420),
                  children: [
                    {
                      path: "/Users/peng.li/workspace/freewind-llm-providers/.git",
                      kind: "dir",
                      size: gb(1.1),
                      delta: mb(96),
                      folded: true,
                    },
                  ],
                },
                {
                  path: "/Users/peng.li/workspace/freewind-mac-manager",
                  kind: "dir",
                  size: mb(96),
                  delta: mb(96),
                  children: [
                    {
                      path: "/Users/peng.li/workspace/freewind-mac-manager/data/snapshots.sqlite3",
                      kind: "file",
                      size: mb(64),
                      delta: mb(64),
                    },
                    {
                      path: "/Users/peng.li/workspace/freewind-mac-manager/node_modules",
                      kind: "dir",
                      size: mb(28),
                      delta: mb(28),
                      folded: true,
                    },
                  ],
                },
                {
                  path: "/Users/peng.li/workspace/agent-edit-stress-test",
                  kind: "dir",
                  size: gb(34.2),
                  delta: gb(1.8),
                },
              ],
            },
            {
              path: "/Users/peng.li/Library",
              kind: "dir",
              size: gb(68.4),
              delta: gb(2.1),
              children: [
                {
                  path: "/Users/peng.li/Library/Caches",
                  kind: "dir",
                  size: gb(24.6),
                  delta: gb(1.4),
                  children: [
                    {
                      path: "/Users/peng.li/Library/Caches/ms-playwright",
                      kind: "dir",
                      size: gb(6.2),
                      delta: gb(1.1),
                    },
                    {
                      path: "/Users/peng.li/Library/Caches/pnpm",
                      kind: "dir",
                      size: gb(3.8),
                      delta: mb(240),
                    },
                  ],
                },
                {
                  path: "/Users/peng.li/Library/Application Support",
                  kind: "dir",
                  size: gb(18.2),
                  delta: mb(320),
                  children: [
                    {
                      path: "/Users/peng.li/Library/Application Support/Cursor",
                      kind: "dir",
                      size: gb(4.6),
                      delta: mb(210),
                    },
                  ],
                },
                {
                  path: "/Users/peng.li/Library/Containers",
                  kind: "dir",
                  size: gb(12.1),
                  delta: mb(210),
                },
              ],
            },
            {
              path: "/Users/peng.li/Downloads",
              kind: "dir",
              size: gb(42.8),
              delta: gb(1.9),
              children: [
                {
                  path: "/Users/peng.li/Downloads/Xcode_26.1.xip",
                  kind: "file",
                  size: gb(8.2),
                  delta: gb(8.2),
                },
                {
                  path: "/Users/peng.li/Downloads/ubuntu-24.04.iso",
                  kind: "file",
                  size: gb(5.6),
                  delta: 0,
                },
                {
                  path: "/Users/peng.li/Downloads/node-v26.4.0-darwin-x64.tar.gz",
                  kind: "file",
                  size: mb(58),
                  delta: mb(58),
                },
              ],
            },
            {
              path: "/Users/peng.li/Movies",
              kind: "dir",
              size: gb(118.4),
              delta: 0,
            },
            {
              path: "/Users/peng.li/.cache",
              kind: "dir",
              size: gb(6.4),
              delta: mb(240),
              children: [
                {
                  path: "/Users/peng.li/.cache/huggingface",
                  kind: "dir",
                  size: gb(5.1),
                  delta: mb(180),
                },
              ],
            },
            {
              path: "/Users/peng.li/.Trash",
              kind: "dir",
              size: gb(1.2),
              delta: -gb(1.2),
            },
          ],
        },
        {
          path: "/Users/Shared",
          kind: "dir",
          size: mb(420),
          delta: mb(2),
        },
      ],
    },
    {
      path: "/Applications",
      kind: "dir",
      size: gb(52.6),
      delta: gb(1.2),
      children: [
        {
          path: "/Applications/Xcode.app",
          kind: "dir",
          size: gb(18.4),
          delta: 0,
          children: [
            {
              path: "/Applications/Xcode.app/Contents/Developer/Platforms",
              kind: "dir",
              size: gb(12.8),
              delta: gb(1.1),
            },
          ],
        },
        {
          path: "/Applications/Docker.app",
          kind: "dir",
          size: gb(2.4),
          delta: mb(120),
        },
      ],
    },
    {
      path: "/Library",
      kind: "dir",
      size: gb(31.2),
      delta: mb(640),
      children: [
        {
          path: "/Library/Developer",
          kind: "dir",
          size: gb(22.4),
          delta: mb(560),
          children: [
            {
              path: "/Library/Developer/CoreSimulator",
              kind: "dir",
              size: gb(16.8),
              delta: mb(520),
            },
          ],
        },
      ],
    },
    {
      path: "/private",
      kind: "dir",
      size: gb(24.1),
      delta: gb(1.1),
      children: [
        {
          path: "/private/var/folders",
          kind: "dir",
          size: gb(14.2),
          delta: gb(980),
        },
        {
          path: "/private/tmp",
          kind: "dir",
          size: mb(320),
          delta: mb(96),
        },
      ],
    },
  ],
}

const findNode = (target: string, node: MockNode = TREE): MockNode | null => {
  if (node.path === target) return node
  for (const child of node.children ?? []) {
    const found = findNode(target, child)
    if (found) return found
  }
  return null
}

const toEntry = (node: MockNode): GrowthEntry => ({
  path: node.path,
  name: node.path.split("/").filter(Boolean).pop() ?? node.path,
  kind: node.kind,
  size: node.size,
  delta: node.delta,
  folded: node.folded ?? false,
})

export const isMockMode = (): boolean => {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).has("mock")
}

const MOCK_SNAPSHOTS: ScanSnapshot[] = [
  {
    id: 3,
    startedAt: 1791543600,
    finishedAt: 1791543732,
    totalSize: gb(1420.6),
    dirCount: 612455,
    fileCount: 6880312,
    errorCount: 12,
    foldedCount: 2841,
  },
  {
    id: 2,
    startedAt: 1791457200,
    finishedAt: 1791457328,
    totalSize: gb(1405.7),
    dirCount: 611902,
    fileCount: 6871904,
    errorCount: 12,
    foldedCount: 2830,
  },
  {
    id: 1,
    startedAt: 1791370800,
    finishedAt: 1791370921,
    totalSize: gb(1398.2),
    dirCount: 610401,
    fileCount: 6860221,
    errorCount: 11,
    foldedCount: 2802,
  },
]

export const mockSnapshots = (): ScanSnapshot[] => MOCK_SNAPSHOTS

export const mockEntries = (
  path: string
): { current: GrowthEntry | null; entries: GrowthEntry[] } => {
  const node = findNode(path)
  if (!node) return { current: null, entries: [] }
  const current: GrowthEntry = {
    ...toEntry(node),
    name: node.path === "/" ? "根" : toEntry(node).name,
  }
  const entries = (node.children ?? [])
    .map((child) => toEntry(child))
    .sort((left, right) => right.delta - left.delta)
  return { current, entries }
}

export const mockStatus = (): ScanStatus => ({
  running: false,
  phase: "示例数据（未连接后端）",
  startedAt: null,
  finishedAt: null,
  scannedEntries: 0,
  lastError: null,
})
