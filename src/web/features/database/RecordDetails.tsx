import type { DatabaseRecord, DatabaseTable } from "@shared/api-contract"
import { describeError } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
import { Pencil, Trash2 } from "lucide-react"
import { formatRecordKey, sqliteValueTypeLabel } from "./format"
import { SqliteValueView } from "./RecordList"

export type RecordDetailsProps = {
  table: DatabaseTable
  record: DatabaseRecord | null
  pending: boolean
  error: unknown
  /** 表能力与在线状态由页面判断；不可写时按钮禁用并说明原因。 */
  canEdit: boolean
  canDelete: boolean
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  /** 切记录时用来重建字段滚动容器，让滚动位置回到顶部。 */
  resetKey?: string
}

/** 不可写时说明原因，避免只留一个灰按钮。 */
const capabilityHint = (
  table: DatabaseTable,
  operation: "update" | "delete"
): string | null => {
  const capability = table.capabilities.find(
    (item) => item.operation === operation
  )
  if (!capability || capability.allowed) return null
  return capability.message
}

/**
 * 单条记录详情：逐列显示值与类型，NULL、空串、文本、数值与 BLOB 区分开。
 * 只读展示：不改写原值，也不在这里触发任何写入。
 *
 * 布局分两段：写操作（修改/删除）与主键/签名固定在顶部，只有字段列表滚动；
 * 这样字段再多也点得到操作，手机 Sheet 里也不会把按钮顶出屏幕。
 */
export const RecordDetails = (props: RecordDetailsProps) => {
  if (props.error !== null && props.error !== undefined) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <Alert variant="destructive">
          <AlertTitle>记录读取失败</AlertTitle>
          <AlertDescription>{describeError(props.error)}</AlertDescription>
        </Alert>
      </div>
    )
  }
  if (props.pending || props.record === null) {
    return (
      <div className="min-h-0 flex-1 space-y-2 p-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    )
  }

  const editHint = capabilityHint(props.table, "update")
  const deleteHint = capabilityHint(props.table, "delete")

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col text-sm">
      {/* 固定区：写操作与定位信息不随字段列表滚走 */}
      <div className="flex shrink-0 flex-col gap-3 border-b p-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={!props.canEdit || props.busy}
            onClick={props.onEdit}
          >
            <Pencil aria-hidden="true" />
            修改记录
          </Button>
          <Button
            variant="destructive"
            className="min-h-11"
            disabled={!props.canDelete || props.busy}
            onClick={props.onDelete}
          >
            <Trash2 aria-hidden="true" />
            删除记录
          </Button>
        </div>
        {editHint === null ? null : (
          <p className="text-muted-foreground">不能修改：{editHint}</p>
        )}
        {deleteHint === null ? null : (
          <p className="text-muted-foreground">不能删除：{deleteHint}</p>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
          {/* 主键与签名都是短值（签名已截断），标签与值并排，不白占一行 */}
          <div className="flex items-center gap-2">
            <p className="shrink-0 text-muted-foreground">主键</p>
            <p className="font-mono text-xs break-all">
              {formatRecordKey(props.record.key)}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <p className="shrink-0 text-muted-foreground">记录签名</p>
            <Tooltip>
              <TooltipTrigger
                render={
                  <p className="min-w-0 truncate font-mono text-xs">
                    {props.record.signature}
                  </p>
                }
              />
              <TooltipContent className="max-w-lg break-all">
                {props.record.signature}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* 滚动区：切换记录时重建容器，字段列表回到顶部 */}
      <div
        key={props.resetKey ?? "none"}
        className="min-h-0 flex-1 overflow-auto p-4"
      >
        <dl className="space-y-4">
          {props.table.columns.map((column) => {
            const value = props.record?.values[column.name]
            return (
              <div key={column.name} className="space-y-1">
                <dt className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{column.name}</span>
                  <Badge variant="outline">
                    {value === undefined
                      ? "无取值"
                      : sqliteValueTypeLabel(value)}
                  </Badge>
                  {column.primaryKeyPosition > 0 ? (
                    <Badge variant="secondary">主键</Badge>
                  ) : null}
                  {column.generated ? (
                    <Badge variant="secondary">生成列</Badge>
                  ) : null}
                </dt>
                <dd className="break-all">
                  {value === undefined ? (
                    <span className="text-muted-foreground">
                      记录里没有这一列
                    </span>
                  ) : (
                    <SqliteValueView value={value} />
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      </div>
    </div>
  )
}
