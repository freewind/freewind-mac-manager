import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { DATABASE_BACKUP_STATE_DIR } from "@server/env"

/**
 * 数据库维护公共层：进程登记、排他恢复锁与启动维护屏障。
 *
 * 约定：
 * - 本层不依赖任何业务域；恢复逻辑由入口以回调注入，公共层只负责「谁能
 *   碰数据库」与「什么时候允许恢复」的裁决。
 * - 判定进程归属用 PID 加可验证的进程启动时间（ps lstart 快照）：PID 存在
 *   不等于还是当初那个进程（PID 会被复用），启动时间对不上就视为陈旧。
 *   probe 无法执行或记录读不懂时一律 fail-closed，绝不假设使用者已退出。
 * - 恢复不杀进程、不重启服务：仍有使用者就等，等不到就拒绝恢复，让下次
 *   启动再试；锁异常同样拒绝，不清锁强行恢复。
 */

/** 使用者角色：登记谁在用数据库，便于排查与恢复前确认。 */
export type DatabaseUserRole =
  | "server"
  | "task-worker"
  | "query"
  | "mutation"
  | "validation"

export type DatabaseUserRecord = {
  pid: number
  /** 注册时的进程启动时间快照；复验归属的依据。 */
  pidStartedAt: string
  token: string
  role: DatabaseUserRole
  registeredAt: number
}

export type MaintenanceContext = {
  /** 状态目录；默认取 env 的备份维护状态目录，测试注入临时目录。 */
  stateDir?: string
  /** 进程启动时间探测；测试注入以模拟退出、PID 复用与探测失败。 */
  probe?: ProcessProbe
}

/** 返回进程启动时间；进程不存在返回 null；探测能力失效时抛错（fail-closed）。 */
export type ProcessProbe = (pid: number) => string | null

/**
 * 用 ps 读进程启动时间：同一进程多次读取结果一致，PID 被复用后启动时间
 * 必然不同，因此它能证明「这个 PID 现在还是不是当初登记的那个进程」。
 */
export const probeProcessStartedAt: ProcessProbe = (pid) => {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
  })
  if (result.error) {
    // ps 本身不可用：没有别的手段验证归属，抛错让调用方 fail-closed。
    throw new Error(`无法探测进程归属：${result.error.message}`)
  }
  const text = (result.stdout ?? "").trim()
  if (result.status !== 0 || text === "") return null
  return text
}

const resolveStateDir = (context?: MaintenanceContext): string =>
  context?.stateDir ?? DATABASE_BACKUP_STATE_DIR

const resolveProbe = (context?: MaintenanceContext): ProcessProbe =>
  context?.probe ?? probeProcessStartedAt

const usersDirectory = (stateDir: string): string =>
  path.join(stateDir, "database-users")

const RESTORE_LOCK_FILE = "restore.lock"

export type RegisteredDatabaseUser = {
  record: DatabaseUserRecord
  /** 注销登记：正常退出路径调用；进程崩溃留下的陈旧文件由扫描阶段判别。 */
  unregister: () => void
}

/**
 * 登记一个数据库使用者。
 *
 * 登记时立刻取一次进程启动时间快照：取不到（进程不存在或探测失效）说明
 * 归属无法建立，直接抛错，不留一条无法验证的记录。
 */
