import type {
  DatabaseRecord,
  DatabaseTable,
  SqliteWritableValue,
} from "@shared/api-contract"
import { describeError } from "@shared/format"
import { useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@web/components/PageHeader"
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
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@web/components/ui/combobox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Label } from "@web/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import { Skeleton } from "@web/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import { useEditProtection } from "@web/hooks/use-edit-protection"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { Plus, RefreshCw } from "lucide-react"
import { useMemo, useState } from "react"
import { BackupsPanel } from "./backups/BackupsPanel"
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
import {
  DATABASE_TABS,
  type DatabaseTab,
  useDatabaseTab,
} from "./useDatabaseTab"

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
  const { tab, selectTab } = useDatabaseTab()
  // 表结构默认收起：记录列表才是主体，展开后也不超过固定高度
  const [structureOpen, setStructureOpen] = useState(false)
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
  // 窄屏用 Sheet 展示详情，返回键先关浮层（统一走 useHistoryOverlay）；
  // 桌面详情常驻右列，不占历史栈，否则按返回会莫名清掉选中。
  useHistoryOverlay(!isDesktop && detailsOpen, () => model.selectRecord(null))
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
      // 切换记录时重建字段滚动容器，滚动位置回到顶部
      resetKey={
        model.selectedKey === null
          ? "none"
          : `${model.table ?? ""}:${formatRecordKey(model.selectedKey)}`
      }
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
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-3 text-sm font-medium">
          表结构
          <span className="text-muted-foreground">
            {structureOpen ? "收起" : "展开"}
          </span>
        </CollapsibleTrigger>
        {/* 展开后自己滚，不把记录列表挤没 */}
        <CollapsibleContent className="max-h-64 overflow-auto pt-2">
          <TableStructure table={table} />
        </CollapsibleContent>
      </Collapsible>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle className="text-base">记录</CardTitle>
        </CardHeader>
        {/* 记录卡要能填满列高，列表才拿得到自己的滚动区 */}
        <CardContent className="flex min-h-0 flex-1 flex-col">
          {/* 换表时重挂载：当前页勾选这类本地状态不跨表保留 */}
          <RecordList key={table.name} table={table} {...list} />
        </CardContent>
      </Card>
    </>
  )

  const insertHint = capabilityHint("insert")
  const failureNotice = dialog === null ? model.actionFailure : null

  /**
   * 表选择做成可搜索下拉：表名数量不可预知，宽库动辄几十张表。
   * 选项文本带上「表/视图」，搜索时也按这个文本匹配。
   */
  const tableOptions = model.tables.map((entry) => ({
    value: entry.name,
    label: `${entry.name}（${entry.kind === "view" ? "视图" : "表"}）`,
  }))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 视图标签栏：状态放 URL，刷新与返回都能恢复 */}
      <header className="flex shrink-0 flex-col gap-2 border-b px-4 py-3">
        <PageHeader title="数据库" loading={model.tablesPending} />
        <DatabaseTabNav tab={tab} selectTab={selectTab} />
      </header>

      {tab === "backups" ? (
        // 备份视图自己拥有主体滚动区，不与「数据」的主从布局共用容器
        <BackupsPanel />
      ) : (
        <>
          {/* 固定区：风险提示与表级状态在任何滚动位置都看得见，不折叠隐藏 */}
          <div className="flex shrink-0 flex-col gap-3 px-4 py-3">
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
                    <Button variant="outline" onClick={verifyAfterUnknown}>
                      重新读取核实
                    </Button>
                    <Button
                      variant="ghost"
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
                <Combobox
                  items={tableOptions}
                  itemToStringValue={(item) => item.label}
                  value={
                    tableOptions.find((item) => item.value === model.table) ??
                    null
                  }
                  disabled={model.tables.length === 0 || dirty}
                  onValueChange={(next) => selectTable(next?.value ?? null)}
                >
                  <ComboboxInput
                    id="database-table"
                    className="w-56"
                    placeholder="搜索表"
                    disabled={model.tables.length === 0 || dirty}
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>无匹配表</ComboboxEmpty>
                    <ComboboxList>
                      {(item) => (
                        <ComboboxItem key={item.value} value={item}>
                          {item.label}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
              <Button
                variant="outline"
                onClick={refreshAll}
                disabled={model.tablesPending}
              >
                <RefreshCw aria-hidden="true" />
                刷新
              </Button>
              <Button
                onClick={openInsert}
                disabled={
                  tableDetail === null || insertHint !== null || !model.online
                }
              >
                <Plus aria-hidden="true" />
                新增记录
              </Button>
              <span className="text-sm text-muted-foreground">
                {model.updatedAt === null
                  ? "尚未读取"
                  : `最后读取 ${formatReadAt(model.updatedAt)}`}
              </span>
            </div>

            {insertHint === null ? null : (
              <p className="text-sm text-muted-foreground">
                不能新增：{insertHint}
              </p>
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
                <AlertDescription>
                  {describeError(model.tableError)}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          {tableDetail === null ? null : isDesktop ? (
            /* 桌面：左记录列表、右详情两列等高，各自滚动；断点与 useIsDesktop 对齐 */
            <div className="grid min-h-0 min-w-0 flex-1 gap-4 px-4 pb-3 md:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="flex min-h-0 min-w-0 flex-col gap-4">
                {sections(tableDetail)}
              </div>
              <aside className="flex min-h-0 min-w-0 flex-col">
                <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
                  <CardHeader className="shrink-0 border-b px-4 py-3">
                    <CardTitle className="text-base">记录详情</CardTitle>
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                    {detailsOpen ? (
                      detailsFor(tableDetail)
                    ) : (
                      <Empty className="p-4">
                        <EmptyHeader>
                          <EmptyTitle>还没有选中记录</EmptyTitle>
                          <EmptyDescription>
                            在左侧点某条记录的「详情」，这里显示字段与值。
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </CardContent>
                </Card>
              </aside>
            </div>
          ) : (
            /* 手机：列表占满剩余高度，详情走 Sheet，不上下堆叠 */
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-4 pb-3">
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
                  <div className="flex min-h-0 flex-1 flex-col">
                    {detailsFor(tableDetail)}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          )}
        </>
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

/**
 * 视图导航。
 * 状态放 URL（?tab=backups），刷新、分享与浏览器返回都能恢复；
 * 只认 data/backups，未知值（如 Docker 的分区名）安全回退到数据视图。
 */
const DatabaseTabNav = (props: {
  tab: DatabaseTab
  selectTab: (tab: DatabaseTab) => void
}) => (
  <ToggleGroup
    variant="outline"
    className="flex-wrap"
    value={[props.tab]}
    onValueChange={(values) => {
      const next = values[0]
      if (next) props.selectTab(next as DatabaseTab)
    }}
  >
    {DATABASE_TABS.map((item) => (
      <ToggleGroupItem key={item.key} value={item.key} className="px-3">
        {item.label}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
)
