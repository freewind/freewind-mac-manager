import { randomBytes } from "node:crypto"
import { readdirSync, rmSync } from "node:fs"
import path from "node:path"
import type {
  DatabaseBackupErrorCode,
  DatabaseRestorePlan,
} from "@shared/api-contract"
import {
  type BackupContentInspection,
  type BackupManifestEntry,
  findEntry,
  inspectBackupContent,
  loadManifest,
} from "./catalog"
import {
  assertBackupFileInDirectory,
  type BackupFileIdentity,
  backupFilePathOf,
  DatabaseBackupError,
  moveFileAside,
  readTextFileIfExists,
  resolveBackupDirectory,
  resolveBackupStateDirectory,
  sameFileIdentity,
  writeFileAtomic,
} from "./files"

/**
 * 恢复计划：写在数据库之外的旁置原子文件里。
 *
 * 为什么不用 task_record：恢复会整库替换当前数据库，若计划与阶段记录放在
 * 当库里，切换瞬间状态就丢了；旁置文件与库文件分离，恢复前、中、后都能凭
 * 它与文件 hash 判断该续走还是该回退，不盲重放。
 *
 * 状态机（对内）：planning → pending → applying → applied / failed；
 * pending 可 cancelled；任何非终态都可因无法核实转 unknown。
 * 对外映射契约：planning 与 pending 都对应 planned（计划已创建、等待重启）。
 */

export type RestorePlanStatus =
  | "pending"
  | "planning"
  | "applying"
  | "applied"
  | "failed"
  | "cancelled"
  | "unknown"

/** 恢复执行阶段：每个阶段先落回执再动手，崩溃后凭它判定进度。 */
export type RestorePlanPhase =
  | "accepted"
  | "safety_backup"
  | "prepare"
  | "acquire_lock"
  | "verify_users"
  | "switching"
  | "verify"
  | "completed"

export type RestorePlanReceipt = {
  phase: RestorePlanPhase
  at: number
  detail: string
}

export type RestorePlanRecord = {
  id: string
  /** 客户端请求标识：同一请求重复提交返回同一计划，不重复创建。 */
  requestId: string | null
  backupId: string
  /** 提交时的文件名；创建过程中尚无文件名时为空串。 */
  backupFileName: string
  /** 提交时核对的内容签名；执行前再核一次，防选中后被替换。 */
  expectedSignature: string
  /** 提交时的文件身份；执行前与现状比对。 */
  backupIdentity: BackupFileIdentity | null
  /** 恢复前是否先生成 pre_restore 安全备份。 */
  backupCurrent: boolean
  status: RestorePlanStatus
  phase: RestorePlanPhase
  message: string
  unknownReason: string | null
  createdAt: number
  updatedAt: number
  /** 阶段回执：按时间追加，崩溃后据此判断走到了哪一步。 */
  receipts: RestorePlanReceipt[]
}

export type RestorePlanFile = {
  version: 1
  plan: RestorePlanRecord | null
}

const PLAN_FILE_NAME = "restore-plan.json"
const RECEIPT_LIMIT = 20

/** 对内状态转移：终态不再变化。 */
const RESTORE_PLAN_TRANSITIONS: Record<
  RestorePlanStatus,
  readonly RestorePlanStatus[]
> = {
  planning: ["pending", "failed", "unknown"],
  pending: ["applying", "cancelled", "unknown"],
  applying: ["applied", "failed", "unknown"],
  applied: [],
  failed: [],
  cancelled: [],
  unknown: [],
}

export const canTransitionRestorePlan = (
  from: RestorePlanStatus,
  to: RestorePlanStatus
): boolean => RESTORE_PLAN_TRANSITIONS[from].includes(to)

/** 等待执行或正在执行的计划；存在时不接受新计划、不可取消以外的动作。 */
const ACTIVE_STATUSES: readonly RestorePlanStatus[] = [
  "planning",
  "pending",
  "applying",
]

export type RestorePlanContext = {
  stateDir?: string
  backupDir?: string
}

