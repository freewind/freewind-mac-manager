import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs"
import path from "node:path"
import { backup, DatabaseSync } from "node:sqlite"
import {
  acquireRestoreLock,
  type MaintenanceContext,
  type RestoreLockRecord,
  releaseRestoreLock,
  waitForDatabaseUsersExit,
} from "@server/common/database-maintenance"
import { DATABASE_FILE } from "@server/env"
import type { TaskProgress } from "@shared/api-contract"
import { describeError, formatBytes } from "@shared/format"
import {
  computeContentSignature,
  findEntry,
  inspectBackupContent,
  loadManifest,
} from "./catalog"
import {
  currentFileIdentity,
  freeBytesAt,
  requiredBytesFor,
  resolveBackupDirectory,
  sameFileIdentity,
} from "./files"
import {
  type RestorePlanContext,
  type RestorePlanPhase,
  readRestorePlan,
  transitionRestorePlan,
  verifyRestoreSource,
} from "./restore-plan"
import {
  createDatabaseBackupService,
  makeSelfContained,
  readSourceSize,
} from "./service"

/**
 * 启动前受控恢复：不在运行中替换数据库，而是等下次启动、任何业务连接
 * 创建之前，在排他锁与使用者屏障之内完成一次可回退、可核实的恢复。
 *
 * 顺序（每个阶段先落回执再动手）：
 * 1. 取得跨进程排他锁；
 * 2. 再次核验来源身份、内容签名、完整性与应用兼容性（不猜兼容性，
 *    读不懂就停下报 unknown）；
 * 3. 按计划把当前库原生备份为 pre_restore 安全备份并校验持久化；
 * 4. 用原生 backup 从选中备份生成恢复临时库，校验结构一致，并把临时库
 *    里仍处于运行状态的任务标成结果未知（绝不重启执行）；
 * 5. 确认所有已登记数据库使用者都已退出（不杀进程，有期限，等不到拒绝）；
 * 6. 把旧主库连同旧 WAL/SHM 一起留存为回退资料，原子切换新主库——先移
 *    走旧 WAL/SHM 再换主库，绝不让遗留的旧 WAL 作用到新主库；
 * 7. 核实新主库（完整性 + 结构签名与来源一致）后持久化 applied 回执，
 *    此后入口才允许创建业务连接与执行既有受控启动迁移。
 *
 * 崩溃恢复：凭计划里的持久化阶段与文件 hash（身份、结构签名、回执记录的
 * 路径）判断当前走到了哪一步，能证明就幂等续走，不能证明就回退到旧库或
 * 报 unknown，不盲重放任何有副作用的步骤。
 */

/** 恢复全程上限：GB 级安全备份与临时库生成都在其内，不沿用查询的 5 秒。 */
export const RESTORE_TOTAL_TIMEOUT_MS = 30 * 60 * 1000
/** 等待数据库使用者退出的默认上限；到点仍有人就拒绝恢复。 */
export const RESTORE_WAIT_USERS_TIMEOUT_MS = 30_000

export type RestoreRunOptions = {
  stateDir?: string
  backupDir?: string
  /** 当前应用库；默认 env.DATABASE_FILE，测试注入临时库。 */
  databaseFile?: string
  report?: (progress: TaskProgress) => void
  /** 等待使用者退出的上限。 */
  waitTimeoutMs?: number
  /** 原生 backup 每步页数。 */
  pageBatch?: number
  freeBytes?: (dir: string) => number
  /** 进程归属探测与维护上下文透传（测试注入）。 */
  probe?: MaintenanceContext["probe"]
  now?: () => number
}

export type RestoreOutcome =
  | { status: "skipped"; reason: string }
  | {
      status: "applied"
      planId: string
      backupId: string
      safetyBackupId: string | null
      message: string
    }
  | {
      status: "failed"
      planId: string | null
      phase: RestorePlanPhase
      message: string
    }
  | {
      status: "unknown"
      planId: string | null
      phase: RestorePlanPhase
      message: string
    }

