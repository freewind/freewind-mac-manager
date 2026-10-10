import path from "node:path"
import { DATA_DIR, DATABASE_FILE } from "@server/env"
import type {
  TaskProgress,
  TrafficChild,
  TrafficGroup,
  TrafficSnapshot,
  TrafficStatus,
} from "@shared/api-contract"
import { describeError } from "@shared/format"
import { processLabel, scriptName } from "./identity"
import { type ProcessDetails, snapshotProcesses } from "./inspector"
import { migrateTrafficDatabase } from "./migrate"
import { snapshotTraffic } from "./nettop"
import { snapshotPorts } from "./ports"
import {
  type SampleRow,
  type SnapshotEntryRow,
  type SnapshotRow,
  TrafficStore,
} from "./store"

export const SAMPLE_INTERVAL_SECONDS = 5

const LEGACY_DATABASE_FILE = path.join(DATA_DIR, "traffic.sqlite3")

let store: TrafficStore | null = null

const trafficStore = (): TrafficStore => {
  store ??= new TrafficStore(DATABASE_FILE)
  return store
}

let initialized = false

/**
 * 迁库只在应用启动时执行一次。
 * 后台执行器 import 本模块不会触发它，因此不会出现「执行器一启动就改库」。
 */
export const initializeTraffic = (): void => {
  if (initialized) return
  trafficStore()
  migrateTrafficDatabase(DATABASE_FILE, LEGACY_DATABASE_FILE)
  initialized = true
}

/** 写操作的完成结果：只带定位与说明所需的最小信息。 */
export type SnapshotSaveOutcome = {
  snapshotId: string
  rangeText: string
}

export type TrafficReport = (progress: TaskProgress) => void

/** 上一轮各 pid 的累计值，用来算增量。 */
let lastTotals = new Map<number, { bytesIn: number; bytesOut: number }>()
let lastError: string | null = null
let timer: NodeJS.Timeout | null = null
let sampling = false

const pad = (value: number): string => String(value).padStart(2, "0")

const shortStamp = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const seconds = (timestamp: number): number => Math.floor(timestamp / 1000)

/**
 * 当前存活进程的 pid 集合。
 *
 * 采集失败时返回 null，调用方据此显示「状态未知」；若返回空集合，
 * 会把还在运行的进程误报成「已退出」。
 */
const runningPids = async (): Promise<Set<number> | null> => {
  try {
    return new Set((await snapshotProcesses()).keys())
  } catch {
    return null
  }
}

type AggregateInput = {
  name: string
  label: string
  parent: string
  command: string
  pid: number
  bytesIn: number
  bytesOut: number
}

/** 按「进程名 + 细分标识 + 启动者」聚合出两级结构。activePids 为 null 表示存活状态未知。 */
const aggregate = (
  rows: AggregateInput[],
  activePids: Set<number> | null,
  ports: Map<number, number[]>
): TrafficGroup[] => {
  const groupOrder: string[] = []
  const groups = new Map<
    string,
    {
      bytesIn: number
      bytesOut: number
      children: Map<string, TrafficChild & { pids: number[] }>
    }
  >()

  for (const row of rows) {
    let group = groups.get(row.name)
    if (!group) {
      group = { bytesIn: 0, bytesOut: 0, children: new Map() }
      groups.set(row.name, group)
      groupOrder.push(row.name)
    }

    group.bytesIn += row.bytesIn
    group.bytesOut += row.bytesOut

    const childKey = `${row.label}\u{1}${row.parent}\u{1}${row.command}`
    let child = group.children.get(childKey)
    if (!child) {
      child = {
        label: row.label,
        scriptName: scriptName(row.label, row.name),
        parent: row.parent,
        pids: [],
        ports: [],
        running: null,
        bytesIn: 0,
        bytesOut: 0,
        command: row.command,
      }
      group.children.set(childKey, child)
    }

    child.bytesIn += row.bytesIn
    child.bytesOut += row.bytesOut
    if (!child.pids.includes(row.pid)) {
      child.pids.push(row.pid)
    }
  }

  return groupOrder.flatMap((name) => {
    const group = groups.get(name)
    if (!group) return []
    const children = [...group.children.values()].map((child) => {
      const childPorts = [
        ...new Set(child.pids.flatMap((pid) => ports.get(pid) ?? [])),
      ]
      return {
        label: child.label,
        scriptName: child.scriptName,
        parent: child.parent,
        pids: [...child.pids].sort((a, b) => a - b),
        ports: childPorts.sort((a, b) => a - b),
        running:
          activePids === null
            ? null
            : child.pids.some((pid) => activePids.has(pid)),
        bytesIn: child.bytesIn,
        bytesOut: child.bytesOut,
        command: child.command,
      }
    })

    return {
      name,
      bytesIn: group.bytesIn,
      bytesOut: group.bytesOut,
      children: children.sort(
        (a, b) => b.bytesIn + b.bytesOut - (a.bytesIn + a.bytesOut)
      ),
    }
  })
}

