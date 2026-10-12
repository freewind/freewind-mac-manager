import { Add01Icon, RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type {
  DatabaseRecord,
  DatabaseTable,
  SqliteWritableValue,
} from "@shared/api-contract"
import { describeError } from "@shared/format"
import { useQueryClient } from "@tanstack/react-query"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Label } from "@web/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import { Skeleton } from "@web/components/ui/skeleton"
import { useEditProtection } from "@web/hooks/use-edit-protection"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { useMemo, useState } from "react"
import { DeleteRecordsDialog, type DeleteTarget } from "./DeleteRecordsDialog"
import {
  emptyRecordForm,
  hasFormChanges,
  type RecordFormState,
  recordFormFromRecord,
} from "./form-values"
import { formatReadAt, formatRecordKey, recordKeyFingerprint } from "./format"
import { databaseKeys } from "./queries"
import { RecordDetails } from "./RecordDetails"
import { RecordFormDialog } from "./RecordFormDialog"
import { RecordList, type RecordListProps } from "./RecordList"
import { TableStructure } from "./TableStructure"
import { DATABASE_OFFLINE_NOTICE, useDatabase } from "./useDatabase"

/** 记录列表需要的数据与动作；表本身由外层按当前选中表传入。 */
type ListModel = Omit<RecordListProps, "table">

type FormDraft = { initial: RecordFormState; current: RecordFormState }

/** 同一时刻只挂载一套对话框；signature 是打开时看到的结构签名。 */
type DialogState =
  | { kind: "insert"; signature: string }
  | { kind: "edit"; record: DatabaseRecord; signature: string }
  | { kind: "delete"; targets: DeleteTarget[]; signature: string }
  | null

/**
 * 数据库浏览与编辑页：选表、看结构、筛选排序分页、看记录详情，以及新增/修改/删除。
 *
 * 这是应用自身 SQLite 的真实内容，页面一直提醒「直接操作底层数据」；
 * 写入全部走 useDatabase 的同步锁动作：失败保留草稿，结果未知只允许重新读取核实。
 */
