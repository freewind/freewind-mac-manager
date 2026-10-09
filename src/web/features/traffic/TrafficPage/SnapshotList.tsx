import {
  Delete02Icon,
  Download01Icon,
  MoreHorizontalIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { TrafficSnapshot } from "@shared/api-contract"
import { formatBytes, formatTimestamp } from "@shared/format"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import { ButtonGroup } from "@web/components/ui/button-group"
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@web/components/ui/item"
import { ScrollArea } from "@web/components/ui/scroll-area"
import { REALTIME_SNAPSHOT_ID } from "@web/features/traffic/store"
import type { useTraffic } from "@web/features/traffic/useTraffic"
import { cn } from "@web/lib/utils"

type SnapshotListProps = {
  model: ReturnType<typeof useTraffic>
  onRequestDelete: (snapshot: TrafficSnapshot) => void
  onRequestDeleteSelected: () => void
  onRequestMergeSelected: () => void
}

/** 左栏：快照列表（含实时项、多选、删除与合并入口）。 */
export const SnapshotList = (props: SnapshotListProps) => {
  const {
    model,
    onRequestDelete,
    onRequestDeleteSelected,
    onRequestMergeSelected,
  } = props

  return (
    <aside className="flex max-h-72 w-full shrink-0 flex-col border-b md:max-h-none md:w-72 md:border-r md:border-b-0">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">快照（增量）</span>
        <span className="text-[0.6875rem] text-muted-foreground">
          {model.selectionMode
            ? `已选 ${model.selectedSnapshotCount} 份`
            : null}
        </span>
        {model.selectionMode ? null : (
          <Button size="xs" variant="outline" onClick={model.saveSnapshot}>
            保存快照
          </Button>
        )}
      </div>

      {model.selectionMode ? (
        <div className="border-b bg-muted/30 px-3 py-2">
          <ButtonGroup>
            <Button
              size="xs"
              variant="outline"
              disabled={model.selectedSnapshotCount < 2}
              onClick={onRequestMergeSelected}
            >
              合并为一份
            </Button>
            <Button
              size="xs"
              variant="destructive"
              onClick={onRequestDeleteSelected}
            >
              删除所选
            </Button>
            <Button size="xs" variant="secondary" onClick={model.exitSelection}>
              完成
            </Button>
          </ButtonGroup>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <ItemGroup className="gap-0">
          <ContextMenu>
            <ContextMenuTrigger
              className={cn("w-full text-left", model.isRealtime && "bg-muted")}
              onClick={() => model.selectSnapshot(REALTIME_SNAPSHOT_ID)}
            >
              <Item size="xs" variant="default" className="rounded-none">
                <ItemContent>
                  <ItemTitle className="text-emerald-600">实时</ItemTitle>
                  <ItemDescription className="flex items-center gap-1">
                    <HugeiconsIcon icon={Upload01Icon} className="size-3" />
                    {formatBytes(model.totals.bytesIn)}
                    <HugeiconsIcon icon={Download01Icon} className="size-3" />
                    {formatBytes(model.totals.bytesOut)}
                    <span className="pl-0.5">
                      合计 {formatBytes(model.totals.total)}
                    </span>
                  </ItemDescription>
                </ItemContent>
              </Item>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={model.exitSelection}>
                退出多选
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          {model.snapshots.map((snapshot) => {
            const active = model.isSelected(snapshot.id)
            return (
              <ContextMenu key={snapshot.id}>
                <ContextMenuTrigger
                  className={cn("w-full text-left", active && "bg-muted")}
                  onClick={() =>
                    model.selectionMode
                      ? model.toggleSelection(snapshot.id)
                      : model.selectSnapshot(snapshot.id)
                  }
                >
                  <Item size="xs" variant="default" className="rounded-none">
                    {model.selectionMode ? (
                      <Checkbox
                        checked={active}
                        onCheckedChange={() =>
                          model.toggleSelection(snapshot.id)
                        }
                        onClick={(event) => event.stopPropagation()}
                      />
                    ) : null}
                    <ItemContent>
                      <ItemTitle>
                        {formatTimestamp(Math.floor(snapshot.savedAt / 1000))}
                        {snapshot.savedBy === "manual" ? (
                          <Badge variant="secondary">手动</Badge>
                        ) : null}
                      </ItemTitle>
                      <ItemDescription className="flex items-center gap-1">
                        <HugeiconsIcon icon={Upload01Icon} className="size-3" />
                        {formatBytes(snapshot.bytesIn)}
                        <HugeiconsIcon
                          icon={Download01Icon}
                          className="size-3"
                        />
                        {formatBytes(snapshot.bytesOut)}
                        <span className="pl-0.5">
                          合计{" "}
                          {formatBytes(snapshot.bytesIn + snapshot.bytesOut)}
                        </span>
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="快照操作"
                            >
                              <HugeiconsIcon icon={MoreHorizontalIcon} />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              model.selectionMode
                                ? model.exitSelection()
                                : model.startSelection(snapshot.id)
                            }
                          >
                            {model.selectionMode ? "退出多选" : "多选…"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onRequestDelete(snapshot)}
                          >
                            <HugeiconsIcon icon={Delete02Icon} />
                            删除快照
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ItemActions>
                  </Item>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onClick={() =>
                      model.selectionMode
                        ? model.exitSelection()
                        : model.startSelection(snapshot.id)
                    }
                  >
                    {model.selectionMode ? "退出多选" : "多选…"}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onRequestDelete(snapshot)}>
                    <HugeiconsIcon icon={Delete02Icon} />
                    删除快照
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}

          {model.snapshots.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>还没有快照</EmptyTitle>
                <EmptyDescription>
                  点「保存快照」记下当前区间，之后每天会自动存一份。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
        </ItemGroup>
      </ScrollArea>
    </aside>
  )
}