const planFilePath = (context?: RestorePlanContext): string =>
  path.join(resolveBackupStateDirectory(context?.stateDir), PLAN_FILE_NAME)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readPlanRecord = (value: unknown): RestorePlanRecord | null => {
  if (!isRecord(value)) return null
  const {
    id,
    requestId,
    backupId,
    backupFileName,
    expectedSignature,
    backupIdentity,
    backupCurrent,
    status,
    phase,
    message,
    unknownReason,
    createdAt,
    updatedAt,
    receipts,
  } = value
  if (
    typeof id !== "string" ||
    typeof backupId !== "string" ||
    typeof backupFileName !== "string" ||
    typeof expectedSignature !== "string" ||
    typeof backupCurrent !== "boolean" ||
    typeof status !== "string" ||
    !(status in RESTORE_PLAN_TRANSITIONS) ||
    typeof phase !== "string" ||
    typeof message !== "string" ||
    typeof createdAt !== "number" ||
    typeof updatedAt !== "number" ||
    !Array.isArray(receipts)
  ) {
    return null
  }
  return {
    id,
    requestId: typeof requestId === "string" ? requestId : null,
    backupId,
    backupFileName,
    expectedSignature,
    backupIdentity: readIdentity(backupIdentity),
    backupCurrent,
    status: status as RestorePlanStatus,
    phase: phase as RestorePlanPhase,
    message,
    unknownReason: typeof unknownReason === "string" ? unknownReason : null,
    createdAt,
    updatedAt,
    receipts: receipts.filter(isReceipt),
  }
}

/** 回执条目收窄：结构对得上才认，phase 字面量由调用方类型约束。 */
const isReceipt = (value: unknown): value is RestorePlanReceipt => {
  if (!isRecord(value)) return false
  return (
    typeof value.phase === "string" &&
    typeof value.at === "number" &&
    typeof value.detail === "string"
  )
}

const readIdentity = (value: unknown): BackupFileIdentity | null => {
  if (!isRecord(value)) return null
  const { ino, size, mtimeMs } = value
  if (
    typeof ino !== "number" ||
    typeof size !== "number" ||
    typeof mtimeMs !== "number"
  ) {
    return null
  }
  return { ino, size, mtimeMs }
}

export type RestorePlanRead = {
  plan: RestorePlanRecord | null
  /** 文件存在但读不懂：调用方必须当作无法判定处理，不猜内容。 */
  corrupt: boolean
}

/** 读计划文件；缺失返回空计划，损坏挪走留证并如实报告。 */
export const readRestorePlan = (
  context?: RestorePlanContext
): RestorePlanRead => {
  const file = planFilePath(context)
  const text = readTextFileIfExists(file)
  if (text === null) {
    // 文件缺失时也检查有没有挪走的损坏留证：有就持续报告，
    // 直到人工处理，不把损坏悄悄当成「没有计划」。
    const directory = resolveBackupStateDirectory(context?.stateDir)
    try {
      const aside = readdirSync(directory).some((name) =>
        name.startsWith(`${PLAN_FILE_NAME}.corrupt-`)
      )
      if (aside) return { plan: null, corrupt: true }
    } catch {
      // 目录不存在：从未有过计划。
    }
    return { plan: null, corrupt: false }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    moveFileAside(file, "corrupt")
    return { plan: null, corrupt: true }
  }
  if (!isRecord(parsed) || !("plan" in parsed)) {
    moveFileAside(file, "corrupt")
    return { plan: null, corrupt: true }
  }
  if (parsed.plan === null) return { plan: null, corrupt: false }
  const plan = readPlanRecord(parsed.plan)
  if (plan === null) {
    moveFileAside(file, "corrupt")
    return { plan: null, corrupt: true }
  }
  return { plan, corrupt: false }
}

const writePlan = (
  plan: RestorePlanRecord | null,
  context?: RestorePlanContext
): void => {
  const file = planFilePath(context)
  const payload: RestorePlanFile = { version: 1, plan }
  writeFileAtomic(file, `${JSON.stringify(payload, null, 2)}\n`, 0o600)
}

const appendReceipt = (
  plan: RestorePlanRecord,
  phase: RestorePlanPhase,
  detail: string
): RestorePlanReceipt[] => {
  const next = [...plan.receipts, { phase, at: Date.now(), detail }]
  // 回执只用于判定进度，条数封顶，避免长期运行无限增长。
  return next.length > RECEIPT_LIMIT
    ? next.slice(next.length - RECEIPT_LIMIT)
    : next
}

/**
 * 迁移计划状态并落盘；转移不合法直接抛错，避免把终态改回执行态。
 */
export const transitionRestorePlan = (
  to: RestorePlanStatus,
  options: {
    phase?: RestorePlanPhase
    message: string
    unknownReason?: string | null
    context?: RestorePlanContext
  }
): RestorePlanRecord => {
  const read = readRestorePlan(options.context)
  const plan = read.plan
  if (plan === null) {
    throw new DatabaseBackupError("backup_not_found", "没有可更新的恢复计划")
  }
  if (plan.status !== to && !canTransitionRestorePlan(plan.status, to)) {
    throw new DatabaseBackupError(
      "backup_invalid",
      `恢复计划状态不能从 ${plan.status} 变为 ${to}`
    )
  }
  const phase = options.phase ?? plan.phase
  const updated: RestorePlanRecord = {
    ...plan,
    status: to,
    phase,
    message: options.message.slice(0, 300),
    unknownReason:
      to === "unknown"
        ? (options.unknownReason ?? "结果未知，需重新读取确认").slice(0, 200)
        : null,
    updatedAt: Date.now(),
    receipts:
      options.phase === undefined && options.message === plan.message
        ? plan.receipts
        : appendReceipt(plan, phase, options.message),
  }
  writePlan(updated, options.context)
  return updated
}

