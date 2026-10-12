import type {
  DatabaseColumn,
  DatabaseFilter,
  DatabaseFilterOperator,
  DatabaseRecord,
  DatabaseRecordLocatorKey,
  DatabaseSort,
  DatabaseTable,
  SqliteValue,
} from "@shared/api-contract"
import { describeError } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
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
import { Input } from "@web/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@web/components/ui/item"
import { Label } from "@web/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { Plus, X } from "lucide-react"
import { useState } from "react"
import {
  FILTER_OPERATOR_LABELS,
  filterValueFromInput,
  formatRecordKey,
  formatSqliteValue,
  LONG_VALUE_LENGTH,
  looksLikeJson,
  operatorNeedsValue,
  recordKeyFingerprint,
} from "./format"

const OPERATORS = Object.keys(
  FILTER_OPERATOR_LABELS
) as DatabaseFilterOperator[]
/** 算子要显示中文，且搜索时按中文匹配，所以带上标签。 */
const OPERATOR_OPTIONS = OPERATORS.map((operator) => ({
  value: operator,
  label: FILTER_OPERATOR_LABELS[operator],
}))
const PAGE_SIZES = [10, 20, 50, 100] as const
const DEFAULT_SORT = "__default__"

/**
 * 值的展示：NULL、空串、文本、数值与 BLOB 各自有明确形态，长内容可展开。
 * 记录列表与记录详情共用，避免两处各写一份取值规则。
 */
export const SqliteValueView = (props: { value: SqliteValue }) => {
  const [expanded, setExpanded] = useState(false)
  const { value } = props
  if (value.type === "null") {
    return <span className="text-muted-foreground">NULL</span>
  }
  if (value.type === "text" && value.value === "") {
    return <span className="text-muted-foreground">空字符串</span>
  }
  const text = formatSqliteValue(value)
  const long = value.type === "text" && text.length > LONG_VALUE_LENGTH
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="break-all font-mono text-xs">
        {long && !expanded ? `${text.slice(0, LONG_VALUE_LENGTH)}…` : text}
      </span>
      {long ? (
        <Button
          variant="link"
          size="sm"
          className="min-h-11 px-1"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "收起" : "展开"}
        </Button>
      ) : null}
      {looksLikeJson(value) ? <Badge variant="outline">JSON</Badge> : null}
    </span>
  )
}

const FilterEditor = (props: {
  columns: DatabaseColumn[]
  onAdd: (filter: DatabaseFilter) => void
}) => {
  const [columnName, setColumnName] = useState(props.columns[0]?.name ?? "")
  const [operator, setOperator] = useState<DatabaseFilterOperator>("eq")
  const [text, setText] = useState("")
  const column = props.columns.find((item) => item.name === columnName)

  const add = (): void => {
    if (!column) return
    props.onAdd(
      operatorNeedsValue(operator)
        ? {
            column: column.name,
            operator,
            value: filterValueFromInput(column, text),
          }
        : { column: column.name, operator }
    )
    setText("")
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="database-filter-column">字段</Label>
        <Combobox
          items={props.columns.map((item) => item.name)}
          value={columnName}
          onValueChange={(next) => setColumnName(next ?? "")}
        >
          <ComboboxInput
            id="database-filter-column"
            className="min-h-11 w-full"
            placeholder="搜索字段"
          />
          <ComboboxContent>
            <ComboboxEmpty>无匹配字段</ComboboxEmpty>
            <ComboboxList>
              {(item) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="database-filter-operator">条件</Label>
        <Combobox
          items={OPERATOR_OPTIONS}
          itemToStringValue={(item) => item.label}
          value={
            OPERATOR_OPTIONS.find((item) => item.value === operator) ?? null
          }
          onValueChange={(next) => setOperator(next?.value ?? "eq")}
        >
          <ComboboxInput
            id="database-filter-operator"
            className="min-h-11 w-full"
            placeholder="搜索条件"
          />
          <ComboboxContent>
            <ComboboxEmpty>无匹配条件</ComboboxEmpty>
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
      {operatorNeedsValue(operator) ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="database-filter-value">取值</Label>
          <Input
            id="database-filter-value"
            className="min-h-11"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
      ) : null}
      <Button
        variant="outline"
        className="min-h-11"
        disabled={!column}
        onClick={add}
      >
        <Plus aria-hidden="true" />
        添加筛选
      </Button>
    </div>
  )
}

