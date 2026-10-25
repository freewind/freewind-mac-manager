import { Button } from "@web/components/ui/button"
import { TableHead } from "@web/components/ui/table"
import type { TableSortState } from "@web/hooks/use-table-sort"
import { cn } from "cn"
import { ArrowDown, ArrowUp } from "lucide-react"
import type { ReactNode } from "react"

/**
 * 可排序的表头：把 useTableSort 返回的 sort 传进来即可，点击循环升/降序。
 * 排序状态同时写进 aria-sort，屏幕阅读器不必靠箭头图标分辨。
 */
export const SortableTableHead = <Key extends string>(props: {
  sort: TableSortState<Key>
  column: Key
  label: ReactNode
  className?: string
}) => {
  const active = props.sort.key === props.column
  return (
    <TableHead
      className={props.className}
      aria-sort={
        active ? (props.sort.descending ? "descending" : "ascending") : "none"
      }
    >
      <Button
        size="sm"
        variant="ghost"
        className={cn("-ml-2", active && "text-foreground")}
        onClick={() => props.sort.toggle(props.column)}
      >
        {props.label}
        {active ? (
          props.sort.descending ? (
            <ArrowDown className="size-3" />
          ) : (
            <ArrowUp className="size-3" />
          )
        ) : null}
      </Button>
    </TableHead>
  )
}
