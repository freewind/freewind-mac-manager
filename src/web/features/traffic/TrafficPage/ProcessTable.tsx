import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  MoreHorizontalIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons"
import { Fragment, useMemo, useState } from "react"
import { formatBytes } from "@shared/format"
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
import { ScrollArea } from "@web/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
import { cn } from "@web/lib/utils"
import type { useTraffic } from "@web/features/traffic/useTraffic"

type SortKey = "name" | "bytesIn" | "bytesOut" | "total"

type ProcessTableProps = {
  model: ReturnType<typeof useTraffic>
  scopeText: string
  onCopy: (text: string) => void
  onRequestKill: (label: string, pids: number[]) => void
}

/** 右栏：选中快照（或实时）的进程明细表。 */
export const ProcessTable = (props: ProcessTableProps) => {
  const { model, scopeText, onCopy, onRequestKill } = props
  const [sortKey, setSortKey] = useState<SortKey>("total")
  const [descending, setDescending] = useState(true)

  const sortedGroups = useMemo(() => {
    const factor = descending ? -1 : 1
    return [...model.groups].sort((left, right) => {
      if (sortKey === "name") {
        return left.name.localeCompare(right.name) * factor
      }
      const leftValue =
        sortKey === "bytesIn"
          ? left.bytesIn
          : sortKey === "bytesOut"
            ? left.bytesOut
            : left.bytesIn + left.bytesOut
      const rightValue =
        sortKey === "bytesIn"
          ? right.bytesIn
          : sortKey === "bytesOut"
            ? right.bytesOut
            : right.bytesIn + right.bytesOut
      return (leftValue - rightValue) * factor
    })
  }, [model.groups, sortKey, descending])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((previous) => !previous)
      return
    }
    setSortKey(key)
    setDescending(true)
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      {sortedGroups.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>这个区间没有流量记录</EmptyTitle>
            <EmptyDescription>换一份快照或切到实时看看。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[1%] whitespace-nowrap">
                <SortButton
                  label="进程"
                  active={sortKey === "name"}
                  descending={descending}
                  onClick={() => toggleSort("name")}
                />
              </TableHead>
              <TableHead className="w-[1%] whitespace-nowrap">启动者</TableHead>
              <TableHead className="w-[1%] whitespace-nowrap">PID</TableHead>
              <TableHead className="w-[1%] whitespace-nowrap">端口</TableHead>
              <TableHead className="w-[1%] whitespace-nowrap">状态</TableHead>
              <TableHead className="w-[1%] text-right whitespace-nowrap">
                <SortButton
                  label={
                    <HugeiconsIcon icon={Upload01Icon} className="size-3.5" />
                  }
                  active={sortKey === "bytesIn"}
                  descending={descending}
                  onClick={() => toggleSort("bytesIn")}
                />
              </TableHead>
              <TableHead className="w-[1%] text-right whitespace-nowrap">
                <SortButton
                  label={
                    <HugeiconsIcon icon={Download01Icon} className="size-3.5" />
                  }
                  active={sortKey === "bytesOut"}
                  descending={descending}
                  onClick={() => toggleSort("bytesOut")}
                />
              </TableHead>
              <TableHead className="w-[1%] text-right whitespace-nowrap">
                <SortButton
                  label="总计"
                  active={sortKey === "total"}
                  descending={descending}
                  onClick={() => toggleSort("total")}
                />
              </TableHead>
              <TableHead className="w-full">命令</TableHead>
              <TableHead className="w-[1%]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedGroups.map((groupItem) => {
              const expanded = model.isExpanded(groupItem.name)
              const runningPids = groupItem.children
                .filter((item) => item.running)
                .flatMap((item) => item.pids)
              const groupPorts = [
                ...new Set(groupItem.children.flatMap((item) => item.ports)),
              ]

              return (
                <Fragment key={groupItem.name}>
                  <TableRow
                    className={cn(
                      "cursor-pointer",
                      model.selectedRowKey === groupItem.name && "bg-muted/60"
                    )}
                    onClick={() => model.selectRow(groupItem.name)}
                  >
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-left hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation()
                          model.toggleExpanded(groupItem.name)
                        }}
                      >
                        <HugeiconsIcon
                          icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
                          className="size-3.5 text-muted-foreground"
                        />
                        <span>{groupItem.name}</span>
                      </button>
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-muted-foreground">
                      {groupItem.children.flatMap((item) => item.pids).length}{" "}
                      个
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatPorts(groupPorts)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge running={runningPids.length > 0} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBytes(groupItem.bytesIn)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBytes(groupItem.bytesOut)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBytes(groupItem.bytesIn + groupItem.bytesOut)}
                    </TableCell>
                    <TableCell className="max-w-0 truncate text-muted-foreground">
                      {groupItem.children[0]?.command}
                    </TableCell>
                    <TableCell>
                      <RowActions
                        running={runningPids.length > 0}
                        onCopy={() =>
                          onCopy(
                            buildRowText({
                              scope: scopeText,
                              name: groupItem.name,
                              parent: "",
                              pids: groupItem.children.flatMap(
                                (item) => item.pids
                              ),
                              ports: groupPorts,
                              running: runningPids.length > 0,
                              bytesIn: groupItem.bytesIn,
                              bytesOut: groupItem.bytesOut,
                              command: groupItem.children[0]?.command ?? "",
                            })
                          )
                        }
                        onKill={() =>
                          onRequestKill(groupItem.name, runningPids)
                        }
                      />
                    </TableCell>
                  </TableRow>

                  {expanded &&
                    groupItem.children.map((childItem) => (
                      <TableRow
                        key={groupItem.name + childItem.key}
                        className={cn(
                          "cursor-pointer bg-muted/20",
                          model.selectedRowKey ===
                            groupItem.name + childItem.key && "bg-muted/60"
                        )}
                        onClick={() =>
                          model.selectRow(groupItem.name + childItem.key)
                        }
                      >
                        <TableCell className="pl-8 text-xs">
                          {childItem.scriptName}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {childItem.parent}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {childItem.pids.join(", ")}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {formatPorts(childItem.ports)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge running={childItem.running} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBytes(childItem.bytesIn)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBytes(childItem.bytesOut)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBytes(childItem.bytesIn + childItem.bytesOut)}
                        </TableCell>
                        <TableCell className="max-w-0 truncate">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="block truncate text-muted-foreground">
                                  {childItem.command}
                                </span>
                              }
                            />
                            <TooltipContent className="max-w-lg break-all">
                              {childItem.command}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <RowActions
                            running={childItem.running}
                            onCopy={() =>
                              onCopy(
                                buildRowText({
                                  scope: scopeText,
                                  name: childItem.scriptName,
                                  parent: childItem.parent,
                                  pids: childItem.pids,
                                  ports: childItem.ports,
                                  running: childItem.running,
                                  bytesIn: childItem.bytesIn,
                                  bytesOut: childItem.bytesOut,
                                  command: childItem.command,
                                })
                              )
                            }
                            onKill={() =>
                              onRequestKill(
                                childItem.scriptName,
                                childItem.pids
                              )
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}
    </ScrollArea>
  )
}