export const registerDatabaseUser = (
  role: DatabaseUserRole,
  options: MaintenanceContext & { pid?: number } = {}
): RegisteredDatabaseUser => {
  const stateDir = resolveStateDir(options)
  const probe = resolveProbe(options)
  const pid = options.pid ?? process.pid
  const startedAt = probe(pid)
  if (startedAt === null) {
    throw new Error(`无法登记数据库使用者：进程 ${pid} 的归属无法确认`)
  }
  const record: DatabaseUserRecord = {
    pid,
    pidStartedAt: startedAt,
    token: randomBytes(8).toString("hex"),
    role,
    registeredAt: Date.now(),
  }
  const directory = usersDirectory(stateDir)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = path.join(directory, `${pid}-${record.token}.json`)
  writeFileSync(file, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  return {
    record,
    unregister: () => {
      rmSync(file, { force: true })
    },
  }
}

export type DatabaseUserScan = {
  /** 归属可证且进程仍在：这些使用者存在时禁止恢复。 */
  active: DatabaseUserRecord[]
  /** 已证退出或 PID 被复用的陈旧记录：不再阻塞恢复。 */
  stale: DatabaseUserRecord[]
  /** 有记录读不懂或探测失效：无法证明使用者已退出，调用方必须 fail-closed。 */
  unverifiable: boolean
}

/**
 * 扫描使用者登记。
 *
 * 每条记录都用「当前启动时间 == 注册快照」复验归属；探测抛错与记录损坏
 * 都计入 unverifiable，宁可拒绝恢复也不误判成没有使用者。
 */
export const scanDatabaseUsers = (
  context?: MaintenanceContext
): DatabaseUserScan => {
  const stateDir = resolveStateDir(context)
  const probe = resolveProbe(context)
  const directory = usersDirectory(stateDir)
  const scan: DatabaseUserScan = { active: [], stale: [], unverifiable: false }
  if (!existsSync(directory)) return scan
  let names: string[]
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".json"))
  } catch {
    // 目录读不懂：无法确认还有没有使用者在场，按无法证明处理。
    scan.unverifiable = true
    return scan
  }
  for (const name of names) {
    const file = path.join(directory, name)
    let record: DatabaseUserRecord | null = null
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as DatabaseUserRecord).pid === "number" &&
        typeof (parsed as DatabaseUserRecord).pidStartedAt === "string"
      ) {
        record = parsed as DatabaseUserRecord
      }
    } catch {
      record = null
    }
    if (record === null) {
      // 记录损坏：不知道是谁、是否还活着，不能当成已退出。
      scan.unverifiable = true
      continue
    }
    try {
      const startedAt = probe(record.pid)
      if (startedAt !== null && startedAt === record.pidStartedAt) {
        scan.active.push(record)
      } else {
        scan.stale.push(record)
      }
    } catch {
      scan.unverifiable = true
    }
  }
  return scan
}

export type RestoreLockRecord = {
  pid: number
  pidStartedAt: string
  token: string
  acquiredAt: number
}

export type RestoreLockState = {
  /** 锁文件不存在时为 null。 */
  record: RestoreLockRecord | null
  /** 文件存在但读不懂：不能假设无人持有，更不能清锁。 */
  corrupt: boolean
  /** 持有者归属可证且仍存活。 */
  holderAlive: boolean
  /** 无法证明持有者是否已退出（探测失效）。 */
  unverifiable: boolean
}

/** 读恢复锁状态；锁文件缺失返回 record=null。 */
export const readRestoreLock = (
  context?: MaintenanceContext
): RestoreLockState => {
  const file = path.join(resolveStateDir(context), RESTORE_LOCK_FILE)
  const state: RestoreLockState = {
    record: null,
    corrupt: false,
    holderAlive: false,
    unverifiable: false,
  }
  if (!existsSync(file)) return state
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    state.corrupt = true
    return state
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as RestoreLockRecord).pid !== "number" ||
    typeof (parsed as RestoreLockRecord).pidStartedAt !== "string" ||
    typeof (parsed as RestoreLockRecord).token !== "string"
  ) {
    state.corrupt = true
    return state
  }
  state.record = parsed as RestoreLockRecord
  try {
    const startedAt = resolveProbe(context)(state.record.pid)
    state.holderAlive =
      startedAt !== null && startedAt === state.record.pidStartedAt
  } catch {
    state.unverifiable = true
  }
  return state
}

const lockFilePath = (stateDir: string): string =>
  path.join(stateDir, RESTORE_LOCK_FILE)

/**
 * 取得排他恢复锁。
 *
 * 只有「锁不存在」或「锁的持有者已证退出（陈旧）」两种情况能拿到锁；
 * 锁损坏或归属无法证明时抛错，不清锁、不强行恢复。
 */