export type VerifyRestoreSourceResult =
  | {
      ok: true
      entry: BackupManifestEntry
      file: string
      sizeBytes: number
    }
  | {
      ok: false
      code: DatabaseBackupErrorCode
      reason: string
      /** true：读不懂、判断不了；调用方应停下报告而不是猜。 */
      unverifiable: boolean
    }

/**
 * 恢复来源核验：身份、内容签名、完整性与应用兼容性。
 *
 * 兼容性只按可验证的必要结构判断（缺应用必要表即明确不兼容）；结构读不出来
 * 就如实报 unverifiable，由调用方停下报告，不猜未来 schema 是否兼容。
 */
export const verifyRestoreSource = (options: {
  backupId: string
  expectedSignature: string
  context?: RestorePlanContext
}): VerifyRestoreSourceResult => {
  const dir = resolveBackupDirectory(options.context?.backupDir)
  const entry = findEntry(loadManifest(dir), options.backupId)
  if (entry === null || entry.status !== "published") {
    return {
      ok: false,
      code: "backup_not_found",
      reason: "备份不存在或尚未完成发布",
      unverifiable: false,
    }
  }
  if (entry.contentSignature !== options.expectedSignature) {
    return {
      ok: false,
      code: "signature_mismatch",
      reason: "备份内容签名与计划不一致，可能已被替换",
      unverifiable: false,
    }
  }
  let file: string
  try {
    file = backupFilePathOf(dir, entry.fileName)
  } catch (error) {
    return {
      ok: false,
      code: "backup_invalid",
      reason: error instanceof Error ? error.message : "备份路径不可用",
      unverifiable: false,
    }
  }
  let current: BackupFileIdentity
  try {
    current = assertBackupFileInDirectory(dir, file)
  } catch (error) {
    return {
      ok: false,
      code: "backup_invalid",
      reason: error instanceof Error ? error.message : "备份文件不可读",
      unverifiable: false,
    }
  }
  if (entry.identity === null || !sameFileIdentity(entry.identity, current)) {
    return {
      ok: false,
      code: "backup_invalid",
      reason: "备份文件在发布后被改动，拒绝用于恢复",
      unverifiable: false,
    }
  }
  let inspection: BackupContentInspection
  try {
    inspection = inspectBackupContent(file)
  } catch (error) {
    return {
      ok: false,
      code: "backup_invalid",
      reason: `无法读取备份内容：${error instanceof Error ? error.message : String(error)}`,
      unverifiable: true,
    }
  }
  if (!inspection.integrity.ok) {
    return {
      ok: false,
      code: "backup_invalid",
      reason: `备份完整性校验未通过：${inspection.integrity.reason}`,
      unverifiable: false,
    }
  }
  if (inspection.restoreBlockedReason !== null) {
    return {
      ok: false,
      code: "unsupported_format",
      reason: inspection.restoreBlockedReason,
      unverifiable: false,
    }
  }
  if (inspection.structureSignature === null) {
    return {
      ok: false,
      code: "backup_invalid",
      reason: "无法读取备份结构，无法判断与当前安装的兼容性",
      unverifiable: true,
    }
  }
  return { ok: true, entry, file, sizeBytes: current.size }
}

export type SubmitRestorePlanInput = {
  backupId: string
  /** 提交时核对的内容签名（来自契约 body）。 */
  expectedSignature: string
  /** 恢复前是否先生成 pre_restore 安全备份；默认生成。 */
  backupCurrent?: boolean
  /** 请求标识：同 requestId 的重复提交幂等返回同一计划。 */
  requestId?: string | null
}

const newPlanId = (): string => randomBytes(9).toString("base64url")

/**
 * 提交恢复计划。
 *
 * 先落 planning 再校验来源（防崩溃留下不完整结论）：校验通过转 pending；
 * 明确不合格就删掉计划并抛出对应错误码；读不懂则删除计划、报无法判断，
 * 不建立一个自己都不确定的计划。已存在的活动计划（非同 requestId）拒绝
 * 并发提交；终态计划允许被新计划覆盖。
 */
