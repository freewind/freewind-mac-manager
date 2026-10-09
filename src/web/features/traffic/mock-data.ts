/** 本轮只做界面框架，数据全部来自这里的假数据，尚未接后端。 */

export type TrafficChild = {
  key: string
  label: string
  scriptName: string
  parent: string
  pids: number[]
  /** 该进程当前占用的本地端口，无则为空 */
  ports: number[]
  running: boolean
  bytesIn: number
  bytesOut: number
  command: string
}

export type TrafficGroup = {
  name: string
  bytesIn: number
  bytesOut: number
  children: TrafficChild[]
}

export type TrafficStatus = {
  downloadRate: number
  uploadRate: number
  sampledAt: number
  intervalSeconds: number
}

const kb = (value: number) => Math.round(value * 1000)
const mb = (value: number) => Math.round(value * 1000 ** 2)
const gb = (value: number) => Math.round(value * 1000 ** 3)

const child = (
  label: string,
  scriptName: string,
  parent: string,
  pids: number[],
  bytesIn: number,
  bytesOut: number,
  command: string,
  running = true,
  ports: number[] = []
): TrafficChild => ({
  key: `${label}@${parent}`,
  label,
  scriptName,
  parent,
  pids,
  ports,
  running,
  bytesIn,
  bytesOut,
  command,
})

const group = (name: string, children: TrafficChild[]): TrafficGroup => ({
  name,
  bytesIn: children.reduce((sum, item) => sum + item.bytesIn, 0),
  bytesOut: children.reduce((sum, item) => sum + item.bytesOut, 0),
  children,
})

export const mockGroups: TrafficGroup[] = [
  group("node", [
    child(
      "node · next-server",
      "next-server",
      "node",
      [41230, 41231],
      mb(720),
      gb(1.48),
      "node /Users/peng.li/workspace/shadcn-ui/node_modules/.bin/next dev --turbopack",
      true,
      [3000]
    ),
    child(
      "node · vite.js",
      "vite.js",
      "npm",
      [39021],
      mb(120),
      mb(410),
      "node /Users/peng.li/workspace/freewind-mac-manager/node_modules/.bin/vite --host",
      true,
      [5173]
    ),
    child(
      "node · tsserver.js",
      "tsserver.js",
      "zed",
      [756, 757],
      mb(60),
      mb(220),
      "node --max-old-space-size=8092 /Users/peng.li/Library/Application Support/Zed/languages/vtsls/node_modules/typescript/lib/tsserver.js --serverMode partialSemantic",
      true,
      []
    ),
    child(
      "node · storybook",
      "storybook",
      "npm",
      [28110],
      mb(18),
      mb(96),
      "node /usr/local/bin/storybook dev -p 6006",
      false,
      [6006]
    ),
  ]),
  group("Google Chrome H", [
    child(
      "Google Chrome H",
      "Google Chrome H",
      "Google Chrome",
      [18322],
      gb(3.11),
      mb(124),
      "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper --type=renderer",
      true,
      [52341]
    ),
  ]),
  group("mDNSResponder", [
    child(
      "mDNSResponder",
      "mDNSResponder",
      "launchd",
      [225],
      gb(2.55),
      mb(233),
      "/usr/sbin/mDNSResponder",
      true,
      [5353]
    ),
  ]),
  group("LANDrop", [
    child(
      "LANDrop",
      "LANDrop",
      "launchd",
      [11742],
      mb(491),
      mb(480),
      "/Applications/LANDrop.app/Contents/MacOS/LANDrop",
      true,
      [8699]
    ),
  ]),
  group("verge-mihomo", [
    child(
      "verge-mihomo",
      "verge-mihomo",
      "clash-verge-service",
      [22505],
      gb(31.9),
      gb(129.0),
      "/Library/Application Support/clash-verge-service/cores/verge-mihomo -d /Users/peng.li/.config/clash-verge",
      true,
      [7897, 9097]
    ),
  ]),
  group("curl", [
    child(
      "curl",
      "curl",
      "bash",
      [47373],
      mb(18.0),
      kb(705),
      "curl -r 0-17999999 --limit-rate 200k https://mirrors.aliyun.com/ubuntu/ls-lR.gz",
      false,
      []
    ),
  ]),
]