/** 取一次采样：nettop 的累计值 + ps 的命令行，换算成增量后落库。 */
export const sampleOnce = async (): Promise<void> => {
  if (sampling) {
    return
  }
  sampling = true

  try {
    const [traffic, processes] = await Promise.all([
      snapshotTraffic(),
      snapshotProcesses().catch(() => new Map<number, ProcessDetails>()),
    ])

    const ts = seconds(Date.now())
    const rows: SampleRow[] = []
    const nextTotals = new Map<number, { bytesIn: number; bytesOut: number }>()

    for (const item of traffic) {
      nextTotals.set(item.pid, {
        bytesIn: item.bytesIn,
        bytesOut: item.bytesOut,
      })

      const previous = lastTotals.get(item.pid)
      const deltaIn = previous
        ? Math.max(item.bytesIn - previous.bytesIn, 0)
        : item.bytesIn
      const deltaOut = previous
        ? Math.max(item.bytesOut - previous.bytesOut, 0)
        : item.bytesOut

      if (deltaIn === 0 && deltaOut === 0) {
        continue
      }

      const details = processes.get(item.pid)
      const command = details?.command ?? ""
      rows.push({
        ts,
        name: item.name,
        label: processLabel(item.name, command),
        parent: details?.parentName ?? "",
        command,
        pid: item.pid,
        bytesIn: deltaIn,
        bytesOut: deltaOut,
      })
    }

    lastTotals = nextTotals
    trafficStore().insertSamples(rows)
    lastError = null
  } catch (error) {
    lastError = describeError(error)
  } finally {
    sampling = false
  }
}

export const startTrafficSampler = (): void => {
  if (timer) {
    return
  }
  void sampleOnce()
  timer = setInterval(() => {
    void sampleOnce()
  }, SAMPLE_INTERVAL_SECONDS * 1000)
}

export const stopTrafficSampler = (): void => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export const getTrafficStatus = (): TrafficStatus => {
  const db = trafficStore()
  const { bytesIn, bytesOut } = db.latestSampleDelta()
  return {
    running: timer !== null,
    intervalSeconds: SAMPLE_INTERVAL_SECONDS,
    sampledAt: db.latestSampleTimestamp(),
    downloadRate: bytesOut / SAMPLE_INTERVAL_SECONDS,
    uploadRate: bytesIn / SAMPLE_INTERVAL_SECONDS,
  }
}

/** 上次快照的结束时间，决定新快照的起点。 */
const snapshotStartTime = (db: TrafficStore): number => {
  const [latest] = db.listSnapshotRows()
  if (latest) {
    return latest.toAt
  }
  return db.latestSampleTimestamp() ?? seconds(Date.now())
}

const entryFromSamples = (
  samples: SampleRow[],
  portMap: Map<number, number[]>
): Omit<SnapshotEntryRow, "snapshotId">[] => {
  const aggregated = aggregate(
    samples.map((row) => ({
      name: row.name,
      label: row.label,
      parent: row.parent,
      command: row.command,
      pid: row.pid,
      bytesIn: row.bytesIn,
      bytesOut: row.bytesOut,
    })),
    null,
    portMap
  )

  return aggregated.flatMap((group) =>
    group.children.map((child) => ({
      name: group.name,
      label: child.label,
      parent: child.parent,
      command: child.command,
      ports: child.ports,
      pids: child.pids,
      bytesIn: child.bytesIn,
      bytesOut: child.bytesOut,
    }))
  )
}

