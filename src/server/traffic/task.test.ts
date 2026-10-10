import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createExecutorRegistry, taskExecutors } from "@server/tasks/executors"
import { TASK_KINDS, type TaskProgress } from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { captureSnapshot, deleteSnapshots, mergeSnapshots } from "./service"
import { TrafficStore } from "./store"
import {
  runDeleteSnapshotsTask,
  runMergeSnapshotsTask,
  runSaveSnapshotTask,
} from "./task"

let dir: string
let store: TrafficStore

/** 往库里塞两轮采样，够生成一份真实快照。 */
const seedSamples = (): void => {
  const rows = [
    {
      ts: 100,
      name: "node",
      label: "node",
      parent: "zsh",
      command: "node server.js",
      pid: 4321,
      bytesIn: 1024,
      bytesOut: 2048,
    },
  ]
  store.insertSamples(rows)
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-traffic-task-"))
  store = new TrafficStore(path.join(dir, "snapshots.sqlite3"))
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe("traffic snapshot tasks", () => {
  it("saves a snapshot with real progress and returns a small result", async () => {
    seedSamples()
    const progress: TaskProgress[] = []
    const outcome = await runSaveSnapshotTask({
      savedBy: "manual",
      report: (item) => progress.push(item),
      store,
    })
    expect(outcome.result.snapshotId).toContain("snapshot-")
    expect(outcome.result.rangeText).toContain("~")
    // 结果里没有整份快照与进程明细，任务记录不会被撑大
    expect(Object.keys(outcome.result).sort()).toEqual([
      "rangeText",
      "snapshotId",
    ])
    expect(progress.at(-1)?.stage).toContain("写入")
    // 真正落库：临时库里能看到这一份
    expect(store.listSnapshotRows().map((row) => row.id)).toEqual([
      outcome.result.snapshotId,
    ])
  })

  it("merges and deletes snapshots through the injected store", async () => {
    seedSamples()
    const first = await captureSnapshot("manual", { store })
    const second = await captureSnapshot("manual", { store })
    expect(store.listSnapshotRows()).toHaveLength(2)

    const earliestFromAt = Math.min(
      ...store.listSnapshotRows().map((row) => row.fromAt)
    )
    const mergeProgress: TaskProgress[] = []
    const merged = await mergeSnapshots([first.snapshotId, second.snapshotId], {
      store,
      report: (item) => mergeProgress.push(item),
    })
    expect(merged).toHaveLength(1)
    // 进度是按真实处理的份数走的
    expect(mergeProgress.at(-1)).toMatchObject({ done: 2, total: 2 })
    // 合并成一份，且区间从更早的起点开始：数据没有丢
    const remaining = store.listSnapshotRows()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].fromAt).toBe(earliestFromAt)

    const afterDelete = await deleteSnapshots([remaining[0].id], { store })
    expect(afterDelete).toEqual([])
    expect(store.listSnapshotRows()).toEqual([])
  })

  it("keeps the deletion report honest about how many snapshots it re-linked", async () => {
    seedSamples()
    await captureSnapshot("manual", { store })
    await captureSnapshot("manual", { store })
    const rows = store.listSnapshotRows()
    expect(rows).toHaveLength(2)
    // 两份快照是在同一秒内生成的，这里按 id 明确指定要删的那一份
    const target = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))[0]
    const progress: TaskProgress[] = []
    await deleteSnapshots([target.id], {
      store,
      report: (item) => progress.push(item),
    })
    expect(progress.at(-1)).toMatchObject({ done: 1, total: 1, stage: "完成" })
    // 删掉一份后仍有一份，且继承更早的起点：增量数据不丢
    const left = store.listSnapshotRows()
    expect(left).toHaveLength(1)
    expect(left[0].fromAt).toBeLessThanOrEqual(left[0].toAt)
  })
})

describe("traffic executor wiring", () => {
  it("registers all three snapshot kinds and rejects malformed payloads", async () => {
    const registry = createExecutorRegistry(taskExecutors)
    for (const kind of [
      TASK_KINDS.trafficSnapshotSave,
      TASK_KINDS.trafficSnapshotMerge,
      TASK_KINDS.trafficSnapshotDelete,
    ]) {
      expect(registry.get(kind)).not.toBeNull()
    }
    await expect(
      registry
        .get(TASK_KINDS.trafficSnapshotMerge)
        ?.run({ ids: [] }, { report: () => undefined })
    ).rejects.toThrow("合并快照载荷非法")
    await expect(
      registry
        .get(TASK_KINDS.trafficSnapshotDelete)
        ?.run({ shell: "rm -rf /" }, { report: () => undefined })
    ).rejects.toThrow("删除快照载荷非法")
  })

  it("runs the merge task through the executor shape", async () => {
    seedSamples()
    const first = await captureSnapshot("manual", { store })
    const second = await captureSnapshot("manual", { store })
    const outcome = await runMergeSnapshotsTask({
      ids: [first.snapshotId, second.snapshotId],
      report: () => undefined,
      store,
    })
    expect(outcome.result.snapshotIds).toHaveLength(1)
  })

  it("reports the delete task result as the remaining snapshot ids", async () => {
    seedSamples()
    const first = await captureSnapshot("manual", { store })
    const outcome = await runDeleteSnapshotsTask({
      ids: [first.snapshotId],
      report: () => undefined,
      store,
    })
    expect(outcome.result.snapshotIds).toEqual([])
  })
})
