import { Button } from "@web/components/ui/button"
import { cn } from "cn"

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
 * 表格分页条：上一页 / 页码 / 下一页。
 *
 * 受控组件，页码与总数由调用方持有（page 从 1 开始），本组件只负责渲染与回调。
 * 只有一页时不渲染，调用方不必自己判断。
 */
export const TablePagination = (props: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  className?: string
}) => {
  if (props.pageCount <= 1) return null
  return (
    <nav
      aria-label="分页"
      className={cn("flex flex-wrap items-center gap-1", props.className)}
    >
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
  )
}
