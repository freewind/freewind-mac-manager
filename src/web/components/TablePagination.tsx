import { Button } from "@web/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select"
import { cn } from "cn"

/** 每页条数的可选值：给到大跨度，规则表动辄上千行。 */
export const TABLE_PAGE_SIZES = [10, 50, 100, 500] as const

/** 默认每页条数：所有表格用同一个值，切来切去不刺眼。 */
export const TABLE_PAGE_SIZE = 10

/** 页码槽位：首尾各一个、当前页前后各一个，间隔处用省略号。 */
const pageSlots = (page: number, pageCount: number): (number | "gap")[] => {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }
  const picks = new Set(
    [1, page - 1, page, page + 1, pageCount].filter(
      (item) => item >= 1 && item <= pageCount
    )
  )
  const sorted = [...picks].sort((left, right) => left - right)
  const slots: (number | "gap")[] = []
  let previous = 0
  for (const item of sorted) {
    if (previous !== 0 && item - previous > 1) slots.push("gap")
    slots.push(item)
    previous = item
  }
  return slots
}

/**
 * 表格分页条：每页条数 + 上一页 / 页码 / 下一页。
 *
 * 受控组件：页码、每页条数与总页数都由调用方持有（page 从 1 开始），
 * 本组件只负责渲染与回调，换表格时整套搬过去即可。
 * 只有一页时仍渲染每页条数（还要能改回来），页码按钮由调用方按需隐藏。
 */
export const TablePagination = (props: {
  page: number
  pageCount: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  className?: string
}) => {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", props.className)}>
      <Select
        value={String(props.pageSize)}
        onValueChange={(next) => {
          if (next !== null) props.onPageSizeChange(Number(next))
        }}
      >
        <SelectTrigger aria-label="每页条数" className="w-auto">
          <SelectValue>{`每页 ${props.pageSize}`}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {TABLE_PAGE_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {`每页 ${size}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {props.pageCount <= 1 ? null : (
        <nav aria-label="分页" className="flex flex-wrap items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={props.page <= 1}
            onClick={() => props.onPageChange(props.page - 1)}
          >
            上一页
          </Button>
          {pageSlots(props.page, props.pageCount).map((slot, index, slots) =>
            slot === "gap" ? (
              <span
                key={`gap-${slots[index - 1] ?? 0}`}
                aria-hidden="true"
                className="px-1 text-xs text-muted-foreground"
              >
                …
              </span>
            ) : (
              <Button
                key={slot}
                variant={slot === props.page ? "default" : "outline"}
                size="sm"
                aria-label={`第 ${slot} 页`}
                aria-current={slot === props.page ? "page" : undefined}
                onClick={() => props.onPageChange(slot)}
              >
                {slot}
              </Button>
            )
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={props.page >= props.pageCount}
            onClick={() => props.onPageChange(props.page + 1)}
          >
            下一页
          </Button>
        </nav>
      )}
    </div>
  )
}