const mergeEntries = (
  base: Omit<SnapshotEntryRow, "snapshotId">[],
  extra: Omit<SnapshotEntryRow, "snapshotId">[]
): Omit<SnapshotEntryRow, "snapshotId">[] => {
  const result = new Map<string, Omit<SnapshotEntryRow, "snapshotId">>()

  for (const entry of [...base, ...extra]) {
    const key = `${entry.name}\u{1}${entry.label}\u{1}${entry.parent}\u{1}${entry.command}`
    const existing = result.get(key)
    if (!existing) {
      result.set(key, {
        ...entry,
        ports: [...entry.ports],
        pids: [...entry.pids],
      })
      continue
    }
    existing.bytesIn += entry.bytesIn
    existing.bytesOut += entry.bytesOut
    existing.ports = [...new Set([...existing.ports, ...entry.ports])]
    existing.pids = [...new Set([...existing.pids, ...entry.pids])]
  }

  return [...result.values()]
}

const toSnapshot = (
  row: SnapshotRow,
  entries: Omit<SnapshotEntryRow, "snapshotId">[],
  activePids: Set<number> | null,
  ports: Map<number, number[]>
): TrafficSnapshot => {
  const groups = aggregate(
    entries.map((entry) => ({
      name: entry.name,
      label: entry.label,
      parent: entry.parent,
      command: entry.command,
      pid: entry.pids[0] ?? 0,
      bytesIn: entry.bytesIn,
      bytesOut: entry.bytesOut,
    })),
    activePids,
    ports
  )

  return {
    id: row.id,
    savedAt: row.savedAt,
    fromAt: row.fromAt,
    toAt: row.toAt,
    rangeText: `${shortStamp(row.fromAt * 1000)} ~ ${shortStamp(row.toAt * 1000)}`,
    savedBy: row.savedBy,
    bytesIn: row.bytesIn,
    bytesOut: row.bytesOut,
    groups,
  }
}

export const listSnapshots = async (): Promise<TrafficSnapshot[]> => {
  const db = trafficStore()
  const rows = db.listSnapshotRows()
  if (rows.length === 0) {
    return []
  }

  const entries = db.listEntries(rows.map((row) => row.id))
  const bySnapshot = new Map<string, Omit<SnapshotEntryRow, "snapshotId">[]>()
  for (const entry of entries) {
    const list = bySnapshot.get(entry.snapshotId) ?? []
    list.push(entry)
    bySnapshot.set(entry.snapshotId, list)
  }

  const pids = [...new Set(entries.flatMap((entry) => entry.pids))]
  const [active, ports] = await Promise.all([
    runningPids(),
    snapshotPorts(pids),
  ])

  return rows.map((row) =>
    toSnapshot(row, bySnapshot.get(row.id) ?? [], active, ports)
  )
}