type RestorePaths = {
  databaseFile: string
  /** 恢复临时库：与主库同目录，保证 rename 同盘原子。 */
  tempFile: string
}

/** 切换前先落盘的路径记录：崩溃后凭它判断文件该在哪。 */
type SwitchDetail = {
  old: string
  kept: string
  temp: string
}

const parseSwitchDetail = (detail: string): SwitchDetail | null => {
  const parts = Object.fromEntries(
    detail
      .split(";")
      .map((item) => item.split("="))
      .filter((pair) => pair.length === 2)
      .map(([key, value]) => [key, value])
  )
  if (
    typeof parts.old === "string" &&
    typeof parts.kept === "string" &&
    typeof parts.temp === "string"
  ) {
    return { old: parts.old, kept: parts.kept, temp: parts.temp }
  }
  return null
}

/** 回执里最近一条带指定前缀的 detail 值。 */
const findReceiptDetail = (
  receipts: { phase: RestorePlanPhase; detail: string }[],
  phase: RestorePlanPhase,
  prefix: string
): string | null => {
  for (let index = receipts.length - 1; index >= 0; index--) {
    const item = receipts[index]
    if (item.phase !== phase) continue
    if (item.detail.startsWith(prefix)) return item.detail
  }
  return null
}

/**
 * 切换阶段的文件组合判定（kept 是回执里记录的留存路径）：
 * - continue：可证明安全，继续执行剩余的原子 rename；
 * - completed：主库位已是新库（temp 已放行、旧库已留存），进入核实；
 * - unverifiable：文件组合无法解释，停下报 unknown，不猜。
 */
const decideSwitch = (paths: {
  old: string
  kept: string
  temp: string
}): "continue" | "completed" | "unverifiable" => {
  const old = existsSync(paths.old)
  const kept = existsSync(paths.kept)
  const temp = existsSync(paths.temp)
  // 切换未开始：旧库与临时库都在，留存还没发生。
  if (old && temp && !kept) return "continue"
  // 切换中段：旧库已留存，只差把临时库放到主库位置。
  if (!old && temp && kept) return "continue"
  // 切换已完成：主库位是新库、临时库已放行、旧库在留存位。
  if (old && !temp && kept) return "completed"
  return "unverifiable"
}

/** 只读核实一个 SQLite 文件的结构签名；读不懂返回 null，不执行文件内 SQL。 */
const structureSignatureOf = (file: string): string | null => {
  try {
    const inspection = inspectBackupContent(file)
    return inspection.integrity.ok ? inspection.structureSignature : null
  } catch {
    return null
  }
}

/**
 * 把恢复临时库里未完成的任务标成结果未知。
 * 恢复是替换库内容，不触发任务动作，也绝不让这些任务重启执行。
 */
const markTasksInterrupted = (
  file: string,
  updatedAtSeconds: number
): number => {
  const database = new DatabaseSync(file)
  try {
    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_record'"
      )
      .get()
    if (table === undefined) return 0
    const result = database
      .prepare(
        `UPDATE task_record
         SET status = 'unknown',
             result = NULL,
             message = NULL,
             error = '恢复执行前任务尚未完成，结果未知，不自动重做',
             finished_at = ?,
             updated_at = ?
         WHERE status = 'running'`
      )
      .run(updatedAtSeconds, updatedAtSeconds)
    return Number(result.changes)
  } finally {
    database.close()
  }
}

