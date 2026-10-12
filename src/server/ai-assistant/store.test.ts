import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let directory = ""
let dbFile = ""

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "ai-assistant-store-test-"))
  dbFile = path.join(directory, "test.sqlite3")
  process.env.MAC_MANAGER_DB_FILE = dbFile
  vi.resetModules()
})

afterEach(() => {
  delete process.env.MAC_MANAGER_DB_FILE
  rmSync(directory, { recursive: true, force: true })
})

describe("会话状态迁移", () => {
  it("开始运行写 running 与用户输入，结束时补回答并写终态", async () => {
    const store = await import("./store")
    store.saveSession({ id: "a", settingsSnapshot: { providerId: "p" } })

    const started = store.startSessionRun("a", { role: "user", text: "问" })
    expect(started.status).toBe("running")
    expect(started.messages).toEqual([{ role: "user", text: "问" }])

    const finished = store.finishSessionRun("a", "done", "答")
    expect(finished.status).toBe("done")
    expect(finished.messages).toEqual([
      { role: "user", text: "问" },
      { role: "assistant", text: "答" },
    ])
  })

  it("拿不到回答时只写终态，不伪造助手消息", async () => {
    const store = await import("./store")
    store.saveSession({ id: "a2", settingsSnapshot: {} })
    store.startSessionRun("a2", { role: "user", text: "问" })

    const finished = store.finishSessionRun("a2", "unknown", null)

    expect(finished.status).toBe("unknown")
    expect(finished.messages).toEqual([{ role: "user", text: "问" }])
  })

  it("执行中的会话不能清空，结束后才可以", async () => {
    const store = await import("./store")
    store.saveSession({ id: "b", settingsSnapshot: {} })
    store.startSessionRun("b", { role: "user", text: "问" })

    expect(() => store.clearSession("b")).toThrow("正在执行")
    expect(store.readSession("b").status).toBe("running")

    store.finishSessionRun("b", "unknown", null)
    expect(() => store.clearSession("b")).not.toThrow()
    expect(() => store.readSession("b")).toThrow("会话不存在")
  })

  it("历史不存在时开始或结束运行都明确报 404，不静默", async () => {
    const store = await import("./store")
    expect(() => store.startSessionRun("nope", {})).toThrow("会话不存在")
    expect(() => store.finishSessionRun("nope", "done")).toThrow("会话不存在")
  })

  it("请求标识随 running 一起落盘，可按标识查回", async () => {
    const store = await import("./store")
    store.saveSession({ id: "r1", settingsSnapshot: {} })
    store.startSessionRun("r1", { role: "user", text: "问" }, "req-1")

    expect(store.readSession("r1").requestId).toBe("req-1")
    expect(store.findSessionByRequestId("req-1")?.id).toBe("r1")
    expect(store.findSessionByRequestId("req-missing")).toBeNull()
  })

  it("终态只写一次，后到的收尾不覆盖已确认的结果", async () => {
    const store = await import("./store")
    store.saveSession({ id: "r2", settingsSnapshot: {} })
    store.startSessionRun("r2", { role: "user", text: "问" })
    store.finishSessionRun("r2", "done", "答")

    // 例如断连与显式停止同时发生：第二次收尾必须是空操作。
    const again = store.finishSessionRun("r2", "unknown", null)
    expect(again.status).toBe("done")
    expect(again.messages).toEqual([
      { role: "user", text: "问" },
      { role: "assistant", text: "答" },
    ])
  })

  it("执行中持续落盘回答，只替换末尾那条助手消息", async () => {
    const store = await import("./store")
    store.saveSession({ id: "r3", settingsSnapshot: {} })
    store.startSessionRun("r3", { role: "user", text: "问" })

    store.saveSessionAnswer("r3", "半句")
    store.saveSessionAnswer("r3", "半句继续")
    expect(store.readSession("r3").messages).toEqual([
      { role: "user", text: "问" },
      { role: "assistant", text: "半句继续" },
    ])
    // 中间落盘不改状态，执行仍在进行
    expect(store.readSession("r3").status).toBe("running")

    // 收尾时不会再多追加一条助手消息
    store.finishSessionRun("r3", "done", "半句继续")
    expect(store.readSession("r3").messages).toEqual([
      { role: "user", text: "问" },
      { role: "assistant", text: "半句继续" },
    ])
  })
})

describe("服务重启后的孤立运行记录", () => {
  it("首次连库时把 running 标成 unknown，并保留已有消息", async () => {
    // 模拟上次进程被杀留下的 running 记录。
    const raw = new DatabaseSync(dbFile)
    raw.exec(`CREATE TABLE ai_assistant_session (
      id TEXT PRIMARY KEY,
      settings_snapshot TEXT NOT NULL,
      messages TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'idle',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`)
    raw
      .prepare(
        "INSERT INTO ai_assistant_session(id, settings_snapshot, messages, status, created_at, updated_at) VALUES(?,?,?,?,?,?)"
      )
      .run(
        "orphan",
        "{}",
        JSON.stringify([{ role: "user", text: "上次没跑完" }]),
        "running",
        1,
        1
      )
    raw.close()

    const store = await import("./store")
    const row = store.readSession("orphan")

    expect(row.status).toBe("unknown")
    expect(row.messages).toEqual([{ role: "user", text: "上次没跑完" }])
  })
})