/** 手动或定时保存一份快照：把上次快照之后的采样聚合成一份增量。 */
export const captureSnapshot = async (
  savedBy: "scheduled" | "manual",
  options?: { report?: TrafficReport; store?: TrafficStore }
): Promise<SnapshotSaveOutcome> => {
  const db = options?.store ?? trafficStore()
  const report = options?.report
  const now = seconds(Date.now())
  const fromAt = snapshotStartTime(db)
  report?.({
    done: 0,
    total: null,
    bytesDone: null,
    bytesTotal: null,
    stage: "读取采样",
    currentTarget: null,
  })
  const samples = db.listSamples(fromAt, now + 1)
  const pids = [...new Set(samples.map((row) => row.pid))]
  report?.({
    done: 0,
    total: pids.length,
    bytesDone: null,
    bytesTotal: null,
    stage: `查询 ${pids.length} 个进程的端口`,
    currentTarget: null,
  })
  const ports = await snapshotPorts(pids, {
    onProgress: (done, total) =>
      report?.({
        done,
        total,
        bytesDone: null,
        bytesTotal: null,
        stage: "查询进程端口",
        currentTarget: null,
      }),
  })
  const entries = entryFromSamples(samples, ports)

  const row: SnapshotRow = {
    id: `snapshot-${now}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: now,
    fromAt,
    toAt: now,
    savedBy,
    bytesIn: entries.reduce((sum, entry) => sum + entry.bytesIn, 0),
    bytesOut: entries.reduce((sum, entry) => sum + entry.bytesOut, 0),
  }

  report?.({
    done: 0,
    total: entries.length,
    bytesDone: null,
    bytesTotal: null,
    stage: `写入 ${entries.length} 条明细`,
    currentTarget: null,
  })
  db.insertSnapshot(row, entries)
  report?.({
    done: entries.length,
    total: entries.length,
    bytesDone: null,
    bytesTotal: null,
    stage: "写入完成",
    currentTarget: null,
  })

  return {
    snapshotId: row.id,
    rangeText: `${shortStamp(row.fromAt * 1000)} ~ ${shortStamp(row.toAt * 1000)}`,
  }
}

/** 实时视图：最近一次采样的进程明细。 */
export const realtimeGroups = async (): Promise<{
  scope: string
  groups: TrafficGroup[]
}> => {
  const db = trafficStore()
  const ts = db.latestSampleTimestamp()
  if (ts === null) {
    return { scope: "实时（还没有采样）", groups: [] }
  }

  const samples = db.listSamples(ts, ts + 1)
  const pids = [...new Set(samples.map((row) => row.pid))]
  const [active, ports] = await Promise.all([
    runningPids(),
    snapshotPorts(pids),
  ])

  const groups = aggregate(
    samples.map((row) => ({
      name: row.name,
      label: row.label,
      parent: row.parent,
      command: row.command,
      pid: row.pid,
      bytesIn: row.bytesIn,
      bytesOut: row.bytesOut,
    })),
    active,
    ports
  )

  return {
    scope: `实时（${shortStamp(ts * 1000)} 起 ${SAMPLE_INTERVAL_SECONDS} 秒）`,
    groups,
  }
}

/** 指定若干快照的合计明细。 */
export const groupsForSnapshots = async (
  ids: string[]
): Promise<{
  scope: string
  groups: TrafficGroup[]
}> => {
  const db = trafficStore()
  const rows = db.listSnapshotRows().filter((row) => ids.includes(row.id))
  if (rows.length === 0) {
    return { scope: "未选择快照", groups: [] }
  }

  const entries = db.listEntries(rows.map((row) => row.id))
  const pids = [...new Set(entries.flatMap((entry) => entry.pids))]
  const [active, ports] = await Promise.all([
    runningPids(),
    snapshotPorts(pids),
  ])

  const merged = entries.length > 0 ? mergeEntries([], entries) : []
  const groups = aggregate(
    merged.map((entry) => ({
      name: entry.name,
      label: entry.label,
      parent: entry.parent,
      command: entry.command,
      pid: entry.pids[0] ?? 0,
      bytesIn: entry.bytesIn,
      bytesOut: entry.bytesOut,
    })),
    active,
    ports
  )

  const first = rows[0]
  if (!first) {
    return { scope: "未选择快照", groups: [] }
  }

  const oldest = rows.reduce(
    (min, row) => Math.min(min, row.fromAt),
    first.fromAt
  )
  const newest = rows.reduce((max, row) => Math.max(max, row.toAt), first.toAt)
  const scope =
    rows.length === 1
      ? `快照 ${shortStamp(oldest * 1000)} ~ ${shortStamp(newest * 1000)}`
      : `快照合计（${rows.length} 份）`

  return { scope, groups }
}

/**
 * 删除快照。
 *
 * 快照是「相对上一份的增量」，因此删掉一份后，它的增量要并入其后一份
 * （保存时间更晚的那份），后一份的起点改成被删快照的起点。
 */
export const deleteSnapshots = async (
  ids: string[],
  options?: { report?: TrafficReport; store?: TrafficStore }
): Promise<string[]> => {
  const db = options?.store ?? trafficStore()
  let total = 0
  const remaining = db.transaction(() => {
    const rows = db.listSnapshotRows()
    const ascending = [...rows].sort((a, b) => a.savedAt - b.savedAt)
    const targets = ascending.filter((row) => ids.includes(row.id))
    total = targets.length
    let processed = 0

    const report = options?.report
    for (const row of targets) {
      processed += 1
      report?.({
        done: processed - 1,
        total: targets.length,
        bytesDone: null,
        bytesTotal: null,
        stage: "重算增量链",
        currentTarget: row.id,
      })

      const current = db
        .listSnapshotRows()
        .sort((a, b) => a.savedAt - b.savedAt)
      const index = current.findIndex((item) => item.id === row.id)
      const actualRow = current[index]
      if (!actualRow) throw new Error("快照在重算时不存在")
      const following = current[index + 1]

      if (!following) {
        db.deleteSnapshot(row.id)
        continue
      }

      const followingEntries = db.listEntries([following.id]).map((entry) => ({
        name: entry.name,
        label: entry.label,
        parent: entry.parent,
        command: entry.command,
        ports: entry.ports,
        pids: entry.pids,
        bytesIn: entry.bytesIn,
        bytesOut: entry.bytesOut,
      }))
      const removedEntries = db.listEntries([row.id]).map((entry) => ({
        name: entry.name,
        label: entry.label,
        parent: entry.parent,
        command: entry.command,
        ports: entry.ports,
        pids: entry.pids,
        bytesIn: entry.bytesIn,
        bytesOut: entry.bytesOut,
      }))
      const merged = mergeEntries(followingEntries, removedEntries)

      db.replaceSnapshot(
        {
          ...following,
          fromAt: actualRow.fromAt,
          bytesIn: merged.reduce((sum, entry) => sum + entry.bytesIn, 0),
          bytesOut: merged.reduce((sum, entry) => sum + entry.bytesOut, 0),
        },
        merged
      )
      db.deleteSnapshot(row.id)
    }

    return db.listSnapshotRows().map((row) => row.id)
  })
  options?.report?.({
    done: total,
    total,
    bytesDone: null,
    bytesTotal: null,
    stage: "完成",
    currentTarget: null,
  })
  return remaining
}

/** 把多份快照合并成一份（保留最新那份的时间与 id）。 */
export const mergeSnapshots = async (
  ids: string[],
  options?: { report?: TrafficReport; store?: TrafficStore }
): Promise<string[]> => {
  const db = options?.store ?? trafficStore()
  const report = options?.report
  let total = 0
  const remaining = db.transaction(() => {
    const rows = db.listSnapshotRows().filter((row) => ids.includes(row.id))
    total = rows.length
    if (rows.length < 2) {
      return db.listSnapshotRows().map((row) => row.id)
    }

    const first = rows[0]
    if (!first) {
      return db.listSnapshotRows().map((row) => row.id)
    }
    report?.({
      done: 0,
      total: rows.length,
      bytesDone: null,
      bytesTotal: null,
      stage: `合并 ${rows.length} 份快照`,
      currentTarget: null,
    })

    const newest = rows.reduce(
      (max, row) => (row.savedAt > max.savedAt ? row : max),
      first
    )
    const oldestFromAt = rows.reduce(
      (min, row) => Math.min(min, row.fromAt),
      first.fromAt
    )

    const entries = db.listEntries(rows.map((row) => row.id)).map((entry) => ({
      name: entry.name,
      label: entry.label,
      parent: entry.parent,
      command: entry.command,
      ports: entry.ports,
      pids: entry.pids,
      bytesIn: entry.bytesIn,
      bytesOut: entry.bytesOut,
    }))
    const merged = mergeEntries([], entries)

    db.replaceSnapshot(
      {
        ...newest,
        fromAt: oldestFromAt,
        bytesIn: merged.reduce((sum, entry) => sum + entry.bytesIn, 0),
        bytesOut: merged.reduce((sum, entry) => sum + entry.bytesOut, 0),
      },
      merged
    )

    for (const row of rows) {
      if (row.id !== newest.id) {
        db.deleteSnapshot(row.id)
      }
    }

    return db.listSnapshotRows().map((row) => row.id)
  })
  report?.({
    done: total,
    total,
    bytesDone: null,
    bytesTotal: null,
    stage: "完成",
    currentTarget: null,
  })
  return remaining
}

export const trafficSamplerError = (): string | null => lastError