export const runPendingRestore = async (
  options: RestoreRunOptions = {}
): Promise<RestoreOutcome> => {
  const context: RestorePlanContext = {
    stateDir: options.stateDir,
    backupDir: options.backupDir,
  }
  const maintenance: MaintenanceContext = {
    stateDir: options.stateDir,
    probe: options.probe,
  }
  const databaseFile = options.databaseFile ?? DATABASE_FILE
  const backupDir = resolveBackupDirectory(options.backupDir)
  const freeBytes = options.freeBytes ?? freeBytesAt
  const now = options.now ?? ((): number => Date.now())
  const startedAt = Date.now()
  const report = (progress: TaskProgress): void => options.report?.(progress)

  const ensureWithinDeadline = (): void => {
    if (Date.now() - startedAt > RESTORE_TOTAL_TIMEOUT_MS) {
      throw new Error("恢复全程超过时限，已停止；旧库与安全备份保持原状")
    }
  }

  // —— 读计划，决定本次要不要恢复 ——
  const read = readRestorePlan(context)
  if (read.corrupt) {
    const message = "恢复计划文件损坏，无法判定恢复进度，已停下报告"
    console.warn(`[mac-manager] ${message}；不执行恢复，也不清理计划文件`)
    return { status: "unknown", planId: null, phase: "accepted", message }
  }
  const plan = read.plan
  if (plan === null) {
    return { status: "skipped", reason: "没有待执行的恢复计划" }
  }
  if (
    plan.status === "applied" ||
    plan.status === "failed" ||
    plan.status === "cancelled" ||
    plan.status === "unknown"
  ) {
    return { status: "skipped", reason: `计划已${plan.status}，不重复执行` }
  }
  if (plan.status === "planning") {
    // 计划创建中途崩溃：来源没有完成校验，不能凭它恢复。
    transitionRestorePlan("unknown", {
      message: "计划创建过程中断，来源未完成校验",
      unknownReason: "计划创建过程中断，来源未完成校验",
      context,
    })
    return {
      status: "unknown",
      planId: plan.id,
      phase: "accepted",
      message: "计划创建过程中断，来源未完成校验",
    }
  }

  // 从这里开始状态是 pending 或 applying（上次中断续走）。
  const planId = plan.id
  const paths: RestorePaths = {
    databaseFile,
    tempFile: path.join(path.dirname(databaseFile), `.restore-${planId}.tmp`),
  }
  let lock: RestoreLockRecord | null = null
  // 当前阶段：finally 里据此决定要不要清临时库（切换后它是恢复资料）。
  const stageState: { phase: RestorePlanPhase } = { phase: "accepted" }

  const setStage = async (
    phase: RestorePlanPhase,
    message: string
  ): Promise<void> => {
    ensureWithinDeadline()
    stageState.phase = phase
    transitionRestorePlan("applying", { phase, message, context })
    report({
      stage: message,
      done: 0,
      total: null,
      bytesDone: null,
      bytesTotal: null,
      currentTarget: plan.backupFileName || null,
    })
  }

  const finishUnknown = (
    phase: RestorePlanPhase,
    message: string
  ): RestoreOutcome => {
    try {
      transitionRestorePlan("unknown", {
        phase,
        message,
        unknownReason: message.slice(0, 200),
        context,
      })
    } catch (error) {
      console.warn(`[mac-manager] 恢复状态写入失败：${describeError(error)}`)
    }
    return { status: "unknown", planId, phase, message }
  }

  const finishFailed = (
    phase: RestorePlanPhase,
    message: string
  ): RestoreOutcome => {
    try {
      transitionRestorePlan("failed", { phase, message, context })
    } catch (error) {
      console.warn(`[mac-manager] 恢复状态写入失败：${describeError(error)}`)
    }
    return { status: "failed", planId, phase, message }
  }

  try {
    // pending → applying：此后只允许向终态迁移。
    if (plan.status === "pending") {
      transitionRestorePlan("applying", {
        phase: "accepted",
        message: "恢复开始执行",
        context,
      })
    }

    // 上次已进入切换阶段：跳过空间预检、安全备份与临时库（重）生成——
    // 重建临时库会破坏「主库位是不是新库」的判别依据，续走只按文件组合推进。
    const resumingSwitch = plan.phase === "switching" || plan.phase === "verify"
    let safetyBackupId: string | null = null

    // —— 1. 排他锁 ——
    await setStage("acquire_lock", "取得跨进程排他恢复锁")
    lock = acquireRestoreLock(maintenance)

    // —— 2. 再次核验来源 ——
    await setStage("accepted", "核验恢复来源")
    const verification = verifyRestoreSource({
      backupId: plan.backupId,
      expectedSignature: plan.expectedSignature,
      context,
    })
    if (!verification.ok) {
      if (verification.unverifiable) {
        return finishUnknown("accepted", verification.reason)
      }
      return finishFailed("accepted", verification.reason)
    }
    const entryIdentity = verification.entry.identity
    if (
      plan.backupIdentity !== null &&
      (entryIdentity === null ||
        !sameFileIdentity(plan.backupIdentity, entryIdentity))
    ) {
      return finishFailed(
        "accepted",
        "备份文件与计划提交时的身份不一致，拒绝恢复"
      )
    }
    const sourceFile = verification.file
    if (!resumingSwitch) {
      const sourceSize = readSourceSize(sourceFile)

      // —— 3. 磁盘空间预检（旧库 + 安全备份 + 恢复临时库三份共存）——
      // 旧库已占盘，这里检查新增的两份：安全备份 + 恢复临时库。
      const safetyNeeded = plan.backupCurrent
        ? requiredBytesFor(currentFileIdentity(paths.databaseFile)?.size ?? 0)
        : 0
      const tempNeeded = requiredBytesFor(sourceSize.bytes)
      const available = freeBytes(path.dirname(paths.databaseFile))
      if (available < safetyNeeded + tempNeeded) {
        return finishFailed(
          "accepted",
          `恢复空间不足：需要约 ${formatBytes(safetyNeeded + tempNeeded)}（安全备份与恢复临时库），可用 ${formatBytes(available)}`
        )
      }

      // —— 4. 安全备份：把当前库原生备份为 pre_restore 并校验持久化 ——
      const recordedSafety = findReceiptDetail(
        plan.receipts,
        "safety_backup",
        "safetyBackupId="
      )
      if (recordedSafety !== null) {
        // 上次已做过安全备份：核对它仍在清单里，避免重复生成 GB 级副本。
        const existingId = recordedSafety.slice("safetyBackupId=".length)
        const manifest = loadManifest(backupDir)
        if (existingId !== "" && findEntry(manifest, existingId) !== null) {
          safetyBackupId = existingId
        }
      }
      if (safetyBackupId === null) {
        await setStage(
          "safety_backup",
          plan.backupCurrent
            ? "把当前库备份为恢复前安全备份"
            : "按计划跳过恢复前安全备份"
        )
        if (plan.backupCurrent) {
          const safety = await createDatabaseBackupService({
            backupDir,
            stateDir: options.stateDir,
            sourceFile: paths.databaseFile,
            pageBatch: options.pageBatch,
            freeBytes,
          }).create({ source: "pre_restore", report })
          safetyBackupId = safety.backup.id
          transitionRestorePlan("applying", {
            phase: "safety_backup",
            message: `安全备份已生成：${safety.backup.fileName}`,
            context,
          })
        } else {
          transitionRestorePlan("applying", {
            phase: "safety_backup",
            message: "计划要求不生成安全备份，已跳过",
            context,
          })
        }
      }

      // —— 5. 恢复临时库：原生 backup 生成并校验 ——
      await setStage("prepare", "生成并校验恢复临时库")
      let needBuild = true
      if (existsSync(paths.tempFile)) {
        const existingSignature = structureSignatureOf(paths.tempFile)
        if (existingSignature === verification.entry.structureSignature) {
          // 上次已生成且结构与来源一致：复用，不重复搬 GB 级数据。
          needBuild = false
        } else {
          rmSync(paths.tempFile, { force: true })
        }
      }
      if (needBuild) {
        mkdirSync(path.dirname(paths.tempFile), { recursive: true })
        rmSync(paths.tempFile, { force: true })
        const source = new DatabaseSync(sourceFile, { readOnly: true })
        try {
          const totalPages = await backup(source, paths.tempFile, {
            rate: options.pageBatch ?? 100,
            progress: ({ totalPages: total, remainingPages }) => {
              const pages = Number(total)
              const done = Math.max(0, pages - Number(remainingPages))
              report({
                stage: "生成恢复临时库",
                done,
                total: pages,
                bytesDone: done * sourceSize.pageSize,
                bytesTotal: pages * sourceSize.pageSize,
                currentTarget: path.basename(paths.tempFile),
              })
            },
          })
          const copiedPages = Number(totalPages)
          report({
            stage: "生成恢复临时库",
            done: copiedPages,
            total: copiedPages,
            bytesDone: copiedPages * sourceSize.pageSize,
            bytesTotal: copiedPages * sourceSize.pageSize,
            currentTarget: path.basename(paths.tempFile),
          })
        } finally {
          source.close()
        }
        makeSelfContained(paths.tempFile)
      }

      const tempInspection = inspectBackupContent(paths.tempFile)
      if (!tempInspection.integrity.ok) {
        return finishFailed(
          "prepare",
          `恢复临时库完整性校验未通过：${tempInspection.integrity.reason}`
        )
      }
      if (tempInspection.restoreBlockedReason !== null) {
        return finishUnknown(
          "prepare",
          `无法确认恢复临时库与当前安装兼容：${tempInspection.restoreBlockedReason}`
        )
      }
      if (
        tempInspection.structureSignature !==
        verification.entry.structureSignature
      ) {
        return finishFailed(
          "prepare",
          "恢复临时库的结构与来源备份不一致，拒绝切换"
        )
      }
      const interruptedTasks = markTasksInterrupted(
        paths.tempFile,
        Math.floor(now() / 1000)
      )
      if (interruptedTasks > 0) {
        console.warn(
          `[mac-manager] 恢复临时库中 ${interruptedTasks} 个运行任务已标为结果未知，不自动重做`
        )
      }
    }

    // —— 6. 确认没有活跃的数据库使用者 ——
    await setStage("verify_users", "确认数据库使用者已全部退出")
    const wait = await waitForDatabaseUsersExit({
      ...maintenance,
      timeoutMs: options.waitTimeoutMs ?? RESTORE_WAIT_USERS_TIMEOUT_MS,
    })
    if (!wait.ok) {
      const reason = wait.scan.unverifiable
        ? "无法证明数据库使用者已全部退出"
        : `仍有 ${wait.scan.active.length} 个数据库使用者在运行`
      return finishFailed(
        "verify_users",
        `${reason}；未切换数据库，旧库保持原状`
      )
    }

    // —— 7. 留存旧库（含旧 WAL/SHM）并原子切换 ——
    await setStage("switching", "留存旧库并切换到恢复库")
    // kept 路径优先取上次回执：续走时必须落在同一留存文件上，
    // 否则文件组合会被误判为无法解释。
    const recordedSwitch = findReceiptDetail(plan.receipts, "switching", "old=")
    const parsedSwitch =
      recordedSwitch === null ? null : parseSwitchDetail(recordedSwitch)
    const stamp = new Date(now()).toISOString().replace(/[-:.]/g, "")
    const kept =
      parsedSwitch?.kept ?? `${paths.databaseFile}.pre-restore-${stamp}`
    const switchDetail = `old=${paths.databaseFile};kept=${kept};temp=${paths.tempFile}`
    transitionRestorePlan("applying", {
      phase: "switching",
      message: `切换准备：${switchDetail}`,
      context,
    })

    const oldWal = `${paths.databaseFile}-wal`
    const oldShm = `${paths.databaseFile}-shm`
    const keptWal = `${kept}-wal`
    const keptShm = `${kept}-shm`

    const decision = decideSwitch({
      old: paths.databaseFile,
      kept,
      temp: paths.tempFile,
    })
    if (decision === "unverifiable") {
      return finishUnknown(
        "switching",
        "切换阶段的文件组合无法解释，已停下报告；请人工核对旧库与恢复临时库"
      )
    }
    if (decision === "continue") {
      // 先移走旧 WAL/SHM，再移旧主库，最后放入新库：
      // 任何时刻崩溃，新主库（或即将成为新主库的临时库）都不会遇到旧 WAL。
      if (existsSync(oldWal)) renameSync(oldWal, keptWal)
      if (existsSync(oldShm)) renameSync(oldShm, keptShm)
      if (existsSync(paths.databaseFile)) {
        renameSync(paths.databaseFile, kept)
      }
      if (existsSync(paths.tempFile)) {
        renameSync(paths.tempFile, paths.databaseFile)
      }
    }
    if (existsSync(oldWal) || existsSync(oldShm)) {
      return finishUnknown(
        "switching",
        "切换后仍存在与新主库同名的旧 WAL/SHM，为避免污染已停下报告"
      )
    }

    // —— 8. 核实新主库 ——
    await setStage("verify", "核实恢复结果")
    if (!existsSync(paths.databaseFile)) {
      return finishUnknown(
        "verify",
        "切换后主库文件缺失，无法核实；旧库留存与安全备份均在，请人工处理"
      )
    }
    const finalInspection = inspectBackupContent(paths.databaseFile)
    if (!finalInspection.integrity.ok) {
      // 新库不合格：回退到留存的旧库（含其 WAL/SHM）。
      try {
        rmSync(paths.databaseFile, { force: true })
        if (existsSync(kept)) {
          renameSync(kept, paths.databaseFile)
        }
        if (existsSync(keptWal)) renameSync(keptWal, oldWal)
        if (existsSync(keptShm)) renameSync(keptShm, oldShm)
      } catch (error) {
        return finishUnknown(
          "verify",
          `新库校验失败且回退未完成：${describeError(error)}`
        )
      }
      return finishFailed(
        "verify",
        `恢复后的数据库校验未通过，已回退到原库：${finalInspection.integrity.reason}`
      )
    }
    if (
      finalInspection.structureSignature !==
      verification.entry.structureSignature
    ) {
      try {
        rmSync(paths.databaseFile, { force: true })
        if (existsSync(kept)) {
          renameSync(kept, paths.databaseFile)
        }
        if (existsSync(keptWal)) renameSync(keptWal, oldWal)
        if (existsSync(keptShm)) renameSync(keptShm, oldShm)
      } catch (error) {
        return finishUnknown(
          "verify",
          `恢复结果与来源结构不一致且回退未完成：${describeError(error)}`
        )
      }
      return finishFailed(
        "verify",
        "恢复后的数据库结构与来源不一致，已回退到原库"
      )
    }

    // —— 9. 持久化完成回执 ——
    const contentSignature = await computeContentSignature(paths.databaseFile)
    const applied = transitionRestorePlan("applied", {
      phase: "completed",
      message: `恢复已完成并核实：当前库与 ${plan.backupFileName} 一致${safetyBackupId !== null ? `，原库已备份为安全备份 ${safetyBackupId}` : ""}`,
      context,
    })
    // 只报告数据层结果；整体成功由入口在启动迁移通过后宣布。
    console.warn(
      `[mac-manager] 恢复数据已应用并核实：计划 ${applied.id}，当前库签名 ${contentSignature.slice(0, 16)}；启动迁移通过后才算整体完成`
    )
    return {
      status: "applied",
      planId,
      backupId: plan.backupId,
      safetyBackupId,
      message: applied.message,
    }
  } catch (error) {
    // 意外异常：切换前旧库完好，可明确报失败；切换后文件状态需重新判定。
    if (stageState.phase === "switching" || stageState.phase === "verify") {
      return finishUnknown(
        stageState.phase,
        `恢复在 ${stageState.phase} 阶段异常停下：${describeError(error)}`
      )
    }
    return finishFailed(stageState.phase, `恢复失败：${describeError(error)}`)
  } finally {
    if (lock !== null) {
      releaseRestoreLock(lock, maintenance)
    }
    // 切换尚未开始时临时库只是半成品，失败后清掉腾出空间；
    // 切换开始后它是续走与回退的资料，保留。
    if (
      stageState.phase !== "switching" &&
      stageState.phase !== "verify" &&
      existsSync(paths.tempFile)
    ) {
      rmSync(paths.tempFile, { force: true })
    }
  }
}