export const DatabasePage = () => {
  const model = useDatabase()
  const queryClient = useQueryClient()
  const isDesktop = useIsDesktop()
  // 结构在桌面默认展开；手机先收起，避免把记录列表挤出首屏
  const [structureOpen, setStructureOpen] = useState(isDesktop)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [draft, setDraft] = useState<FormDraft | null>(null)
  const [checked, setChecked] = useState<Map<string, DeleteTarget>>(new Map())
  const [pageNotice, setPageNotice] = useState<string | null>(null)

  const tableDetail = model.tableDetail
  const dirty = draft !== null && hasFormChanges(draft.initial, draft.current)
  // 有未保存草稿时阻止 PWA 更新刷新页面（复用公共 hook，不改它）
  useEditProtection(dirty)

  const closeDialog = (): void => {
    setDialog(null)
    setDraft(null)
  }

  const detailsOpen = model.selectedKey !== null
  // 窄屏用 Sheet 展示详情，返回键先关浮层（统一走 useHistoryOverlay）
  useHistoryOverlay(detailsOpen, () => model.selectRecord(null))
  useHistoryOverlay(dialog !== null, closeDialog)

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

  /** 成功后关浮层并清勾选；数据靠失效重新读取，不做乐观隐藏。 */
  const finishAction = (options: { closeDetails?: boolean } = {}): void => {
    setDialog(null)
    setDraft(null)
    setChecked(new Map())
    setPageNotice(null)
    if (options.closeDetails === true) model.selectRecord(null)
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

  /** 切表前先处理未保存草稿，不默默丢弃。 */
  const selectTable = (next: string | null): void => {
    if (dirty) {
      setPageNotice("有未保存的草稿：请先保存或取消，再切换表")
      return
    }
    setDialog(null)
    setDraft(null)
    setChecked(new Map())
    setPageNotice(null)
    model.selectTable(next)
  }

  const detailsFor = (table: DatabaseTable) => (
    <RecordDetails
      table={table}
      record={model.recordDetail}
      pending={model.recordPending}
      error={model.recordError}
      canEdit={model.online && capabilityHint("update") === null}
      canDelete={model.online && capabilityHint("delete") === null}
      busy={model.busy}
      onEdit={() => {
        if (model.recordDetail !== null) openEdit(model.recordDetail)
      }}
      onDelete={() => {
        if (model.recordDetail !== null) {
          openDelete([
            {
              key: model.recordDetail.key,
              expectedSignature: model.recordDetail.signature,
            },
          ])
        }
      }}
    />
  )

  const list: ListModel = {
    records: model.records,
    total: model.total,
    pending: model.recordsPending,
    error: model.recordsError,
    page: model.page,
    pageSize: model.pageSize,
    filters: model.filters,
    sorts: model.sorts,
    selectedKey: model.selectedKey,
    checkedFingerprints,
    canDelete: model.online && capabilityHint("delete") === null,
    deleteBusy: model.busy,
    onToggleChecked: toggleChecked,
    onClearChecked: () => setChecked(new Map()),
    onRequestDeleteChecked: () => openDelete(checkedTargets),
    onSelectRecord: model.selectRecord,
    onFiltersChange: model.setFilters,
    onSortsChange: model.setSorts,
    onPageChange: model.setPage,
    onPageSizeChange: model.setPageSize,
  }

  const sections = (table: DatabaseTable) => (
    <>
      <Collapsible open={structureOpen} onOpenChange={setStructureOpen}>
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between rounded-md border px-3 text-sm font-medium">
          表结构
          <span className="text-muted-foreground">
            {structureOpen ? "收起" : "展开"}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <TableStructure table={table} />
        </CollapsibleContent>
      </Collapsible>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">记录</CardTitle>
        </CardHeader>
        <CardContent>
          {/* 换表时重挂载：当前页勾选这类本地状态不跨表保留 */}
          <RecordList key={table.name} table={table} {...list} />
        </CardContent>
      </Card>
    </>
  )

  const insertHint = capabilityHint("insert")
  const failureNotice = dialog === null ? model.actionFailure : null

  return (
    <div className="space-y-4 p-4">
      <Alert>
        <AlertTitle>直接操作底层数据</AlertTitle>
        <AlertDescription>
          这里显示的是应用自身 SQLite
          的真实内容：不会做业务校验，也不会自动维护其他域的签名或时间戳。
          外键级联与写触发器可能带来额外影响，改动前请先看清表结构里的标注。
        </AlertDescription>
      </Alert>

      {pageNotice === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>操作被拦住</AlertTitle>
          <AlertDescription>{pageNotice}</AlertDescription>
        </Alert>
      )}

      {failureNotice === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>上一次操作没有完成</AlertTitle>
          <AlertDescription>{failureNotice}</AlertDescription>
        </Alert>
      )}

      {model.unknownNotice === null || dialog !== null ? null : (
        <Alert>
          <AlertTitle>结果未知</AlertTitle>
          <AlertDescription className="space-y-2">
            <span>{model.unknownNotice}</span>
            <span className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="min-h-11"
                onClick={verifyAfterUnknown}
              >
                重新读取核实
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={model.dismissUnknownResult}
              >
                已核对，继续
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="database-table">表</Label>
          <Select
            value={model.table ?? ""}
            onValueChange={(next) => selectTable(next)}
          >
            <SelectTrigger
              id="database-table"
              className="min-h-11 min-w-56"
              disabled={model.tables.length === 0 || dirty}
            >
              <SelectValue placeholder="选择表" />
            </SelectTrigger>
            <SelectContent>
              {model.tables.map((table) => (
                <SelectItem key={table.name} value={table.name}>
                  {table.name}（{table.kind === "view" ? "视图" : "表"}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={refreshAll}
          disabled={model.tablesPending}
        >
          <HugeiconsIcon icon={RefreshIcon} aria-hidden="true" />
          刷新
        </Button>
        <Button
          className="min-h-11"
          onClick={openInsert}
          disabled={
            tableDetail === null || insertHint !== null || !model.online
          }
        >
          <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
          新增记录
        </Button>
        <span className="text-sm text-muted-foreground">
          {model.updatedAt === null
            ? "尚未读取"
            : `最后读取 ${formatReadAt(model.updatedAt)}`}
        </span>
      </div>

      {insertHint === null ? null : (
        <p className="text-sm text-muted-foreground">不能新增：{insertHint}</p>
      )}
      {dirty ? (
        <p className="text-sm text-muted-foreground">
          有未保存的草稿：请先保存或取消，再切换表。
        </p>
      ) : null}

      {model.tablesError !== null && model.tablesError !== undefined ? (
        <Alert variant="destructive">
          <AlertTitle>表列表读取失败</AlertTitle>
          <AlertDescription>
            {describeError(model.tablesError)}
          </AlertDescription>
        </Alert>
      ) : null}

      {model.tablesPending ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : model.tables.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有可管理的表</EmptyTitle>
            <EmptyDescription>
              库里目前没有普通表；新建业务表后点「刷新」即可看到。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {model.table !== null &&
      model.tableError !== null &&
      model.tableError !== undefined ? (
        <Alert variant="destructive">
          <AlertTitle>表结构读取失败</AlertTitle>
          <AlertDescription>{describeError(model.tableError)}</AlertDescription>
        </Alert>
      ) : null}

      {tableDetail === null ? null : isDesktop ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-4">{sections(tableDetail)}</div>
          {detailsOpen ? (
            <aside className="min-w-0">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">记录详情</CardTitle>
                </CardHeader>
                <CardContent>{detailsFor(tableDetail)}</CardContent>
              </Card>
            </aside>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {sections(tableDetail)}
          <Sheet
            open={detailsOpen}
            onOpenChange={(open) => {
              if (!open) model.selectRecord(null)
            }}
          >
            <SheetContent side="right" className="gap-0 p-0 sm:max-w-md">
              <SheetHeader className="gap-1 border-b p-4">
                <SheetTitle>记录详情</SheetTitle>
                <SheetDescription className="break-all font-mono text-xs">
                  {model.table ?? ""}
                  {model.selectedKey === null
                    ? ""
                    : ` ${formatRecordKey(model.selectedKey)}`}
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {detailsFor(tableDetail)}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      )}

      {/* 同一时刻只挂载一套表单 */}
      {dialog?.kind === "insert" && draft !== null && tableDetail !== null ? (
        <RecordFormDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          table={tableDetail}
          record={null}
          initial={draft.initial}
          state={draft.current}
          onChangeColumn={(name, next) =>
            setDraft((previous) =>
              previous === null
                ? previous
                : {
                    ...previous,
                    current: { ...previous.current, [name]: next },
                  }
            )
          }
          busy={model.busy}
          preventOutsideDismiss={dirty}
          failure={model.actionFailure}
          unknownNotice={model.unknownNotice}
          onVerify={verifyAfterUnknown}
          onDismissUnknown={model.dismissUnknownResult}
          onSubmit={(values) => void submitInsert(values)}
        />
      ) : null}

      {dialog?.kind === "edit" && draft !== null && tableDetail !== null ? (
        <RecordFormDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          table={tableDetail}
          record={dialog.record}
          initial={draft.initial}
          state={draft.current}
          onChangeColumn={(name, next) =>
            setDraft((previous) =>
              previous === null
                ? previous
                : {
                    ...previous,
                    current: { ...previous.current, [name]: next },
                  }
            )
          }
          busy={model.busy}
          preventOutsideDismiss={dirty}
          failure={model.actionFailure}
          unknownNotice={model.unknownNotice}
          onVerify={verifyAfterUnknown}
          onDismissUnknown={model.dismissUnknownResult}
          onSubmit={(values) => void submitUpdate(dialog.record, values)}
        />
      ) : null}

      {dialog?.kind === "delete" && tableDetail !== null ? (
        <DeleteRecordsDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          table={tableDetail}
          targets={dialog.targets}
          busy={model.busy}
          failure={model.actionFailure}
          unknownNotice={model.unknownNotice}
          onVerify={verifyAfterUnknown}
          onDismissUnknown={model.dismissUnknownResult}
          onConfirm={() => void submitDelete(dialog.targets)}
        />
      ) : null}
    </div>
  )
}
