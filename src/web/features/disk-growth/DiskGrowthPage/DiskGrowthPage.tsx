import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  CheckmarkSquare01Icon,
  Copy01Icon,
  File01Icon,
  Folder01Icon,
  FolderOpenIcon,
  MergeIcon,
  MoreHorizontalIcon,
  RefreshIcon,
  Search01Icon,
  TrashIcon,
} from "@hugeicons/core-free-icons"
import { useMemo, useState, type ComponentType, type ReactNode } from "react"
import type { GrowthEntry } from "@shared/api-contract/types"
import { formatBytes, formatSignedBytes, formatTimestamp } from "@shared/format"
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
import { Checkbox } from "@web/components/ui/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@web/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@web/components/ui/empty"
import { Input } from "@web/components/ui/input"
import { Progress } from "@web/components/ui/progress"
import { ScrollArea } from "@web/components/ui/scroll-area"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import { cn } from "@web/lib/utils"
import { IcicleChart } from "@web/features/disk-growth/IcicleChart"
import {
  useChildren,
  useDeleteScans,
  useRevealEntry,
  useScanStatus,
  useSearch,
  useSelectionRange,
  useSnapshots,
  useStartScan,
  useTrashEntry,
} from "@web/features/disk-growth/queries"
import { useDiskGrowthStore } from "@web/features/disk-growth/store"

const INDENT = 14

