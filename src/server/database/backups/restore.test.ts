import { type ChildProcess, spawn } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import {
  probeProcessStartedAt,
  registerDatabaseUser,
} from "@server/common/database-maintenance"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { inspectBackupContent, loadManifest } from "./catalog"
import { runPendingRestore } from "./restore"
import {
  readRestorePlan,
  submitRestorePlan,
  transitionRestorePlan,
} from "./restore-plan"
import { createDatabaseBackupService } from "./service"

/**
 * 恢复执行用例：只用临时目录与受控子进程；不重启服务、不终止真实任务、
 * 不恢复真实库。覆盖：恢复后与来源一致且安全备份含恢复前数据、提交不改
 * 数据、来源被替换拒绝、空间不足拒绝、活跃使用者拒绝且不杀进程、锁被持有
 * 与过期锁、崩溃续走、新库校验失败回退、旧 WAL 不污染、任务标未知不重放。
 */

const FIXED_NOW = Date.UTC(2026, 9, 12, 9, 34, 5, 123)

let root = ""
let backupDir = ""
let stateDir = ""
let databaseFile = ""
const children: ChildProcess[] = []

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mac-restore-"))
  backupDir = path.join(root, "backups")
  stateDir = path.join(root, "state")
  databaseFile = path.join(root, "snapshots.sqlite3")
})

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL")
  }
  rmSync(root, { recursive: true, force: true })
})

const service = () =>
  createDatabaseBackupService({
    backupDir,
    stateDir,
    sourceFile: databaseFile,
    now: () => FIXED_NOW,
  })

const planContext = () => ({ stateDir, backupDir })

const runRestore = (overrides: Parameters<typeof runPendingRestore>[0] = {}) =>
  runPendingRestore({
    databaseFile,
    backupDir,
    stateDir,
    waitTimeoutMs: 400,
    now: () => FIXED_NOW,
    ...overrides,
  })

/** 读当前库的 items 表（只读）。 */
const readItems = (file: string): string[] => {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    return database
      .prepare("SELECT name FROM items ORDER BY id")
      .all()
      .map((row) => String(row.name))
  } finally {
    database.close()
  }
}

const spawnSleeper = (): ChildProcess => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  })
  children.push(child)
  return child
}

type Scenario = {
  backupId: string
  signature: string
  fileName: string
}

/**
 * 标准场景：
 * - 当前库含应用必要表、items=row-0..2，以及一个 running 任务；
 * - 生成备份（来源只含 row-0..2，与当前库一致）；
 * - 随后向当前库追加 row-extra（恢复前的数据），关闭连接后把未 checkpoint
 *   的 WAL 内容原样放回，得到「主库 + 孤儿 -wal」的崩溃现场，用来验证旧 WAL
 *   会随旧库一起留存、绝不污染恢复后的新库。
 * - 不保留打开的连接：测试环境里「连接打开且有未 checkpoint 写入」会让
 *   原生 backup 长时间等待，真实环境（tsx/生产）无此问题。
 */
const prepareScenario = async (): Promise<{ scenario: Scenario }> => {
  const database = new DatabaseSync(databaseFile)
  database.exec("PRAGMA journal_mode = WAL")
  database.exec("PRAGMA wal_autocheckpoint = 0")
  database.exec(`
    CREATE TABLE traffic_samples (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL);
    CREATE TABLE traffic_snapshots (id TEXT PRIMARY KEY, saved_at INTEGER NOT NULL);
    CREATE TABLE traffic_snapshot_entries (snapshot_id TEXT NOT NULL);
    CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE task_record (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      request_fingerprint TEXT,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      lock_target TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      progress TEXT,
      message TEXT,
      error TEXT,
      result TEXT,
      started_at REAL NOT NULL,
      finished_at REAL,
      updated_at REAL NOT NULL
    );
  `)
  database.exec(
    "INSERT INTO items (name) VALUES ('row-0'), ('row-1'), ('row-2')"
  )
  database.exec(
    `INSERT INTO task_record (id, kind, target, status, started_at, updated_at)
     VALUES ('task-live', 'database_backup_create', 'database:backup', 'running', 1, 1)`
  )
  database.close()

  const created = await service().create({ source: "manual" })

  // 恢复前的数据：追加一行，取出未 checkpoint 的 WAL 内容后关闭连接，
  // 再把 WAL 原样放回，得到孤儿 -wal（帧里含 row-extra）。
  const walConnection = new DatabaseSync(databaseFile)
  walConnection.exec("PRAGMA journal_mode = WAL")
  walConnection.exec("PRAGMA wal_autocheckpoint = 0")
  walConnection.exec("INSERT INTO items (name) VALUES ('row-extra')")
  const walBytes = readFileSync(`${databaseFile}-wal`)
  walConnection.close()
  writeFileSync(`${databaseFile}-wal`, walBytes)

  return {
    scenario: {
      backupId: created.backup.id,
      signature: created.backup.contentSignature,
      fileName: created.backup.fileName,
    },
  }
}

