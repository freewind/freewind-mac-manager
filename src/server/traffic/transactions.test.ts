import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { deleteSnapshots, mergeSnapshots } from "./service"
import { type SnapshotEntryRow, TrafficStore } from "./store"

let dir: string
let store: TrafficStore
let control: DatabaseSync
const entry = (value: number): Omit<SnapshotEntryRow, "snapshotId"> => ({
  name: "node",
  label: "node",
  parent: "zsh",
  command: "node test.js",
  ports: [],
  pids: [123],
  bytesIn: value,
  bytesOut: 0,
})
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "traffic-transaction-"))
  const file = path.join(dir, "test.sqlite3")
  store = new TrafficStore(file)
  control = new DatabaseSync(file)
  for (let index = 1; index <= 3; index++) {
    store.insertSnapshot(
      {
        id: String(index),
        savedAt: index * 10,
        fromAt: (index - 1) * 10,
        toAt: index * 10,
        savedBy: "manual",
        bytesIn: index,
        bytesOut: 0,
      },
      [entry(index)]
    )
  }
})
afterEach(() => {
  control.close()
  store.close()
  rmSync(dir, { recursive: true, force: true })
})
const contents = () => ({
  rows: store.listSnapshotRows(),
  entries: store.listEntries(["1", "2", "3"]),
})
const failDeletion = () =>
  control.exec(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON traffic_snapshots WHEN OLD.id = '2' BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
  )

describe("snapshot chain transactions", () => {
  it("rolls back all merge writes when a later deletion fails", async () => {
    const before = contents()
    failDeletion()
    await expect(mergeSnapshots(["1", "2", "3"], { store })).rejects.toThrow(
      "injected failure"
    )
    expect(contents()).toEqual(before)
  })
  it("rolls back prior deletions and relinks when a later deletion fails", async () => {
    const before = contents()
    failDeletion()
    await expect(deleteSnapshots(["1", "2"], { store })).rejects.toThrow(
      "injected failure"
    )
    expect(contents()).toEqual(before)
  })
  it("deletes consecutive targets without skipping and carries their increments forward", async () => {
    expect(await deleteSnapshots(["1", "2"], { store })).toEqual(["3"])
    expect(store.listSnapshotRows()[0]).toMatchObject({ fromAt: 0, bytesIn: 6 })
    expect(store.listEntries(["3"])[0].bytesIn).toBe(6)
  })
  it("rolls back replaced metadata and entries when writing new entries fails", () => {
    const before = contents()
    control.exec(
      "CREATE TRIGGER fail_entry BEFORE INSERT ON traffic_snapshot_entries BEGIN SELECT RAISE(ABORT, 'entry failure'); END"
    )
    expect(() =>
      store.replaceSnapshot({ ...before.rows[0], bytesIn: 999 }, [entry(999)])
    ).toThrow("entry failure")
    expect(contents()).toEqual(before)
  })
})
