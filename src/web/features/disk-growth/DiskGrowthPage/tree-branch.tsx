import type { GrowthEntry } from "@shared/api-contract"
import { describeError, formatBytes, formatSignedBytes } from "@shared/format"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Progress } from "@web/components/ui/progress"
import { Skeleton } from "@web/components/ui/skeleton"
import { TableCell, TableHead, TableRow } from "@web/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
import {
  useChildren,
  useRevealEntry,
  useTrashEntry,
} from "@web/features/disk-growth/queries"
import { useDiskGrowthLocalStore } from "@web/features/disk-growth/store"
import { cn } from "@web/lib/utils"
import {
  ArrowDown,
  ArrowRight,
  Copy,
  File,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Trash2,
} from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"

const INDENT = 14

type BranchProps = {
  path: string
  depth: number
  scanId: number | null
  baselineScanId: number | null
  view: "growth" | "size"
  onNotice: (message: string | null) => void
}

/** 目录树的递归分支：展开状态与排序来自本地 store，数据来自目录查询。 */
export const TreeBranch = (props: BranchProps) => {
  const { path, depth, view, onNotice } = props
  const { entries, isLoading } = useChildren({
    scanId: props.scanId,
    baselineScanId: props.baselineScanId,
    path,
  })
  const expanded = useDiskGrowthLocalStore((state) => state.expanded)
  const sortKey = useDiskGrowthLocalStore((state) => state.sortKey)
  const descending = useDiskGrowthLocalStore((state) => state.descending)
  const toggleExpanded = useDiskGrowthLocalStore(
    (state) => state.toggleExpanded
  )

  const sorted = useMemo(() => {
    const factor = descending ? -1 : 1
    return [...entries].sort((left, right) => {
      if (sortKey === "name")
        return left.name.localeCompare(right.name) * factor
      const leftValue = sortKey === "size" ? left.size : left.delta
      const rightValue = sortKey === "size" ? right.size : right.delta
      return (leftValue - rightValue) * factor
    })
  }, [entries, sortKey, descending])

  const total = useMemo(
    () => sorted.reduce((sum, entry) => sum + entry.size, 0),
    [sorted]
  )

  if (isLoading && entries.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={5}>
          <Skeleton className="h-5 w-full" />
        </TableCell>
      </TableRow>
    )
  }

  if (depth === 0 && sorted.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={5} className="py-10">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>还没有快照数据</EmptyTitle>
              <EmptyDescription>
                点右上角「立即扫描」生成第一份快照。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {sorted.map((entry) => {
        const isExpandable = entry.kind === "dir" && !entry.folded
        const open = isExpandable && expanded.includes(entry.path)
        return (
          <BranchRow
            key={entry.path}
            entry={entry}
            depth={depth}
            open={open}
            view={view}
            ratio={total > 0 ? entry.size / total : 0}
            onToggle={() => toggleExpanded(entry.path)}
            onNotice={onNotice}
          >
            {open ? (
              <TreeBranch {...props} path={entry.path} depth={depth + 1} />
            ) : null}
          </BranchRow>
        )
      })}
    </>
  )
}

type BranchRowProps = {
  entry: GrowthEntry
  depth: number
  open: boolean
  view: "growth" | "size"
  ratio: number
  onToggle: () => void
  onNotice: (message: string | null, type?: "success" | "error") => void
  children?: ReactNode
}

export const BranchRow = ({
  entry,
  depth,
  open,
  view,
  ratio,
  onToggle,
  onNotice,
  children,
}: BranchRowProps) => {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const reveal = useRevealEntry()
  const trash = useTrashEntry()
  const isExpandable = entry.kind === "dir" && !entry.folded

  const copyRow = async (): Promise<void> => {
    const text = [
      entry.path,
      `大小 ${formatBytes(entry.size)}`,
      `增长 ${formatSignedBytes(entry.delta)}`,
      entry.kind === "dir" ? "目录" : "文件",
    ].join("\t")
    try {
      await navigator.clipboard.writeText(text)
      onNotice(`已复制：${entry.path}`)
    } catch (error) {
      onNotice(`复制失败：${describeError(error)}`, "error")
    }
  }

  return (
    <>
      <TableRow className={cn(isExpandable ? "cursor-pointer" : undefined)}>
        <TableCell onClick={() => isExpandable && onToggle()}>
          <span
            className="flex items-center gap-1.5"
            style={{ paddingLeft: depth * INDENT }}
          >
            {isExpandable ? (
              open ? (
                <ArrowDown className="size-3 text-muted-foreground" />
              ) : (
                <ArrowRight className="size-3 text-muted-foreground" />
              )
            ) : (
              <span className="w-3" />
            )}
            {entry.kind === "dir" ? (
              <Folder className="size-3.5 text-muted-foreground" />
            ) : (
              <File className="size-3.5 text-muted-foreground" />
            )}
            {/* 名称可能很长：外层格子继续省略，悬停看全文。 */}
            <span className="min-w-0 truncate">
              <Tooltip>
                <TooltipTrigger
                  render={<span className="block truncate">{entry.name}</span>}
                />
                <TooltipContent className="max-w-lg break-all">
                  {entry.name}
                </TooltipContent>
              </Tooltip>
            </span>
            {entry.folded ? <Badge variant="secondary">已折叠</Badge> : null}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatBytes(entry.size)}
        </TableCell>
        {view === "size" ? (
          <TableCell>
            <span className="flex items-center justify-end gap-2">
              <span className="text-muted-foreground tabular-nums">
                {(ratio * 100).toFixed(ratio >= 0.1 ? 0 : 1)}%
              </span>
              <Progress value={Math.min(100, ratio * 100)} className="w-24" />
            </span>
          </TableCell>
        ) : (
          <TableCell
            className={cn(
              "text-right tabular-nums",
              entry.delta > 0 ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {formatSignedBytes(entry.delta)}
          </TableCell>
        )}
        <TableCell className="truncate text-xs text-muted-foreground">
          {/* 路径可能很长：格子继续负责省略，悬停看全文。 */}
          <Tooltip>
            <TooltipTrigger
              render={<span className="block truncate">{entry.path}</span>}
            />
            <TooltipContent className="max-w-lg break-all">
              {entry.path}
            </TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" aria-label="更多操作">
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void copyRow()}>
                <Copy />
                复制本行信息
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={reveal.busy}
                onClick={() => void reveal.run(entry.path)}
              >
                <FolderOpen />
                在访达中打开
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 />
                移到废纸篓
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>移到废纸篓？</AlertDialogTitle>
                <AlertDialogDescription>{entry.path}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={trash.busy}
                  onClick={() => {
                    setConfirmOpen(false)
                    void trash.run(entry.path)
                  }}
                >
                  移到废纸篓
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TableCell>
      </TableRow>
      {children}
    </>
  )
}

/** 表头可排序按钮：当前排序列显示方向箭头。 */
export const SortableHead = (props: {
  label: string
  sortKey: "name" | "size" | "delta"
  className?: string
}) => {
  const sortKey = useDiskGrowthLocalStore((state) => state.sortKey)
  const descending = useDiskGrowthLocalStore((state) => state.descending)
  const setSort = useDiskGrowthLocalStore((state) => state.setSort)
  const active = sortKey === props.sortKey
  return (
    <TableHead className={props.className}>
      <Button
        variant="ghost"
        size="xs"
        className="px-0 hover:bg-transparent"
        onClick={() => setSort(props.sortKey)}
      >
        {props.label}
        {active ? <span>{descending ? "↓" : "↑"}</span> : null}
      </Button>
    </TableHead>
  )
}