const submit = (scenario: Scenario) =>
  submitRestorePlan(
    {
      backupId: scenario.backupId,
      expectedSignature: scenario.signature,
    },
    planContext()
  )

const preRestoreFiles = (): string[] =>
  readdirSync(root).filter((name) =>
    name.startsWith("snapshots.sqlite3.pre-restore-")
  )

const safetyBackups = () =>
  loadManifest(backupDir).entries.filter(
    (entry) => entry.source === "pre_restore"
  )

describe("启动前受控恢复", () => {
  it("恢复后表与值与来源一致，安全备份包含恢复前数据，任务标未知不重放", async () => {
    const { scenario } = await prepareScenario()
    submit(scenario)
    // 提交计划只是写旁置文件：当前数据不变。
    expect(readItems(databaseFile)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-extra",
    ])

    const outcome = await runRestore()
    expect(outcome.status).toBe("applied")

    // 1. 恢复后与来源一致：WAL 里恢复前的 row-extra 不残留。
    expect(readItems(databaseFile)).toEqual(["row-0", "row-1", "row-2"])
    const sourceInspection = inspectBackupContent(
      path.join(backupDir, scenario.fileName)
    )
    const finalInspection = inspectBackupContent(databaseFile)
    expect(finalInspection.structureSignature).toBe(
      sourceInspection.structureSignature
    )
    expect(finalInspection.integrity.ok).toBe(true)

    // 2. 旧 WAL 不污染新库：原位的 -wal 随旧库一起留存，新库遇到不到它。
    expect(existsSync(`${databaseFile}-wal`)).toBe(false)
    const keptPrimary = preRestoreFiles().filter(
      (name) => !name.endsWith("-wal") && !name.endsWith("-shm")
    )
    expect(keptPrimary).toHaveLength(1)
    expect(preRestoreFiles().some((name) => name.endsWith("-wal"))).toBe(true)

    // 3. 安全备份包含恢复前数据（含 row-extra），且是独立可读的备份。
    const safety = safetyBackups()
    expect(safety).toHaveLength(1)
    const safetyFile = path.join(backupDir, safety[0].fileName)
    expect(readItems(safetyFile)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-extra",
    ])

    // 4. 恢复库里的 running 任务标为结果未知，不自动重做。
    const final = new DatabaseSync(databaseFile, { readOnly: true })
    const task = final
      .prepare("SELECT status, error FROM task_record WHERE id = 'task-live'")
      .get() as { status: string; error: string } | undefined
    final.close()
    expect(task?.status).toBe("unknown")
    expect(task?.error).toContain("不自动重做")

    // 5. 计划落终态、锁释放、不留临时文件。
    const plan = readRestorePlan(planContext()).plan
    expect(plan?.status).toBe("applied")
    expect(plan?.phase).toBe("completed")
    expect(existsSync(path.join(stateDir, "restore.lock"))).toBe(false)
    expect(
      readdirSync(root).filter((name) => name.startsWith(".restore-"))
    ).toHaveLength(0)
  }, 30_000)

  it("提交计划不改变当前数据", async () => {
    const { scenario } = await prepareScenario()
    submit(scenario)
    expect(readItems(databaseFile)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-extra",
    ])
    expect(readRestorePlan(planContext()).plan?.status).toBe("pending")
  }, 30_000)

  it("来源被替换：拒绝恢复，当前库与备份目录保持原状", async () => {
    const { scenario } = await prepareScenario()
    submit(scenario)
    // 发布后篡改备份文件：执行前的身份核验必须拦下。
    const file = path.join(backupDir, scenario.fileName)
    writeFileSync(file, Buffer.alloc(512, 7))

    const outcome = await runRestore()
    expect(outcome.status).toBe("failed")
    if (outcome.status === "failed") expect(outcome.phase).toBe("accepted")
    expect(readItems(databaseFile)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-extra",
    ])
    expect(safetyBackups()).toHaveLength(0)
    expect(preRestoreFiles()).toHaveLength(0)
    expect(existsSync(path.join(stateDir, "restore.lock"))).toBe(false)
  }, 30_000)

  it("磁盘空间不足：明确失败，当前库不被触碰", async () => {
    const { scenario } = await prepareScenario()
    submit(scenario)
    const outcome = await runRestore({ freeBytes: () => 0 })
    expect(outcome.status).toBe("failed")
    expect(readItems(databaseFile)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-extra",
    ])
    expect(safetyBackups()).toHaveLength(0)
    expect(preRestoreFiles()).toHaveLength(0)
  }, 30_000)

  it("仍有活跃使用者：拒绝恢复、不杀进程，等退出后才会执行", async () => {
    const { scenario } = await prepareScenario()
    submit(scenario)
    const worker = spawnSleeper()
    registerDatabaseUser("task-worker", {
      stateDir,
      pid: worker.pid as number,
    })

    const outcome = await runRestore({ waitTimeoutMs: 300 })
    expect(outcome.status).toBe("failed")
    if (outcome.status === "failed") expect(outcome.phase).toBe("verify_users")
    // 不杀进程：使用者原样活着。
    expect(worker.exitCode).toBeNull()
    expect(readItems(databaseFile)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-extra",
    ])
    expect(preRestoreFiles()).toHaveLength(0)
  }, 30_000)

  it("恢复锁被持有：拒绝且不清他人的锁", async () => {
    const { scenario } = await prepareScenario()
    submit(scenario)
    mkdirSync(stateDir, { recursive: true })
    const lockFile = path.join(stateDir, "restore.lock")
    writeFileSync(
      lockFile,
      JSON.stringify({
        pid: process.pid,
        pidStartedAt: probeProcessStartedAt(process.pid),
        token: "other-holder",
        acquiredAt: Date.now(),
      })
    )
    const outcome = await runRestore()
    expect(outcome.status).toBe("failed")
    if (outcome.status === "failed") expect(outcome.phase).toBe("acquire_lock")
    // 他人的锁原样保留。
    expect(existsSync(lockFile)).toBe(true)
    expect(readItems(databaseFile)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-extra",
    ])
  }, 30_000)

  it("过期锁（持有者已退出）：接管后正常恢复", async () => {
    const { scenario } = await prepareScenario()
    submit(scenario)
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
    const outcome = await runRestore()
    expect(outcome.status).toBe("applied")
  }, 30_000)
})

