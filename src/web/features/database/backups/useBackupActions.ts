import type {
  DatabaseBackup,
  DatabaseRestoreStatus,
} from "@shared/api-contract"
import {
  ApiRequestError,
  cancelDatabaseRestore,
  deleteDatabaseBackups,
  planDatabaseRestore,
} from "@shared/client-api"
import { describeError } from "@shared/format"
import { useQueryClient } from "@tanstack/react-query"
import { usePwaStatus } from "@web/hooks/use-pwa-status"
import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { backupKeys } from "./queries"

/** 删除结果按逐条记录：备份是彼此独立的文件，不做整批回滚。 */
export type BackupDeleteOutcome = {
  deleted: { id: string; fileName: string }[]
  failed: { id: string; fileName: string; message: string }[]
}

export type BackupWriteAction = "delete" | "restore" | "cancel"

/**
 * 结果未知的措辞：请求没有得到可确认的响应时，既不能说成功也不能说失败，
 * 只能让用户重新读取服务端状态核实，并且不自动重发。
 */
const UNKNOWN_NOTICES: Record<BackupWriteAction, string> = {
  delete:
    "删除请求没有得到确认的响应：不确定哪些备份已经删除。请重新读取列表核实，不要直接重复提交。",
  restore:
    "提交恢复计划没有得到确认的响应：不确定计划是否已经建立。请重新读取恢复状态核实，不要重复提交。",
  cancel:
    "取消请求没有得到确认的响应：不确定计划是否还在等待执行。请重新读取恢复状态核实。",
}

export const BACKUP_OFFLINE_NOTICE =
  "当前离线：写操作不会排队，也不会自动补发；联网后请重新确认目标再操作。"

/** 恢复计划提交成功的说法：只说计划建立，绝不说已经恢复。 */
export const RESTORE_PLAN_CREATED_NOTICE = "恢复计划已创建，重启后生效"

export const RESTORE_CANCELLED_NOTICE = "已取消恢复计划：重启不再执行恢复"

/** 服务端稳定错误码：前端据此分支，文案仍以服务端 message 为准。 */
export const backupErrorCode = (error: unknown): string | null => {
  if (!(error instanceof ApiRequestError)) return null
  const body = error.responseBody
  if (typeof body !== "object" || body === null || !("code" in body))
    return null
  const code = (body as { code?: unknown }).code
  return typeof code === "string" ? code : null
}

/**
 * 提交恢复计划时 409 的三种情况分开说：签名不匹配（备份被换过）、已有计划在等、
 * 其余服务端拒绝照实转述。前端不自己判断签名，只展示服务端的裁决。
 */
export const restoreConflictNotice = (
  code: string | null,
  message: string | null
): string => {
  if (code === "signature_mismatch") {
    return `${message ?? "备份内容签名与提交的不一致"}：这份备份在选中之后被改过，没有建立恢复计划。请重新读取列表，看清当前这一份再决定。`
  }
  if (code === "restore_plan_pending") {
    return `${message ?? "已有恢复计划在等待执行"}：这次没有建立新计划。等待执行的计划可以先取消；正在执行的只能等重启完成。`
  }
  return message ?? "提交恢复计划失败"
}

/** 取消恢复计划 409：已经开始执行就撤不回来了。 */
export const RESTORE_CANCEL_BLOCKED_NOTICE =
  "计划已开始执行，无法取消；请等重启完成后重新读取状态核实。"

type WriteOutcome = {
  ok: boolean
  unknown: boolean
  code: string | null
  message: string | null
}

type UseBackupActionsOptions = {
  /** 当前页读到的备份：删除与恢复都以列表当时读到的签名提交。 */
  backups: DatabaseBackup[]
  planStatus: DatabaseRestoreStatus | null
  /** 重新读取列表与恢复状态；写操作之后必须用它核实结果。 */
  refresh: () => Promise<void>
}

/**
 * 备份域的三个危险动作：删除备份、提交恢复计划、取消恢复计划。
 *
 * - 提交时一律带上列表当时读到的 `contentSignature`，服务端再核一次；
 * - 提交之后重新读取服务端状态，不做本地假删、也不假称已恢复；
 * - 结果未知既不当成功也不当失败，只提示重新读取核实，且不自动重试。
 */
