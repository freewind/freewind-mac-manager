import { useMemo, useState } from "react"

/** 表头排序的当前状态，直接交给 SortableTableHead 使用。 */
export type TableSortState<Key extends string> = {
  key: Key
  descending: boolean
  toggle: (key: Key) => void
}

export type TableSortOptions<Key extends string, Item> = {
  items: Item[]
  /**
   * 每列怎么取值：数字按数值比，字符串按中文排序规则比。
   * 建议放在组件外用常量，否则每次渲染都会重建排序。
   */
  columns: Record<Key, (item: Item) => string | number | null | undefined>
  initialKey: Key
  /** 某列首次点开时的方向：默认降序，端口这类「从小到大更有用」的列返回 false。 */
  descendingOnSwitch?: (key: Key) => boolean
  /** 与排序方向无关的恒定分组，值小的在前（例如目录永远在文件前面）。 */
  groupOf?: (item: Item) => number
  /** 主键相等时的次序，用来让结果稳定。 */
  tieBreaker?: (left: Item, right: Item) => number
}

const emptyLast = (
  left: string | number | null | undefined,
  right: string | number | null | undefined
): number | null => {
  const leftEmpty = left === null || left === undefined
  const rightEmpty = right === null || right === undefined
  if (!leftEmpty && !rightEmpty) return null
  // 空值恒排在最后，不随升序/降序翻转。
  if (leftEmpty && rightEmpty) return 0
  return leftEmpty ? 1 : -1
}

/**
 * 通用表格排序：调用方只描述「每列怎么取值」，状态切换、比较与升降序由这里负责。
 * 点同一列表头在升序/降序之间切换，换列时用该列的默认方向。
 */
export const useTableSort = <Key extends string, Item>(
  options: TableSortOptions<Key, Item>
): { items: Item[]; sort: TableSortState<Key> } => {
  const {
    items,
    columns,
    initialKey,
    descendingOnSwitch,
    groupOf,
    tieBreaker,
  } = options
  const defaultDescending = (key: Key) => descendingOnSwitch?.(key) ?? true
  const [key, setKey] = useState<Key>(initialKey)
  const [descending, setDescending] = useState(() =>
    defaultDescending(initialKey)
  )

  // 每次渲染重建即可：只是带回调的小对象，不值得为它引入依赖数组的坑。
  const sort: TableSortState<Key> = {
    key,
    descending,
    toggle: (next) => {
      if (next === key) {
        setDescending((previous) => !previous)
        return
      }
      setKey(next)
      setDescending(defaultDescending(next))
    },
  }

  const sorted = useMemo(() => {
    const read = columns[key]
    const factor = descending ? -1 : 1
    return [...items].sort((left, right) => {
      if (groupOf !== undefined) {
        const grouped = groupOf(left) - groupOf(right)
        if (grouped !== 0) return grouped
      }
      const leftValue = read(left)
      const rightValue = read(right)
      const empty = emptyLast(leftValue, rightValue)
      if (empty !== null) return empty
      const base =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), "zh-Hans-CN")
      if (base !== 0) return base * factor
      return tieBreaker?.(left, right) ?? 0
    })
  }, [items, columns, key, descending, groupOf, tieBreaker])

  return { items: sorted, sort }
}