describe("崩溃后续走与回退", () => {
  /** 造一个「上次崩溃在切换阶段」的计划状态（切换前不再安全备份）。 */
  const enterSwitching = (
    scenario: Scenario,
    kept: string,
    tempFor: (planId: string) => string
  ): string => {
    const plan = submitRestorePlan(
      {
        backupId: scenario.backupId,
        expectedSignature: scenario.signature,
        backupCurrent: false,
      },
      planContext()
    )
    transitionRestorePlan("applying", {
      phase: "switching",
      message: `切换准备：old=${databaseFile};kept=${kept};temp=${tempFor(plan.id)}`,
      context: planContext(),
    })
    return plan.id
  }

  /** 恢复流程实际使用的临时库路径（与 planId 绑定）。 */
  const tempPathFor = (planId: string): string =>
    path.join(root, `.restore-${planId}.tmp`)

  it("切换前崩溃（旧库与临时库都在）：续走完成切换", async () => {
    const { scenario } = await prepareScenario()
    const kept = `${databaseFile}.pre-restore-20261012T093405123Z`
    const planId = enterSwitching(scenario, kept, tempPathFor)
    const temp = tempPathFor(planId)
    copyFileSync(path.join(backupDir, scenario.fileName), temp)

    const outcome = await runRestore()
    expect(outcome.status).toBe("applied")
    expect(readItems(databaseFile)).toEqual(["row-0", "row-1", "row-2"])
    expect(existsSync(kept)).toBe(true)
    expect(existsSync(temp)).toBe(false)
  }, 30_000)

  it("只差最后一步（旧库已留存、临时库就绪）：补完切换", async () => {
    const { scenario } = await prepareScenario()
    const kept = `${databaseFile}.pre-restore-20261012T093405123Z`
    const planId = enterSwitching(scenario, kept, tempPathFor)
    const temp = tempPathFor(planId)
    // 模拟：旧库连同 WAL/SHM 已改名留存，只差把临时库放进主库位置。
    renameSync(databaseFile, kept)
    if (existsSync(`${databaseFile}-wal`)) {
      renameSync(`${databaseFile}-wal`, `${kept}-wal`)
    }
    if (existsSync(`${databaseFile}-shm`)) {
      renameSync(`${databaseFile}-shm`, `${kept}-shm`)
    }
    copyFileSync(path.join(backupDir, scenario.fileName), temp)

    const outcome = await runRestore()
    expect(outcome.status).toBe("applied")
    expect(readItems(databaseFile)).toEqual(["row-0", "row-1", "row-2"])
    expect(existsSync(temp)).toBe(false)
  }, 30_000)

  it("新库已就位但校验失败：回退到留存的旧库并如实报失败", async () => {
    const { scenario } = await prepareScenario()
    const kept = `${databaseFile}.pre-restore-20261012T093405123Z`
    // 模拟：切换已完成（旧库连同 WAL/SHM 已留存、主库位是坏文件），
    // 核实阶段发现新库不合格，应回退到留存的旧库并如实报失败。
    renameSync(databaseFile, kept)
    if (existsSync(`${databaseFile}-wal`)) {
      renameSync(`${databaseFile}-wal`, `${kept}-wal`)
    }
    if (existsSync(`${databaseFile}-shm`)) {
      renameSync(`${databaseFile}-shm`, `${kept}-shm`)
    }
    writeFileSync(databaseFile, Buffer.alloc(1024, 9))
    enterSwitching(scenario, kept, tempPathFor)

    const outcome = await runRestore()
    expect(outcome.status).toBe("failed")
    if (outcome.status === "failed") expect(outcome.phase).toBe("verify")
    // 旧库完整回退：恢复前数据都在，坏文件不再占用主库位置。
    expect(readItems(databaseFile)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-extra",
    ])
    expect(existsSync(kept)).toBe(false)
  }, 30_000)

  it("文件组合无法解释：停下报 unknown，保留资料不猜", async () => {
    const { scenario } = await prepareScenario()
    const kept = `${databaseFile}.pre-restore-20261012T093405123Z`
    // 主库与留存都不在、只剩临时库：无法证明该续走还是回退。
    renameSync(databaseFile, kept)
    const planId = enterSwitching(scenario, kept, tempPathFor)
    const temp = tempPathFor(planId)
    rmSync(kept)
    copyFileSync(path.join(backupDir, scenario.fileName), temp)

    const outcome = await runRestore()
    expect(outcome.status).toBe("unknown")
    if (outcome.status === "unknown") expect(outcome.phase).toBe("switching")
    expect(readRestorePlan(planContext()).plan?.status).toBe("unknown")
    // 临时库作为资料保留，供人工核对。
    expect(existsSync(temp)).toBe(true)
  }, 30_000)

  it("恢复临时库生成失败：判别为 prepare 阶段，当前库不动", async () => {
    const { scenario } = await prepareScenario()
    submit(scenario)
    // 等价于磁盘/来源在本阶段不可用：备份源在生成临时库前被移走。
    let removed = false
    const outcome = await runRestore({
      report: (progress) => {
        if (progress.stage === "生成并校验恢复临时库" && !removed) {
          removed = true
          rmSync(path.join(backupDir, scenario.fileName), { force: true })
        }
      },
    })
    expect(removed).toBe(true)
    expect(outcome.status).toBe("failed")
    if (outcome.status === "failed") expect(outcome.phase).toBe("prepare")
    expect(readItems(databaseFile)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-extra",
    ])
    expect(preRestoreFiles()).toHaveLength(0)
  }, 30_000)
})