type RowActionsProps = {
  running: boolean
  onCopy: () => void
  onKill: () => void
}

const RowActions = (props: RowActionsProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button size="icon-sm" variant="ghost" title="操作">
          <HugeiconsIcon icon={MoreHorizontalIcon} />
        </Button>
      }
    />
    <DropdownMenuContent align="end">
      <DropdownMenuItem onClick={props.onCopy}>
        <HugeiconsIcon icon={Copy01Icon} />
        复制整行信息
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!props.running} onClick={props.onKill}>
        <HugeiconsIcon icon={Delete02Icon} />
        结束进程
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)

const StatusBadge = (props: { running: boolean }) => (
  <Badge
    variant={props.running ? "secondary" : "outline"}
    className={cn(props.running && "text-emerald-600")}
  >
    {props.running ? "运行中" : "已退出"}
  </Badge>
)

type SortButtonProps = {
  label: React.ReactNode
  active: boolean
  descending: boolean
  onClick: () => void
}

const SortButton = (props: SortButtonProps) => {
  const { label, active, descending, onClick } = props
  return (
    <Button
      size="xs"
      variant={active ? "secondary" : "ghost"}
      className="-ml-2"
      onClick={onClick}
    >
      {label}
      {active ? (
        <HugeiconsIcon
          icon={descending ? ArrowDown01Icon : ArrowUp01Icon}
          className="size-3"
        />
      ) : null}
    </Button>
  )
}

const formatPorts = (ports: number[]): string =>
  ports.length === 0 ? "—" : ports.join(", ")

/** 复制给 AI 分析用的整行信息。 */
const buildRowText = (input: {
  scope: string
  name: string
  parent: string
  pids: number[]
  ports: number[]
  running: boolean
  bytesIn: number
  bytesOut: number
  command: string
}): string =>
  [
    `范围: ${input.scope}`,
    `进程: ${input.name}`,
    input.parent ? `启动者: ${input.parent}` : null,
    `PID: ${input.pids.length > 0 ? input.pids.join(", ") : "—"}`,
    `端口: ${input.ports.length > 0 ? input.ports.join(", ") : "—"}`,
    `状态: ${input.running ? "运行中" : "已退出"}`,
    `上传: ${formatBytes(input.bytesIn)}`,
    `下载: ${formatBytes(input.bytesOut)}`,
    `总计: ${formatBytes(input.bytesIn + input.bytesOut)}`,
    `命令: ${input.command}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
