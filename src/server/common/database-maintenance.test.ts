import { type ChildProcess, spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  acquireRestoreLock,
  assertRestoreBarrierOpen,
  probeProcessStartedAt,
  readRestoreLock,
  registerDatabaseUser,
  releaseRestoreLock,
  runStartupMaintenanceBarrier,
  scanDatabaseUsers,
  waitForDatabaseUsersExit,
} from "./database-maintenance"

/**
 * 维护层用例：只用临时目录与受控子进程，不碰真实服务与真实数据库。
 * 覆盖 PID 归属复验（含 PID 复用）、活跃与过期锁、探测失效的 fail-closed、
 * 使用者等待期限、屏障先于后续初始化的顺序，以及拒绝恢复时不杀进程。
 */

let root = ""
let stateDir = ""
const children: ChildProcess[] = []

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mac-maintenance-"))
  stateDir = path.join(root, "state")
})

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL")
  }
  rmSync(root, { recursive: true, force: true })
})

/** 受控子进程：只是活着，用来扮演另一个实例或后台 worker。 */
const spawnSleeper = (): ChildProcess => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  })
  children.push(child)
  return child
}

const userFiles = (): string[] => {
  const dir = path.join(stateDir, "database-users")
  return existsSync(dir) ? readdirSync(dir) : []
}

describe("使用者登记与归属复验", () => {
  it("登记与注销：归属可证时算活跃，注销后不再出现", () => {
    const registered = registerDatabaseUser("server", { stateDir })
    expect(registered.record.pid).toBe(process.pid)
    expect(registered.record.pidStartedAt.length).toBeGreaterThan(0)
    expect(userFiles()).toHaveLength(1)

    const scan = scanDatabaseUsers({ stateDir })
    expect(scan.unverifiable).toBe(false)
    expect(scan.active.map((item) => item.role)).toContain("server")
    expect(scan.stale).toHaveLength(0)

    registered.unregister()
    expect(userFiles()).toHaveLength(0)
    expect(scanDatabaseUsers({ stateDir }).active).toHaveLength(0)
  })

  it("PID 被复用：启动时间对不上，只算陈旧不算活跃", () => {
    const dir = path.join(stateDir, "database-users")
    mkdirSync(dir, { recursive: true })
    // PID 是本进程（必然存活），但登记的启动时间是假的：复验必须判陈旧。
    writeFileSync(
      path.join(dir, `${process.pid}-reused.json`),
      JSON.stringify({
        pid: process.pid,
        pidStartedAt: "Mon Jan 1 00:00:00 1990",
        token: "reused",
        role: "server",
        registeredAt: Date.now(),
      })
    )
    const scan = scanDatabaseUsers({ stateDir })
    expect(scan.active).toHaveLength(0)
    expect(scan.stale).toHaveLength(1)
  })

  it("进程已退出：登记记录判陈旧，不再阻塞恢复", () => {
    const child = spawnSleeper()
    const pid = child.pid
    expect(pid).toBeDefined()
    const registered = registerDatabaseUser("task-worker", {
      stateDir,
      pid: pid as number,
    })
    expect(
      scanDatabaseUsers({ stateDir }).active.map((item) => item.pid)
    ).toContain(pid)
    child.kill("SIGKILL")
    // 等进程真正退出，避免 ps 竞态。
    return new Promise<void>((resolve) => {
      child.once("exit", () => {
        const scan = scanDatabaseUsers({ stateDir })
        expect(scan.active).toHaveLength(0)
        expect(scan.stale.map((item) => item.pid)).toContain(pid)
        registered.unregister()
        resolve()
      })
    })
  })

  it("探测失效：如实报无法证明，不当成没有使用者", () => {
    const registered = registerDatabaseUser("server", { stateDir })
    const scan = scanDatabaseUsers({
      stateDir,
      probe: () => {
        throw new Error("ps 不可用")
      },
    })
    expect(scan.unverifiable).toBe(true)
    expect(scan.active).toHaveLength(0)
    registered.unregister()
  })

  it("登记记录损坏：无法证明使用者已退出，报无法证明", () => {
    const dir = path.join(stateDir, "database-users")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "broken.json"), "not json")
    const scan = scanDatabaseUsers({ stateDir })
    expect(scan.unverifiable).toBe(true)
  })

  it("真实 ps 探测：本进程的启动时间稳定可读", () => {
    const first = probeProcessStartedAt(process.pid)
    const second = probeProcessStartedAt(process.pid)
    expect(first).not.toBeNull()
    expect(first).toBe(second)
    expect(probeProcessStartedAt(99999999)).toBeNull()
  })
})