export const acquireRestoreLock = (
  context?: MaintenanceContext
): RestoreLockRecord => {
  const stateDir = resolveStateDir(context)
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const probe = resolveProbe(context)
  const file = lockFilePath(stateDir)
  let myStartedAt: string | null
  try {
    myStartedAt = probe(process.pid)
  } catch (error) {
    throw new Error(
      `无法取得恢复锁：本进程归属无法确认（${error instanceof Error ? error.message : String(error)}）`
    )
  }
  if (myStartedAt === null) {
    throw new Error("无法取得恢复锁：本进程归属无法确认")
  }
  const record: RestoreLockRecord = {
    pid: process.pid,
    pidStartedAt: myStartedAt,
    token: randomBytes(8).toString("hex"),
    acquiredAt: Date.now(),
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!existsSync(file)) {
      try {
        writeFileSync(file, `${JSON.stringify(record)}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        })
        return record
      } catch (error) {
        // 创建竞争：别的进程抢先，重新读锁再判断。
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue
        throw new Error(
          `无法写入恢复锁：${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    const state = readRestoreLock(context)
    if (state.corrupt) {
      throw new Error("恢复锁已损坏，无法确认持有者；不清理锁，请人工检查")
    }
    if (state.unverifiable) {
      throw new Error("恢复锁持有者归属无法验证；不清理锁，等待下次启动重试")
    }
    if (state.holderAlive && state.record !== null) {
      throw new Error(
        `恢复锁正被进程 ${state.record.pid} 持有；不重复取得，稍后重试`
      )
    }
    // 持有者已证退出：这是可安全清理的陈旧锁。
    try {
      unlinkSync(file)
    } catch {
      // 删不掉就重读一轮，避免误判。
    }
  }
  throw new Error("无法取得恢复锁：多次竞争未成功，稍后重试")
}

/** 释放自己持有的恢复锁；token 对不上说明锁已易主，不误删。 */
export const releaseRestoreLock = (
  record: RestoreLockRecord,
  context?: MaintenanceContext
): void => {
  const file = lockFilePath(resolveStateDir(context))
  if (!existsSync(file)) return
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as RestoreLockRecord
    if (parsed.token !== record.token) return
  } catch {
    return
  }
  rmSync(file, { force: true })
}

/**
 * 屏障检查：存在活跃的恢复锁时拒绝碰数据库。
 *
 * 查询、写入、校验与任务子进程在启动任何数据库工作前调用；锁损坏或无法
 * 验证同样拒绝（fail-closed）。本进程自己在恢复执行期间也不放行。
 */
export const assertRestoreBarrierOpen = (
  context?: MaintenanceContext
): void => {
  const state = readRestoreLock(context)
  if (state.record === null && !state.corrupt) return
  if (state.corrupt) {
    throw new Error("恢复锁已损坏，数据库暂不可用；请人工检查维护状态目录")
  }
  throw new Error(
    `数据库正在恢复（锁持有进程 ${state.record?.pid ?? "未知"}），请稍后重试`
  )
}

export type WaitForUsersOptions = MaintenanceContext & {
  /** 等待上限；到点仍有人就返回 ok=false，由调用方拒绝恢复。 */
  timeoutMs: number
  pollMs?: number
}

export type WaitForUsersResult = {
  ok: boolean
  scan: DatabaseUserScan
  waitedMs: number
}

/**
 * 等待所有已登记使用者退出，有期限。
 *
 * 无法证明使用者已退出时同样等到超时（ok=false），由调用方拒绝恢复；
 * 这里不杀进程、不发信号，只观察。
 */
export const waitForDatabaseUsersExit = async (
  options: WaitForUsersOptions
): Promise<WaitForUsersResult> => {
  const pollMs = options.pollMs ?? 200
  const startedAt = Date.now()
  let scan = scanDatabaseUsers(options)
  for (;;) {
    if (!scan.unverifiable && scan.active.length === 0) {
      return { ok: true, scan, waitedMs: Date.now() - startedAt }
    }
    if (Date.now() - startedAt >= options.timeoutMs) {
      return { ok: false, scan, waitedMs: Date.now() - startedAt }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    scan = scanDatabaseUsers(options)
  }
}

export type StartupBarrierOptions<T> = MaintenanceContext & {
  /** 是否有需要恢复的工作；由入口注入，公共层不读业务域的计划文件。 */
  hasPendingWork: () => boolean
  /** 恢复执行；由入口注入，公共层不依赖 database 域。 */
  executeRestore: () => Promise<T>
  /** 等待既有使用者退出的上限。 */
  waitTimeoutMs?: number
}

/**
 * 启动维护屏障：在任何业务连接创建之前调用。
 *
 * 没有待办直接放行；有待办但仍有使用者在场时先等（有期限），等不到就
 * 放行且不执行恢复——存在计划不等于让运行中的服务立刻暂停，恢复必须
 * 等到所有已登记使用者退出，且绝不杀进程、不重启服务。
 */
export const runStartupMaintenanceBarrier = async <T>(
  options: StartupBarrierOptions<T>
): Promise<T | null> => {
  if (!options.hasPendingWork()) return null
  const waitTimeoutMs = options.waitTimeoutMs ?? 30_000
  const wait = await waitForDatabaseUsersExit({
    ...options,
    timeoutMs: waitTimeoutMs,
  })
  if (!wait.ok) {
    const reason = wait.scan.unverifiable
      ? "无法证明数据库使用者已全部退出"
      : `仍有 ${wait.scan.active.length} 个数据库使用者在运行`
    console.warn(
      `[mac-manager] 暂不执行数据库恢复：${reason}，等待 ${wait.waitedMs} 毫秒后放弃本次恢复，计划留待下次启动`
    )
    return null
  }
  if (wait.waitedMs > 0) {
    console.warn(
      `[mac-manager] 已等待 ${wait.waitedMs} 毫秒，数据库使用者全部退出，开始执行恢复`
    )
  }
  return await options.executeRestore()
}