export const useBackupActions = (options: UseBackupActionsOptions) => {
  const { backups, planStatus, refresh } = options
  const queryClient = useQueryClient()
  const { online } = usePwaStatus()
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [busy, setBusy] = useState<BackupWriteAction | null>(null)
  const [unknown, setUnknown] = useState<{
    action: BackupWriteAction
    notice: string
  } | null>(null)

  // 删除
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null)
  const [deleteOutcome, setDeleteOutcome] =
    useState<BackupDeleteOutcome | null>(null)

  // 恢复
  const [restoreTarget, setRestoreTarget] = useState<DatabaseBackup | null>(
    null
  )
  const [restoreFailure, setRestoreFailure] = useState<string | null>(null)
  const [backupCurrent, setBackupCurrent] = useState(true)

  // 取消
  const [cancelNotice, setCancelNotice] = useState<string | null>(null)
  const [cancelBlocked, setCancelBlocked] = useState(false)

  const submitting = useRef(false)

  const selected = backups.filter((backup) => selectedIds.includes(backup.id))

  const toggleSelected = (id: string, next: boolean): void => {
    setSelectedIds((previous) =>
      next
        ? previous.includes(id)
          ? previous
          : [...previous, id]
        : previous.filter((item) => item !== id)
    )
  }

  const runWrite = async (
    action: BackupWriteAction,
    run: () => Promise<void>,
    successMessage: string
  ): Promise<WriteOutcome> => {
    // 同步锁：一次只允许一个写操作在途
    if (submitting.current) {
      return { ok: false, unknown: false, code: null, message: null }
    }
    if (!online) {
      setFailure(action, BACKUP_OFFLINE_NOTICE)
      return {
        ok: false,
        unknown: false,
        code: null,
        message: BACKUP_OFFLINE_NOTICE,
      }
    }
    submitting.current = true
    setBusy(action)
    setFailure(action, null)
    try {
      await run()
      setUnknown(null)
      setCancelNotice(null)
      // 动作编排处只触发一次提示；删除不用这条路径（它有逐条结果）
      toast.success(successMessage)
      return { ok: true, unknown: false, code: null, message: null }
    } catch (error) {
      if (error instanceof ApiRequestError && error.resultUnknown) {
        setUnknown({ action, notice: UNKNOWN_NOTICES[action] })
        return { ok: false, unknown: true, code: null, message: null }
      }
      const message = describeError(error)
      setFailure(action, message)
      return {
        ok: false,
        unknown: false,
        code: backupErrorCode(error),
        message,
      }
    } finally {
      submitting.current = false
      setBusy(null)
    }
  }

  const setFailure = (
    action: BackupWriteAction,
    message: string | null
  ): void => {
    if (action === "delete") setDeleteFailure(message)
    else if (action === "restore") setRestoreFailure(message)
    else setCancelNotice(message)
  }

  /** 结果未知之后重新读取：列表与恢复状态都问一遍，以服务端为准。 */
  const verify = useCallback(async (): Promise<void> => {
    await queryClient.refetchQueries({
      queryKey: backupKeys.all,
      type: "active",
    })
  }, [queryClient])

  const confirmDelete = async (): Promise<void> => {
    if (selected.length === 0) return
    const items = selected.map((backup) => ({
      id: backup.id,
      fileName: backup.fileName,
      expectedSignature: backup.contentSignature,
    }))
    const outcome = await runDelete(items)
    if (outcome === null) return
    setDeleteOutcome(outcome)
    setDeleteDialogOpen(false)
    // 失败条目保持选中，方便看清后重新处理；成功的从选中里去掉
    setSelectedIds(outcome.failed.map((item) => item.id))
    if (outcome.failed.length > 0) {
      toast.error(
        `有 ${outcome.failed.length} 份备份没有删除，详见列表上方的说明`
      )
    }
  }

  const runDelete = async (
    items: { id: string; fileName: string; expectedSignature: string }[]
  ): Promise<BackupDeleteOutcome | null> => {
    if (submitting.current) return null
    if (!online) {
      setDeleteFailure(BACKUP_OFFLINE_NOTICE)
      return null
    }
    submitting.current = true
    setBusy("delete")
    setDeleteFailure(null)
    try {
      const result = await deleteDatabaseBackups({
        items: items.map((item) => ({
          id: item.id,
          expectedSignature: item.expectedSignature,
        })),
      })
      setUnknown(null)
      // 服务端才是事实：提交后重新读取列表，不做本地假删
      await refresh()
      const nameOf = (id: string): string =>
        items.find((item) => item.id === id)?.fileName ?? id
      return {
        deleted: result.deleted.map((id) => ({ id, fileName: nameOf(id) })),
        failed: result.failed.map((item) => ({
          id: item.id,
          fileName: nameOf(item.id),
          message: item.message,
        })),
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.resultUnknown) {
        setUnknown({ action: "delete", notice: UNKNOWN_NOTICES.delete })
      } else {
        setDeleteFailure(describeError(error))
      }
      return null
    } finally {
      submitting.current = false
      setBusy(null)
    }
  }

  const confirmRestore = async (): Promise<void> => {
    const target = restoreTarget
    if (target === null) return
    const outcome = await runWrite(
      "restore",
      async () => {
        await planDatabaseRestore({
          backupId: target.id,
          expectedSignature: target.contentSignature,
          backupCurrent,
        })
      },
      RESTORE_PLAN_CREATED_NOTICE
    )
    if (outcome.ok) {
      setRestoreTarget(null)
      await refresh()
      return
    }
    if (!outcome.unknown) {
      setRestoreFailure(restoreConflictNotice(outcome.code, outcome.message))
    }
  }

  const cancelPlan = async (): Promise<void> => {
    const outcome = await runWrite(
      "cancel",
      async () => {
        await cancelDatabaseRestore()
      },
      RESTORE_CANCELLED_NOTICE
    )
    if (outcome.ok) {
      setCancelBlocked(true)
      await refresh()
      return
    }
    if (outcome.code === "restore_not_cancellable") {
      setCancelNotice(RESTORE_CANCEL_BLOCKED_NOTICE)
      setCancelBlocked(true)
      await verify()
    }
  }

  const openRestore = (backup: DatabaseBackup): void => {
    setRestoreTarget(backup)
    setRestoreFailure(null)
    setUnknown(null)
    // 默认先备份当前库：恢复前多一份退路
    setBackupCurrent(true)
  }

  const openDelete = (): void => {
    setDeleteFailure(null)
    setUnknown(null)
    setDeleteDialogOpen(true)
  }

  return {
    // 选中
    selected,
    selectedIds,
    toggleSelected,
    clearSelection: () => setSelectedIds([]),
    selectAll: () => setSelectedIds(backups.map((backup) => backup.id)),

    // 删除
    deleteDialogOpen,
    openDelete,
    setDeleteDialogOpen,
    confirmDelete,
    deleteFailure,
    deleteOutcome,
    dismissDeleteOutcome: () => setDeleteOutcome(null),
    deleteUnknown: unknown?.action === "delete" ? unknown.notice : null,

    // 恢复
    restoreTarget,
    openRestore,
    closeRestore: () => {
      setRestoreTarget(null)
      setRestoreFailure(null)
    },
    confirmRestore,
    restoreFailure,
    backupCurrent,
    setBackupCurrent,
    restoreUnknown: unknown?.action === "restore" ? unknown.notice : null,

    // 取消
    cancelPlan,
    cancelNotice,
    cancelBlocked,
    /** 只有等待执行的计划能取消；已经开始的连入口都不给。 */
    canCancelPlan: planStatus === "planned" && !cancelBlocked,
    cancelUnknown: unknown?.action === "cancel" ? unknown.notice : null,

    busy,
    verify,
    /** 结果未知后用户已核对：清掉提示，允许继续操作。 */
    dismissUnknown: () => setUnknown(null),
  }
}