export const DiskGrowthPage = () => {
  const { snapshots, isLoading } = useSnapshots()
  const status = useScanStatus()
  const view = useDiskGrowthStore((state) => state.view)
  const setView = useDiskGrowthStore((state) => state.setView)
  const keyword = useDiskGrowthStore((state) => state.keyword)
  const setKeyword = useDiskGrowthStore((state) => state.setKeyword)
  const collapseAll = useDiskGrowthStore((state) => state.collapseAll)
  const notice = useDiskGrowthStore((state) => state.notice)
  const setNotice = useDiskGrowthStore((state) => state.setNotice)

  const range = useSelectionRange(snapshots)
  const spanDays = useMemo(() => {
    if (snapshots.length === 0) return 1
    const newest = snapshots.find((item) => item.id === range.scanId)
    const baseline = snapshots.find((item) => item.id === range.baselineScanId)
    if (!newest || !baseline) return 1
    const days = (newest.startedAt - baseline.startedAt) / 86400
    return days > 0 ? days : 1
  }, [snapshots, range.scanId, range.baselineScanId])

  const startScan = useStartScan()
  const isSearching = keyword.trim().length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-medium">磁盘增长</h1>
          <ToggleGroup
            value={[view]}
            onValueChange={(value: string[]) => {
              if (value[0]) setView(value[0] as typeof view)
            }}
            className="ml-2"
          >
            <ToggleGroupItem value="growth">看增长</ToggleGroupItem>
            <ToggleGroupItem value="size">看大小</ToggleGroupItem>
            <ToggleGroupItem value="icicle">分布图</ToggleGroupItem>
          </ToggleGroup>
          <div className="relative ml-auto w-64">
            <HugeiconsIcon
              icon={Search01Icon}
              className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索全库路径"
              className="pl-7"
            />
          </div>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            全部收起
          </Button>
          <Button
            size="sm"
            onClick={() => void startScan.mutateAsync()}
            disabled={status.running}
          >
            <HugeiconsIcon icon={RefreshIcon} />
            立即扫描
          </Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{status.phase}</span>
          {status.lastError ? (
            <span className="text-destructive">{status.lastError}</span>
          ) : null}
          <span>
            区间 {range.ids.length} 份 / {spanDays.toFixed(1)} 天
          </span>
          {notice ? <span className="text-foreground">{notice}</span> : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SnapshotSidebar
          snapshots={snapshots}
          isLoading={isLoading}
          onNotice={setNotice}
          busiest={startScan.isPending}
        />

        {view === "icicle" ? (
          <IcicleChart
            scanId={range.scanId}
            baselineScanId={range.baselineScanId}
            spanDays={spanDays}
          />
        ) : isSearching ? (
          <SearchResultTable
            scanId={range.scanId}
            baselineScanId={range.baselineScanId}
            keyword={keyword}
            spanDays={spanDays}
            view={view}
            onNotice={setNotice}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <SortableHead label="名称" sortKey="name" className="min-w-72" />
                  <SortableHead label="大小" sortKey="size" className="w-24 text-right" />
                  {view === "size" ? (
                    <SortableHead label="占比" sortKey="size" className="w-40 text-right" />
                  ) : (
                    <SortableHead label="增长" sortKey="delta" className="w-24 text-right" />
                  )}
                  <TableHead className="w-1/3">路径</TableHead>
                  <TableHead className="w-16 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TreeBranch
                  path=""
                  depth={0}
                  scanId={range.scanId}
                  baselineScanId={range.baselineScanId}
                  spanDays={spanDays}
                  view={view}
                  onNotice={setNotice}
                />
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

type BranchProps = {
  path: string
  depth: number
  scanId: number | null
  baselineScanId: number | null
  spanDays: number
  view: "growth" | "size"
  onNotice: (message: string | null) => void
}

const TreeBranch = (props: BranchProps) => {
  const { path, depth, view, onNotice } = props
  const { entries, isLoading } = useChildren({
    scanId: props.scanId,
    baselineScanId: props.baselineScanId,
    path,
    spanDays: props.spanDays,
  })
  const expanded = useDiskGrowthStore((state) => state.expanded)
  const sortKey = useDiskGrowthStore((state) => state.sortKey)
  const descending = useDiskGrowthStore((state) => state.descending)
  const toggleExpanded = useDiskGrowthStore((state) => state.toggleExpanded)

  const sorted = useMemo(() => {
    const factor = descending ? -1 : 1
    return [...entries].sort((left, right) => {
      if (sortKey === "name") return left.name.localeCompare(right.name) * factor
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
              <EmptyDescription>点右上角「立即扫描」生成第一份快照。</EmptyDescription>
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

type SearchProps = {
  scanId: number | null
  baselineScanId: number | null
  keyword: string
  spanDays: number
  view: "growth" | "size"
  onNotice: (message: string | null) => void
}

const SearchResultTable = (props: SearchProps) => {
  const { results } = useSearch({
    scanId: props.scanId,
    baselineScanId: props.baselineScanId,
    keyword: props.keyword,
    spanDays: props.spanDays,
  })
  const total = results.reduce((sum, entry) => sum + entry.size, 0)
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="min-w-72">名称</TableHead>
            <TableHead className="w-24 text-right">大小</TableHead>
            {props.view === "size" ? (
              <TableHead className="w-40 text-right">占比</TableHead>
            ) : (
              <TableHead className="w-24 text-right">增长</TableHead>
            )}
            <TableHead className="w-1/3">路径</TableHead>
            <TableHead className="w-16 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((entry) => (
            <BranchRow
              key={entry.path}
              entry={entry}
              depth={0}
              open={false}
              view={props.view}
              ratio={total > 0 ? entry.size / total : 0}
              onToggle={() => undefined}
              onNotice={props.onNotice}
            />
          ))}
          {results.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10">
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>没有匹配的路径</EmptyTitle>
                    <EmptyDescription>换个关键字试试。</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}

type BranchRowProps = {
  entry: GrowthEntry
  depth: number
  open: boolean
  view: "growth" | "size"
  ratio: number
  onToggle: () => void
  onNotice: (message: string | null) => void
  children?: ReactNode
}

const BranchRow = ({
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
      onNotice(`复制失败：${String(error)}`)
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
              <HugeiconsIcon
                icon={open ? ArrowDown01Icon : ArrowRight01Icon}
                className="size-3 text-muted-foreground"
              />
            ) : (
              <span className="w-3" />
            )}
            <HugeiconsIcon
              icon={entry.kind === "dir" ? Folder01Icon : File01Icon}
              className="size-3.5 text-muted-foreground"
            />
            <span className="truncate">{entry.name}</span>
            {entry.folded ? <Badge variant="secondary">已折叠</Badge> : null}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatBytes(entry.size)}
        </TableCell>
        {view === "size" ? (
          <TableCell>
            <span className="flex items-center justify-end gap-2">
              <span className="tabular-nums text-muted-foreground">
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
          {entry.path}
        </TableCell>
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" aria-label="更多操作">
                  <HugeiconsIcon icon={MoreHorizontalIcon} />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void copyRow()}>
                <HugeiconsIcon icon={Copy01Icon} />
                复制本行信息
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  void reveal.mutateAsync(entry.path).then(
                    (result) => onNotice(result.message),
                    (error: Error) => onNotice(error.message)
                  )
                }
              >
                <HugeiconsIcon icon={FolderOpenIcon} />
                在访达中打开
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
              >
                <HugeiconsIcon icon={TrashIcon} />
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
                  onClick={() => {
                    setConfirmOpen(false)
                    void trash.mutateAsync(entry.path).then(
                      (result) => onNotice(result.message),
                      (error: Error) => onNotice(error.message)
                    )
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

const SortableHead = (props: {
  label: string
  sortKey: "name" | "size" | "delta"
  className?: string
}) => {
  const sortKey = useDiskGrowthStore((state) => state.sortKey)
  const descending = useDiskGrowthStore((state) => state.descending)
  const setSort = useDiskGrowthStore((state) => state.setSort)
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

type SnapshotAction = {
  key: string
  label: string
  icon: typeof TrashIcon
  run: () => void
  destructive?: boolean
  disabled?: boolean
}

type MenuItemComponent = ComponentType<{
  children?: ReactNode
  onClick?: () => void
  variant?: "default" | "destructive"
  disabled?: boolean
}>

const SnapshotDropdownItem = DropdownMenuItem as unknown as MenuItemComponent
const SnapshotContextItem = ContextMenuItem as unknown as MenuItemComponent

const renderActions = (actions: SnapshotAction[]): ReactNode => (
  <>
    {actions.map((action) => (
      <SnapshotDropdownItem
        key={action.key}
        onClick={action.run}
        variant={action.destructive ? "destructive" : "default"}
        disabled={action.disabled}
      >
        <HugeiconsIcon icon={action.icon} />
        {action.label}
      </SnapshotDropdownItem>
    ))}
  </>
)

const renderContextActions = (actions: SnapshotAction[]): ReactNode => (
  <>
    {actions.map((action) => (
      <SnapshotContextItem
        key={action.key}
        onClick={action.run}
        variant={action.destructive ? "destructive" : "default"}
        disabled={action.disabled}
      >
        <HugeiconsIcon icon={action.icon} />
        {action.label}
      </SnapshotContextItem>
    ))}
  </>
)

type SidebarProps = {
  snapshots: ReturnType<typeof useSnapshots>["snapshots"]
  isLoading: boolean
  onNotice: (message: string | null) => void
  busiest: boolean
}

const SnapshotSidebar = ({ snapshots, isLoading, onNotice, busiest }: SidebarProps) => {
  const store = useDiskGrowthStore()
  const deleteScans = useDeleteScans()
  const [pending, setPending] = useState<
    { kind: "delete"; id: number; label: string } | { kind: "merge" } | null
  >(null)

  const rangeIds = useMemo(() => {
    if (snapshots.length === 0) return []
    const checked = store.checked
    if (checked.length === 0) return []
    const indexes = checked
      .map((id) => snapshots.findIndex((snapshot) => snapshot.id === id))
      .filter((index) => index >= 0)
    if (indexes.length === 0) return []
    return snapshots
      .slice(Math.min(...indexes), Math.max(...indexes) + 1)
      .map((snapshot) => snapshot.id)
  }, [snapshots, store.checked])

  const selectRange = (index: number) => {
    const anchor = store.anchorIndex ?? index
    const from = Math.min(anchor, index)
    const to = Math.max(anchor, index)
    const ids = snapshots.slice(from, to + 1).map((snapshot) => snapshot.id)
    store.setAnchorIndex(anchor)
    store.setChecked(ids)
    store.setSelection(ids)
  }

  const runDelete = async (ids: number[]): Promise<void> => {
    const message = await deleteScans.mutateAsync(ids)
    onNotice(message)
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground">快照</div>
      {store.multiSelect ? (
        <div className="flex items-center gap-1 px-2 pb-2">
          <span className="text-xs text-muted-foreground">
            已选 {store.checked.length}
          </span>
          <Button
            variant="outline"
            size="xs"
            className="ml-auto"
            disabled={store.checked.length < 2}
            onClick={() => setPending({ kind: "merge" })}
          >
            合并所选
          </Button>
          <Button variant="ghost" size="xs" onClick={() => store.setMultiSelect(false)}>
            退出
          </Button>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {isLoading
            ? [0, 1, 2].map((index) => <Skeleton key={index} className="h-9 w-full" />)
            : snapshots.map((snapshot, index) => {
                const earlier = snapshots[index + 1]
                const delta = earlier ? snapshot.totalSize - earlier.totalSize : null
                const checked = store.checked.includes(snapshot.id)
                const selected = store.selection.includes(snapshot.id)
                const actions: SnapshotAction[] = [
                  {
                    key: "multi",
                    label: store.multiSelect ? "退出多选" : "选择",
                    icon: CheckmarkSquare01Icon,
                    run: () => {
                      if (store.multiSelect) {
                        store.setMultiSelect(false)
                        return
                      }
                      store.setMultiSelect(true)
                      store.setAnchorIndex(index)
                      store.setChecked([snapshot.id])
                      store.setSelection([snapshot.id])
                    },
                  },
                  {
                    key: "merge",
                    label: "合并所选",
                    icon: MergeIcon,
                    disabled: store.checked.length < 2,
                    run: () => setPending({ kind: "merge" }),
                  },
                  {
                    key: "delete",
                    label: "删除这份",
                    icon: TrashIcon,
                    destructive: true,
                    run: () =>
                      setPending({
                        kind: "delete",
                        id: snapshot.id,
                        label: formatTimestamp(snapshot.startedAt),
                      }),
                  },
                ]
                return (
                  <ContextMenu key={snapshot.id}>
                    <ContextMenuTrigger
                      className={cn(
                        "flex select-text items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs",
                        selected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/60"
                      )}
                      onClick={() => {
                        if (store.multiSelect) {
                          selectRange(index)
                          return
                        }
                        store.setSelection([snapshot.id])
                        store.setChecked([snapshot.id])
                      }}
                    >
                      {store.multiSelect ? (
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => selectRange(index)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      ) : null}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">
                          {formatTimestamp(snapshot.startedAt)}
                        </span>
                        <span
                          className={cn(
                            "text-muted-foreground",
                            store.view === "growth" && delta !== null && delta > 0
                              ? "text-destructive"
                              : undefined
                          )}
                        >
                          {store.view === "size"
                            ? formatBytes(snapshot.totalSize)
                            : delta === null
                              ? "—"
                              : formatSignedBytes(delta)}
                        </span>
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label="快照操作"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <HugeiconsIcon icon={MoreHorizontalIcon} />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          {renderActions(actions)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ContextMenuTrigger>
                    <ContextMenuContent>{renderContextActions(actions)}</ContextMenuContent>
                  </ContextMenu>
                )
              })}
          {!isLoading && snapshots.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              还没有快照，点「立即扫描」生成第一份。
            </p>
          ) : null}
        </div>
      </ScrollArea>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "merge" ? "合并这些快照？" : "删除这份快照？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "merge"
                ? `保留区间最新的一份，删除其余 ${Math.max(0, rangeIds.length - 1)} 份；被删区间的时间跨度会落到保留的那份上。`
                : pending?.kind === "delete"
                  ? `${pending.label} 这份快照将被删除，无法恢复。它前后两份快照的差值会自动跨过被删时段。`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busiest}
              onClick={() => {
                const action = pending
                setPending(null)
                if (action?.kind === "merge") {
                  void runDelete(rangeIds.slice(1)).then(() => store.setMultiSelect(false))
                }
                if (action?.kind === "delete") {
                  void runDelete([action.id])
                }
              }}
            >
              {pending?.kind === "merge" ? "合并" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