export type RecordListProps = {
  table: DatabaseTable
  records: DatabaseRecord[]
  total: number | null
  pending: boolean
  error: unknown
  page: number
  pageSize: number
  filters: DatabaseFilter[]
  sorts: DatabaseSort[]
  selectedKey: DatabaseRecordLocatorKey | null
  /** 当前页勾选的记录指纹；勾选状态由页面持有，便于批量删除。 */
  checkedFingerprints: ReadonlySet<string>
  /** 是否允许删除（表能力与在线状态由页面判断）。 */
  canDelete: boolean
  deleteBusy: boolean
  onToggleChecked: (record: DatabaseRecord, checkedNow: boolean) => void
  onClearChecked: () => void
  onRequestDeleteChecked: () => void
  onSelectRecord: (key: DatabaseRecordLocatorKey) => void
  onFiltersChange: (filters: DatabaseFilter[]) => void
  onSortsChange: (sorts: DatabaseSort[]) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

/**
 * 记录列表：筛选、排序、分页、当前页勾选与详情入口。
 * 手机单列卡片，桌面用表格；两者共享同一份数据与动作。
 */
export const RecordList = (props: RecordListProps) => {
  const isDesktop = useIsDesktop()
  const columns = props.table.columns.filter((column) => !column.hidden)
  const checked = props.checkedFingerprints
  const activeSort = props.sorts[0]
  /** 排序字段的第一个选项是默认排序，其余是当前表的可见列。 */
  const sortOptions = [
    { value: DEFAULT_SORT, label: "默认（按主键）" },
    ...columns.map((column) => ({
      value: column.name,
      label: column.name,
    })),
  ]

  const hasNext =
    props.total === null
      ? props.records.length >= props.pageSize
      : props.page * props.pageSize < props.total

  const setSort = (column: string, direction: "asc" | "desc"): void => {
    props.onSortsChange(column === DEFAULT_SORT ? [] : [{ column, direction }])
  }

  /**
   * 筛选条目的 key：按内容（含重复次数）生成，不用数组下标，
   * 删掉中间一条时其余条目不会换身份。
   */
  const filterKeys = (() => {
    const seen = new Map<string, number>()
    return props.filters.map((filter) => {
      const base = `${filter.column}\u0000${filter.operator}\u0000${JSON.stringify(filter.value ?? null)}`
      const occurrence = seen.get(base) ?? 0
      seen.set(base, occurrence + 1)
      return `${base}#${occurrence}`
    })
  })()

  const body =
    props.error !== null && props.error !== undefined ? (
      <Alert variant="destructive">
        <AlertTitle>记录读取失败</AlertTitle>
        <AlertDescription>{describeError(props.error)}</AlertDescription>
      </Alert>
    ) : props.pending ? (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    ) : props.records.length === 0 ? (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>没有符合条件的记录</EmptyTitle>
          <EmptyDescription>
            当前筛选与排序下没有任何记录；可以清空筛选后再试。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    ) : isDesktop ? (
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-12">选择</TableHead>
            {columns.map((column) => (
              <TableHead key={column.name}>{column.name}</TableHead>
            ))}
            <TableHead className="w-24">详情</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.records.map((record) => {
            const fingerprint = recordKeyFingerprint(record.key)
            return (
              <TableRow key={fingerprint}>
                <TableCell>
                  <Checkbox
                    aria-label={`选择记录 ${formatRecordKey(record.key)}`}
                    checked={checked.has(fingerprint)}
                    onCheckedChange={(next) =>
                      props.onToggleChecked(record, next === true)
                    }
                  />
                </TableCell>
                {columns.map((column) => (
                  <TableCell key={column.name} className="align-top">
                    <SqliteValueView value={record.values[column.name]} />
                  </TableCell>
                ))}
                <TableCell>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => props.onSelectRecord(record.key)}
                  >
                    查看
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    ) : (
      <ItemGroup>
        {props.records.map((record) => {
          const fingerprint = recordKeyFingerprint(record.key)
          return (
            <Item key={fingerprint} variant="outline">
              <ItemContent>
                <ItemTitle className="font-mono text-xs">
                  {formatRecordKey(record.key)}
                </ItemTitle>
                <ItemDescription className="space-y-1">
                  {columns.slice(0, 4).map((column) => (
                    <span key={column.name} className="block">
                      <span className="text-muted-foreground">
                        {column.name}：
                      </span>
                      <SqliteValueView value={record.values[column.name]} />
                    </span>
                  ))}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Checkbox
                  aria-label={`选择记录 ${formatRecordKey(record.key)}`}
                  checked={checked.has(fingerprint)}
                  onCheckedChange={(next) =>
                    props.onToggleChecked(record, next === true)
                  }
                />
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => props.onSelectRecord(record.key)}
                >
                  查看
                </Button>
              </ItemActions>
            </Item>
          )
        })}
      </ItemGroup>
    )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      {/* 筛选与排序固定在列表顶部：它们属于列表级控件，不随记录滚走 */}
      <div className="shrink-0 space-y-2">
        <FilterEditor
          columns={columns}
          onAdd={(filter) => props.onFiltersChange([...props.filters, filter])}
        />
        {props.filters.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {props.filters.map((filter, index) => (
              <Badge key={filterKeys[index]}>
                {filter.column} {FILTER_OPERATOR_LABELS[filter.operator]}
                {filter.value === undefined
                  ? ""
                  : ` ${formatSqliteValue(filter.value)}`}
                <button
                  type="button"
                  className="ml-1 inline-flex min-h-6 items-center"
                  aria-label={`移除筛选 ${filter.column}`}
                  onClick={() =>
                    props.onFiltersChange(
                      props.filters.filter((_, position) => position !== index)
                    )
                  }
                >
                  <X aria-hidden="true" />
                </button>
              </Badge>
            ))}
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => props.onFiltersChange([])}
            >
              清空筛选
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="database-sort-column">排序字段</Label>
          <Combobox
            items={sortOptions}
            itemToStringValue={(item) => item.label}
            value={
              sortOptions.find(
                (item) => item.value === (activeSort?.column ?? DEFAULT_SORT)
              ) ?? null
            }
            onValueChange={(next) =>
              setSort(
                next?.value ?? DEFAULT_SORT,
                activeSort?.direction ?? "asc"
              )
            }
          >
            <ComboboxInput
              id="database-sort-column"
              className="min-h-11 w-full"
              placeholder="搜索排序字段"
            />
            <ComboboxContent>
              <ComboboxEmpty>无匹配字段</ComboboxEmpty>
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
        <div className="flex flex-col gap-1">
          <Label htmlFor="database-sort-direction">方向</Label>
          <Select
            value={activeSort?.direction ?? "asc"}
            onValueChange={(next) =>
              setSort(
                activeSort?.column ?? DEFAULT_SORT,
                next as "asc" | "desc"
              )
            }
          >
            <SelectTrigger id="database-sort-direction" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">升序</SelectItem>
              <SelectItem value="desc">降序</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 列表是这一列唯一的滚动区：记录多、表宽都只在这里滚 */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">{body}</div>

      {/* 分页与批量删除钉在底部；窄屏不换行而是横向滚动，避免顶掉列表 */}
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t pt-3">
        <Button
          variant="outline"
          className="min-h-11 shrink-0"
          disabled={props.page <= 1}
          onClick={() => props.onPageChange(props.page - 1)}
        >
          上一页
        </Button>
        <span className="shrink-0">第 {props.page} 页</span>
        <Button
          variant="outline"
          className="min-h-11 shrink-0"
          disabled={!hasNext}
          onClick={() => props.onPageChange(props.page + 1)}
        >
          下一页
        </Button>
        <div className="flex shrink-0 items-center gap-2">
          <Label htmlFor="database-page-size">每页</Label>
          <Select
            value={String(props.pageSize)}
            onValueChange={(next) => props.onPageSizeChange(Number(next))}
          >
            <SelectTrigger id="database-page-size" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} 条
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="shrink-0 text-muted-foreground">
          {props.total === null
            ? "数量未知（有界计数未完成）"
            : `共 ${props.total} 条`}
        </span>
        {checked.size > 0 ? (
          <span className="flex shrink-0 items-center gap-2">
            已选 {checked.size} 条（仅当前页）
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={props.onClearChecked}
            >
              取消选择
            </Button>
            <Button
              variant="destructive"
              className="min-h-11"
              disabled={!props.canDelete || props.deleteBusy}
              onClick={props.onRequestDeleteChecked}
            >
              删除选中 {checked.size} 条
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  )
}