export const submitRestorePlan = (
  input: SubmitRestorePlanInput,
  context?: RestorePlanContext
): RestorePlanRecord => {
  const read = readRestorePlan(context)
  const existing = read.plan
  if (existing !== null && ACTIVE_STATUSES.includes(existing.status)) {
    if (
      input.requestId !== undefined &&
      input.requestId !== null &&
      existing.requestId === input.requestId
    ) {
      // 同一请求重发：幂等返回，去重不重复建计划。
      return existing
    }
    throw new DatabaseBackupError(
      "restore_plan_pending",
      existing.status === "applying"
        ? "恢复正在执行中，不能重复提交"
        : "已有恢复计划在等待执行，请先取消或等它完成"
    )
  }

  // 先拿到合法文件名再落 planning：带文件名入状态机，后续读取不会出现
  // 无法满足契约的空文件名计划。
  const dir = resolveBackupDirectory(context?.backupDir)
  const listed = findEntry(loadManifest(dir), input.backupId)
  if (listed === null || listed.status !== "published") {
    throw new DatabaseBackupError(
      "backup_not_found",
      "备份不存在或尚未完成发布"
    )
  }

  const now = Date.now()
  const plan: RestorePlanRecord = {
    id: newPlanId(),
    requestId: input.requestId ?? null,
    backupId: input.backupId,
    backupFileName: listed.fileName,
    expectedSignature: input.expectedSignature,
    backupIdentity: null,
    backupCurrent: input.backupCurrent ?? true,
    status: "planning",
    phase: "accepted",
    message: "计划已受理，正在校验来源",
    unknownReason: null,
    createdAt: now,
    updatedAt: now,
    receipts: [
      { phase: "accepted", at: now, detail: "计划已受理，正在校验来源" },
    ],
  }
  writePlan(plan, context)

  const verification = verifyRestoreSource({
    backupId: input.backupId,
    expectedSignature: input.expectedSignature,
    context,
  })
  if (!verification.ok) {
    // 计划没有成立：删掉占位，不留下自己都不确定的计划。
    rmSync(planFilePath(context), { force: true })
    if (verification.unverifiable) {
      throw new DatabaseBackupError(
        "backup_invalid",
        `无法确认来源可用，未建立恢复计划：${verification.reason}`
      )
    }
    throw new DatabaseBackupError(verification.code, verification.reason)
  }

  const pending: RestorePlanRecord = {
    ...plan,
    backupFileName: verification.entry.fileName,
    backupIdentity: verification.entry.identity,
    status: "pending",
    phase: "accepted",
    message: "计划已创建，等待重启生效",
    updatedAt: Date.now(),
    receipts: appendReceipt(plan, "accepted", "来源校验通过，计划等待重启生效"),
  }
  writePlan(pending, context)
  return pending
}

/**
 * 取消计划：仅 pending 可取消；执行中（applying）不可取消，
 * 终态按幂等之外的冲突报告。
 */
export const cancelRestorePlan = (
  context?: RestorePlanContext
): RestorePlanRecord => {
  const { plan } = readRestorePlan(context)
  if (plan === null) {
    throw new DatabaseBackupError("backup_not_found", "没有待取消的恢复计划")
  }
  if (plan.status !== "pending") {
    throw new DatabaseBackupError(
      "backup_invalid",
      plan.status === "applying"
        ? "恢复正在执行，不能取消"
        : `计划状态为 ${plan.status}，仅等待执行的计划可以取消`
    )
  }
  return transitionRestorePlan("cancelled", {
    message: "计划已取消，重启不再执行恢复",
    context,
  })
}

/** 启动时是否有需要执行或判定的恢复工作。 */
export const hasPendingRestoreWork = (
  context?: RestorePlanContext
): boolean => {
  const read = readRestorePlan(context)
  // 计划文件损坏也要在启动时介入：先报告再决定，不能当作没有计划。
  if (read.corrupt) return true
  return read.plan !== null && ACTIVE_STATUSES.includes(read.plan.status)
}

/**
 * 被活动计划引用的备份 ID：这些备份在计划执行或取消前不得删除。
 * 终态计划不再引用（来源已经用过或放弃）。
 */
export const referencedBackupIds = (
  context?: RestorePlanContext
): ReadonlySet<string> => {
  const { plan } = readRestorePlan(context)
  if (plan === null || !ACTIVE_STATUSES.includes(plan.status)) {
    return new Set()
  }
  return new Set([plan.backupId])
}

/** 计划对内状态映射为契约状态：planning/pending 都是「等待重启生效」。 */
export const toContractRestorePlan = (
  plan: RestorePlanRecord
): DatabaseRestorePlan => ({
  id: plan.id,
  backupId: plan.backupId,
  backupFileName: plan.backupFileName,
  status:
    plan.status === "planning" || plan.status === "pending"
      ? "planned"
      : (plan.status as DatabaseRestorePlan["status"]),
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
  message: plan.message,
  unknownReason: plan.unknownReason,
})