export const mockStatus: TrafficStatus = {
  downloadRate: kb(262),
  uploadRate: kb(322),
  sampledAt: Date.now(),
  intervalSeconds: 5,
}

export type TrafficSnapshot = {
  id: string
  /** 保存时间的时间戳 */
  savedAt: number
  /** 本快照区间的起点（即上一份快照保存的时间） */
  fromAt: number
  /** 本快照区间的终点 */
  toAt: number
  /** 本次快照覆盖的区间，形如 `10-08 23:55 ~ 10-09 23:55` */
  rangeText: string
  savedBy: "scheduled" | "manual"
  bytesIn: number
  bytesOut: number
  /** 本区间内各进程新增的流量 */
  groups: TrafficGroup[]
}

const pad = (value: number) => String(value).padStart(2, "0")

const shortStamp = (time: number): string => {
  const date = new Date(time)
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 按系数缩放一份基础数据，用来造出多天不同的快照内容。 */
const scaleGroups = (groups: TrafficGroup[], factor: number): TrafficGroup[] =>
  groups.map((item) =>
    group(
      item.name,
      item.children.map((childItem) => ({
        ...childItem,
        bytesIn: Math.round(childItem.bytesIn * factor),
        bytesOut: Math.round(childItem.bytesOut * factor),
      }))
    )
  )

/** 最近 7 天，每天一份增量快照（最上面一份是今天手动存的）。 */
const SNAPSHOT_FACTORS = [0.62, 1.05, 0.48, 1.32, 0.75, 0.95, 1.18]

const DAY_MS = 24 * 60 * 60 * 1000

export const mockSnapshots: TrafficSnapshot[] = SNAPSHOT_FACTORS.map(
  (factor, index) => {
    const savedAt = Date.now() - index * DAY_MS
    const previousAt = savedAt - DAY_MS
    const groups = scaleGroups(mockGroups, factor)

    return {
      id: `snapshot-${index}`,
      savedAt,
      fromAt: previousAt,
      toAt: savedAt,
      rangeText: `${shortStamp(previousAt)} ~ ${shortStamp(savedAt)}`,
      savedBy: index === 0 ? "manual" : "scheduled",
      bytesIn: groups.reduce((sum, item) => sum + item.bytesIn, 0),
      bytesOut: groups.reduce((sum, item) => sum + item.bytesOut, 0),
      groups,
    }
  }
)

/** 手动保存快照时用的内容：以基础数据按小系数放大，模拟「刚发生的一小段新增流量」。 */
export const scaleGroupsForManualSnapshot = (
  index: number
): TrafficSnapshot => {
  const savedAt = Date.now()
  const factor = 0.12 + (index % 5) * 0.03
  const groups = scaleGroups(mockGroups, factor)
  const previousAt = mockSnapshots[0]?.savedAt ?? savedAt - DAY_MS

  return {
    id: `snapshot-manual-${index}-${savedAt}`,
    savedAt,
    fromAt: previousAt,
    toAt: savedAt,
    rangeText: `${shortStamp(previousAt)} ~ ${shortStamp(savedAt)}`,
    savedBy: "manual",
    bytesIn: groups.reduce((sum, item) => sum + item.bytesIn, 0),
    bytesOut: groups.reduce((sum, item) => sum + item.bytesOut, 0),
    groups,
  }
}

/** 把两份进程数据相加（同进程、同脚本、同启动者的条目合并）。 */
export const mergeGroups = (
  base: TrafficGroup[],
  extra: TrafficGroup[]
): TrafficGroup[] => {
  const result = base.map((item) => ({ ...item, children: [...item.children] }))

  for (const incoming of extra) {
    const existing = result.find((item) => item.name === incoming.name)
    if (!existing) {
      result.push({ ...incoming, children: [...incoming.children] })
      continue
    }
    existing.bytesIn += incoming.bytesIn
    existing.bytesOut += incoming.bytesOut
    existing.children = mergeChildren(existing.children, incoming.children)
  }

  return result
}

const mergeChildren = (
  base: TrafficChild[],
  extra: TrafficChild[]
): TrafficChild[] => {
  const result = base.map((item) => ({ ...item }))

  for (const incoming of extra) {
    const existing = result.find((item) => item.key === incoming.key)
    if (!existing) {
      result.push({ ...incoming })
      continue
    }
    existing.bytesIn += incoming.bytesIn
    existing.bytesOut += incoming.bytesOut
    existing.pids = [...new Set([...existing.pids, ...incoming.pids])]
    existing.ports = [...new Set([...existing.ports, ...incoming.ports])]
    existing.running = existing.running || incoming.running
  }

  return result
}

/** 把多份快照的进程数据合并成一份总和。 */
export const mergeSnapshotGroups = (
  snapshots: TrafficSnapshot[]
): TrafficGroup[] =>
  snapshots.reduce<TrafficGroup[]>(
    (accumulator, item) =>
      accumulator.length === 0
        ? item.groups
        : mergeGroups(accumulator, item.groups),
    []
  )

/**
 * 删除一份快照后重算。
 *
 * 快照是「相对上一份的增量」，所以删掉中间一份后，它的流量应并入其后一份，
 * 后一份的区间起点改为被删快照的起点。
 */
export const removeSnapshotAndRecompute = (
  snapshots: TrafficSnapshot[],
  id: string
): TrafficSnapshot[] => {
  const index = snapshots.findIndex((item) => item.id === id)
  if (index < 0) {
    return snapshots
  }

  const removed = snapshots[index]
  const following = snapshots[index + 1]
  const remaining = snapshots.filter((item) => item.id !== id)

  if (!following) {
    return remaining
  }

  return remaining.map((item) =>
    item.id === following.id
      ? {
          ...item,
          fromAt: removed.fromAt,
          rangeText: `${shortStamp(removed.fromAt)} ~ ${shortStamp(item.toAt)}`,
          bytesIn: item.bytesIn + removed.bytesIn,
          bytesOut: item.bytesOut + removed.bytesOut,
          groups: mergeGroups(item.groups, removed.groups),
        }
      : item
  )
}

/** 把多份连续快照合并成一份，区间取它们的并集。 */
export const mergeSnapshotsIntoOne = (
  snapshots: TrafficSnapshot[],
  ids: string[]
): TrafficSnapshot[] => {
  const chosen = snapshots.filter((item) => ids.includes(item.id))
  if (chosen.length < 2) {
    return snapshots
  }

  const newest = chosen[0]
  const oldest = chosen[chosen.length - 1]
  const merged: TrafficSnapshot = {
    ...newest,
    fromAt: oldest.fromAt,
    rangeText: `${shortStamp(oldest.fromAt)} ~ ${shortStamp(newest.toAt)}`,
    bytesIn: chosen.reduce((sum, item) => sum + item.bytesIn, 0),
    bytesOut: chosen.reduce((sum, item) => sum + item.bytesOut, 0),
    groups: mergeSnapshotGroups(chosen),
  }

  let inserted = false
  return snapshots.flatMap((item) => {
    if (!ids.includes(item.id)) {
      return [item]
    }
    if (inserted) {
      return []
    }
    inserted = true
    return [merged]
  })
}

/** 默认忽略的代理进程：经代理的流量会同时记在它们的名下。 */
export const ignoredNames = ["verge-mihomo", "clash-verge", "clash", "mihomo"]
