import { RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { DatabaseTable } from "@shared/api-contract"
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
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { useState } from "react"
import { formatReadAt, formatRecordKey } from "./format"
import { databaseKeys } from "./queries"
import { RecordDetails } from "./RecordDetails"
import { RecordList, type RecordListProps } from "./RecordList"
import { TableStructure } from "./TableStructure"
import { useDatabase } from "./useDatabase"

/** 记录列表需要的数据与动作；表本身由外层按当前选中表传入。 */
type ListModel = Omit<RecordListProps, "table">

/**
 * 数据库浏览页：选表、看结构、筛选排序分页、看单条记录。
 *
 * 这是应用自身 SQLite 的真实内容，页面一直提醒「直接操作底层数据」；
 * 本页所有操作都是只读的，写入留给后续任务。
 */
export const DatabasePage = () => {
  const model = useDatabase()
  const queryClient = useQueryClient()
  const isDesktop = useIsDesktop()
  // 结构在桌面默认展开；手机先收起，避免把记录列表挤出首屏
  const [structureOpen, setStructureOpen] = useState(isDesktop)

  const detailsOpen = model.selectedKey !== null
  // 窄屏用 Sheet 展示详情，返回键先关浮层（统一走 useHistoryOverlay）
  useHistoryOverlay(detailsOpen, () => model.selectRecord(null))

  /** 刷新当前页可见的一切：表列表、表结构与记录都重新读取。 */
  const refreshAll = (): void => {
    void queryClient.refetchQueries({
      queryKey: databaseKeys.all,
      type: "active",
    })
  }

  const detailsFor = (table: DatabaseTable) => (
    <RecordDetails
      table={table}
      record={model.recordDetail}
      pending={model.recordPending}
      error={model.recordError}
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

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="database-table">表</Label>
          <Select
            value={model.table ?? ""}
            onValueChange={(next) => model.selectTable(next)}
          >
            <SelectTrigger
              id="database-table"
              className="min-h-11 min-w-56"
              disabled={model.tables.length === 0}
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
        <span className="text-sm text-muted-foreground">
          {model.updatedAt === null
            ? "尚未读取"
            : `最后读取 ${formatReadAt(model.updatedAt)}`}
        </span>
      </div>

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

      {model.tableDetail === null ? null : isDesktop ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-4">{sections(model.tableDetail)}</div>
          {detailsOpen ? (
            <aside className="min-w-0">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">记录详情</CardTitle>
                </CardHeader>
                <CardContent>{detailsFor(model.tableDetail)}</CardContent>
              </Card>
            </aside>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {sections(model.tableDetail)}
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
                {detailsFor(model.tableDetail)}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      )}
    </div>
  )
}