describe("排他恢复锁", () => {
  it("取得与释放：持有期间重复取得被拒，释放后可再取", () => {
    const lock = acquireRestoreLock({ stateDir })
    expect(readRestoreLock({ stateDir }).holderAlive).toBe(true)
    expect(() => acquireRestoreLock({ stateDir })).toThrow(/持有/)
    releaseRestoreLock(lock, { stateDir })
    expect(readRestoreLock({ stateDir }).record).toBeNull()
    const again = acquireRestoreLock({ stateDir })
    releaseRestoreLock(again, { stateDir })
  })

  it("持有者已退出的过期锁：可接管，不算活跃", () => {
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      path.join(stateDir, "restore.lock"),
      JSON.stringify({
        pid: 99999999,
        pidStartedAt: "Mon Jan 1 00:00:00 1990",
        token: "stale",
        acquiredAt: Date.now(),
      })
    )
    const state = readRestoreLock({ stateDir })
    expect(state.holderAlive).toBe(false)
    const lock = acquireRestoreLock({ stateDir })
    expect(readRestoreLock({ stateDir }).record?.token).toBe(lock.token)
    releaseRestoreLock(lock, { stateDir })
  })

  it("锁损坏：拒绝取得且不清理锁文件", () => {
    mkdirSync(stateDir, { recursive: true })
    const file = path.join(stateDir, "restore.lock")
    writeFileSync(file, "corrupt-not-json")
    expect(() => acquireRestoreLock({ stateDir })).toThrow(/损坏/)
    expect(existsSync(file)).toBe(true)
    expect(() => assertRestoreBarrierOpen({ stateDir })).toThrow(/损坏/)
  })

  it("锁归属无法验证：fail-closed，不清理锁", () => {
    mkdirSync(stateDir, { recursive: true })
    const file = path.join(stateDir, "restore.lock")
    const lock = JSON.stringify({
      pid: 4242,
      pidStartedAt: "Mon Jan 1 00:00:00 2000",
      token: "unknown",
      acquiredAt: Date.now(),
    })
    writeFileSync(file, lock)
    expect(() =>
      acquireRestoreLock({
        stateDir,
        probe: () => {
          throw new Error("ps 坏了")
        },
      })
    ).toThrow(/归属无法确认/)
    expect(existsSync(file)).toBe(true)
    // 有锁就拒绝：无法验证归属时同样不放行（fail-closed）。
    expect(() =>
      assertRestoreBarrierOpen({
        stateDir,
        probe: () => {
          throw new Error("ps 坏了")
        },
      })
    ).toThrow(/正在恢复/)
    expect(
      readRestoreLock({
        stateDir,
        probe: () => {
          throw new Error("ps")
        },
      }).unverifiable
    ).toBe(true)
  })

  it("屏障：无锁放行，有锁拒绝", () => {
    expect(() => assertRestoreBarrierOpen({ stateDir })).not.toThrow()
    const lock = acquireRestoreLock({ stateDir })
    expect(() => assertRestoreBarrierOpen({ stateDir })).toThrow(/正在恢复/)
    releaseRestoreLock(lock, { stateDir })
    expect(() => assertRestoreBarrierOpen({ stateDir })).not.toThrow()
  })

  it("释放锁时不误删他人后取的锁（token 不符跳过）", () => {
    const mine = acquireRestoreLock({ stateDir })
    // 模拟锁被别人换掉：直接改写文件。
    writeFileSync(
      path.join(stateDir, "restore.lock"),
      JSON.stringify({
        pid: process.pid,
        pidStartedAt: mine.pidStartedAt,
        token: "someone-else",
        acquiredAt: Date.now(),
      })
    )
    releaseRestoreLock(mine, { stateDir })
    expect(readRestoreLock({ stateDir }).record?.token).toBe("someone-else")
  })
})

describe("使用者等待与启动屏障", () => {
  it("双实例与后台 worker 在场：等到超时仍拒绝恢复，且不杀进程", async () => {
    const first = spawnSleeper()
    const second = spawnSleeper()
    registerDatabaseUser("server", { stateDir, pid: first.pid as number })
    registerDatabaseUser("task-worker", {
      stateDir,
      pid: second.pid as number,
    })

    const wait = await waitForDatabaseUsersExit({
      stateDir,
      timeoutMs: 400,
      pollMs: 50,
    })
    expect(wait.ok).toBe(false)
    expect(wait.scan.active).toHaveLength(2)
    // 不杀进程：两个子进程都还活着。
    expect(first.exitCode).toBeNull()
    expect(second.exitCode).toBeNull()

    let restoreRan = false
    const outcome = await runStartupMaintenanceBarrier({
      stateDir,
      hasPendingWork: () => true,
      executeRestore: async () => {
        restoreRan = true
        return "applied"
      },
      waitTimeoutMs: 300,
    })
    expect(outcome).toBeNull()
    expect(restoreRan).toBe(false)
    expect(first.exitCode).toBeNull()
    expect(second.exitCode).toBeNull()
  })

  it("使用者全部退出后放行恢复", async () => {
    const child = spawnSleeper()
    registerDatabaseUser("task-worker", { stateDir, pid: child.pid as number })
    child.kill("SIGKILL")
    await new Promise<void>((resolve) => child.once("exit", () => resolve()))

    const wait = await waitForDatabaseUsersExit({
      stateDir,
      timeoutMs: 2000,
      pollMs: 50,
    })
    expect(wait.ok).toBe(true)

    const outcome = await runStartupMaintenanceBarrier({
      stateDir,
      hasPendingWork: () => true,
      executeRestore: async () => "applied",
      waitTimeoutMs: 2000,
    })
    expect(outcome).toBe("applied")
  })

  it("没有待办时不扫描不等待，直接放行", async () => {
    const events: string[] = []
    const outcome = await runStartupMaintenanceBarrier({
      stateDir,
      hasPendingWork: () => {
        events.push("check")
        return false
      },
      executeRestore: async () => {
        events.push("restore")
        return "applied"
      },
      waitTimeoutMs: 100,
    })
    expect(outcome).toBeNull()
    expect(events).toEqual(["check"])
  })

  it("启动顺序：屏障里的恢复先执行，之后才是入口的后续初始化", async () => {
    const events: string[] = []
    // 模拟入口接线：屏障 → 登记使用者 → 创建运行时。
    const outcome = await runStartupMaintenanceBarrier({
      stateDir,
      hasPendingWork: () => true,
      executeRestore: async () => {
        events.push("restore")
        return "applied"
      },
      waitTimeoutMs: 500,
    })
    if (outcome === "applied") {
      events.push("register")
      events.push("runtime")
    }
    expect(events).toEqual(["restore", "register", "runtime"])
  })
})
