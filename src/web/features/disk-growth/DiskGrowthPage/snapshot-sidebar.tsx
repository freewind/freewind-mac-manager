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
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import { ScrollArea } from "@web/components/ui/scroll-area"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  useDeleteScans,
  type useSnapshots,
} from "@web/features/disk-growth/queries"
import { useDiskGrowthLocalStore } from "@web/features/disk-growth/store"
import { cn } from "@web/lib/utils"
import type { LucideIcon } from "lucide-react"
import { GitMerge, MoreHorizontal, SquareCheck, Trash2 } from "lucide-react"
import type { ComponentType, ReactNode } from "react"
import { useMemo, useState } from "react"

type SnapshotAction = {
  key: string
  label: string
  icon: LucideIcon
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
        <action.icon />
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
        <action.icon />
        {action.label}
      </SnapshotContextItem>
    ))}
  </>
)

/** 快照侧栏：选择对比区间，多选后可合并或删除。 */
export const SnapshotSidebar = (props: {
  snapshots: ReturnType<typeof useSnapshots>["snapshots"]
  isLoading: boolean
  busiest: boolean
}) => {
  const { snapshots, isLoading, busiest } = props
  const store = useDiskGrowthLocalStore()
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

  const runDelete = (ids: number[]): void => {
    void deleteScans.run(ids)
  }

  return (
    <aside className="flex min-h-0 w-full flex-1 flex-col border-b md:w-56 md:flex-none md:border-r md:border-b-0">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
        快照
      </div>
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
          <Button
            variant="ghost"
            size="xs"
            onClick={() => store.setMultiSelect(false)}
          >
            退出
          </Button>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {isLoading
            ? [0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))
            : snapshots.map((snapshot, index) => {
                const earlier = snapshots[index + 1]
                const delta = earlier
                  ? snapshot.totalSize - earlier.totalSize
                  : null
                const checked = store.checked.includes(snapshot.id)
                const selected = store.selection.includes(snapshot.id)
                const actions: SnapshotAction[] = [
                  {
                    key: "multi",
                    label: store.multiSelect ? "退出多选" : "选择",
                    icon: SquareCheck,
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
                    icon: GitMerge,
                    disabled: store.checked.length < 2,
                    run: () => setPending({ kind: "merge" }),
                  },
                  {
                    key: "delete",
                    label: "删除这份",
                    icon: Trash2,
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
                        "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs select-text",
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
                            store.view === "growth" &&
                              delta !== null &&
                              delta > 0
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
                              <MoreHorizontal />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          {renderActions(actions)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      {renderContextActions(actions)}
                    </ContextMenuContent>
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
              disabled={busiest || deleteScans.busy}
              onClick={() => {
                const action = pending
                setPending(null)
                if (action?.kind === "merge") {
                  runDelete(rangeIds.slice(1))
                  store.setMultiSelect(false)
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
