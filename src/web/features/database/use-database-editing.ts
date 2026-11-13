import type { DatabaseRecord, SqliteWritableValue } from "@shared/api-contract"
import { useQueryClient } from "@tanstack/react-query"
import type { DeleteTarget } from "@web/features/database/DeleteRecordsDialog"
import {
  emptyRecordForm,
  hasFormChanges,
  type RecordFormState,
  recordFormFromRecord,
} from "@web/features/database/form-values"
import { recordKeyFingerprint } from "@web/features/database/format"
import { databaseKeys } from "@web/features/database/queries"
import {
  DATABASE_OFFLINE_NOTICE,
  type useDatabase,
} from "@web/features/database/useDatabase"
import { useMemo, useState } from "react"

type FormDraft = { initial: RecordFormState; current: RecordFormState }

/** 同一时刻只挂载一套对话框；signature 是打开时看到的结构签名。 */
type DialogState =
  | { kind: "insert"; signature: string }
  | { kind: "edit"; record: DatabaseRecord; signature: string }
  | { kind: "delete"; targets: DeleteTarget[]; signature: string }
  | null

/**
 * 数据库页的编辑会话编排：勾选、表单草稿、弹窗状态与写入提交。
 *
 * 这是应用自身 SQLite 的真实内容，写入全部走 useDatabase 的同步锁动作：
 * 失败保留草稿，结果未知只允许重新读取核实，不做乐观更新。
 */
export const useDatabaseEditing = (model: ReturnType<typeof useDatabase>) => {
  const queryClient = useQueryClient()
  const tableDetail = model.tableDetail
  const [dialog, setDialog] = useState<DialogState>(null)
  const [draft, setDraft] = useState<FormDraft | null>(null)
  const [checked, setChecked] = useState<Map<string, DeleteTarget>>(new Map())
  const [pageNotice, setPageNotice] = useState<string | null>(null)

  const dirty = draft !== null && hasFormChanges(draft.initial, draft.current)

  const capabilityHint = (
    operation: "insert" | "update" | "delete"
  ): string | null => {
    const capability = tableDetail?.capabilities.find(
      (item) => item.operation === operation
    )
    if (!capability || capability.allowed) return null
    return capability.message
  }

  /** 提交前的统一检查：离线、结构过期、表不支持都拒绝。 */
  const blockReason = (
    operation: "insert" | "update" | "delete"
  ): string | null => {
    if (!model.online) return DATABASE_OFFLINE_NOTICE
    if (tableDetail === null) return "表结构还没读取完成，请稍后再试"
    if (dialog !== null && dialog.signature !== tableDetail.signature) {
      return "表结构已变化，请重新读取后再提交"
    }
    return capabilityHint(operation)
  }

  /** 当前页勾选：只认还在列表里的记录，切页后旧勾选不会带着签名乱用。 */
  const checkedFingerprints = useMemo(() => {
    const visible = new Set(
      model.records.map((record) => recordKeyFingerprint(record.key))
    )
    return new Set([...checked.keys()].filter((key) => visible.has(key)))
  }, [checked, model.records])

  const checkedTargets = useMemo(() => {
    const byFingerprint = new Map(
      model.records.map((record) => [recordKeyFingerprint(record.key), record])
    )
    const targets: DeleteTarget[] = []
    for (const fingerprint of checkedFingerprints) {
      const record = byFingerprint.get(fingerprint)
      if (record) {
        targets.push({
          key: record.key,
          expectedSignature: record.signature,
        })
      }
    }
    return targets
  }, [checkedFingerprints, model.records])

  const toggleChecked = (record: DatabaseRecord, checkedNow: boolean): void => {
    setChecked((previous) => {
      const next = new Map(previous)
      const fingerprint = recordKeyFingerprint(record.key)
      if (checkedNow) {
        next.set(fingerprint, {
          key: record.key,
          expectedSignature: record.signature,
        })
      } else {
        next.delete(fingerprint)
      }
      return next
    })
  }

  const openInsert = (): void => {
    if (tableDetail === null) return
    setPageNotice(null)
    const initial = emptyRecordForm(tableDetail)
    setDraft({ initial, current: initial })
    setDialog({ kind: "insert", signature: tableDetail.signature })
  }

  const openEdit = (record: DatabaseRecord): void => {
    if (tableDetail === null) return
    setPageNotice(null)
    const initial = recordFormFromRecord(tableDetail, record)
    setDraft({ initial, current: initial })
    setDialog({ kind: "edit", record, signature: tableDetail.signature })
  }

  const openDelete = (targets: DeleteTarget[]): void => {
    if (tableDetail === null || targets.length === 0) return
    setPageNotice(null)
    setDraft(null)
    setDialog({ kind: "delete", targets, signature: tableDetail.signature })
  }

  const closeDialog = (): void => {
    setDialog(null)
    setDraft(null)
  }

  /** 成功后关浮层并清勾选；数据靠失效重新读取，不做乐观隐藏。 */
  const finishAction = (options: { closeDetails?: boolean } = {}): void => {
    setDialog(null)
    setDraft(null)
    setChecked(new Map())
    setPageNotice(null)
    if (options.closeDetails === true) model.selectRecord(null)
  }

  /** 切表/换库前清理编辑现场：不默默丢弃，由调用方先检查 dirty。 */
  const resetEditState = (): void => {
    setDialog(null)
    setDraft(null)
    setChecked(new Map())
    setPageNotice(null)
  }

  const submitInsert = async (
    values: Record<string, SqliteWritableValue>
  ): Promise<void> => {
    const reason = blockReason("insert")
    if (reason !== null) {
      setPageNotice(reason)
      return
    }
    if (await model.createRecord(values)) finishAction()
  }

  const submitUpdate = async (
    record: DatabaseRecord,
    values: Record<string, SqliteWritableValue>
  ): Promise<void> => {
    const reason = blockReason("update")
    if (reason !== null) {
      setPageNotice(reason)
      return
    }
    if (await model.updateRecord(record.key, record.signature, values)) {
      finishAction()
    }
  }

  const submitDelete = async (targets: DeleteTarget[]): Promise<void> => {
    const reason = blockReason("delete")
    if (reason !== null) {
      setPageNotice(reason)
      return
    }
    if (await model.deleteRecords(targets)) {
      finishAction({ closeDetails: true })
    }
  }

  /**
   * 结果未知后只重新读取核实：不重发写入，也不因为看到相似值就宣称成功，
   * 清掉提示由用户显式确认。
   */
  const verifyAfterUnknown = (): void => {
    void queryClient.refetchQueries({
      queryKey: databaseKeys.all,
      type: "active",
    })
  }

  const refreshAll = (): void => {
    void queryClient.refetchQueries({
      queryKey: databaseKeys.all,
      type: "active",
    })
  }

  return {
    dialog,
    draft,
    /** 表单草稿的受控更新：弹窗里逐列改值时用。 */
    setDraftState: setDraft,
    dirty,
    pageNotice,
    setPageNotice,
    checkedFingerprints,
    checkedTargets,
    toggleChecked,
    clearChecked: (): void => setChecked(new Map()),
    capabilityHint,
    openInsert,
    openEdit,
    openDelete,
    closeDialog,
    resetEditState,
    submitInsert,
    submitUpdate,
    submitDelete,
    verifyAfterUnknown,
    refreshAll,
  }
}
