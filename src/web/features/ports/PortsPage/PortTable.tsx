import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Copy01Icon,
  Delete02Icon,
  FlowConnectionIcon,
  Globe02Icon,
  MoreHorizontalIcon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { PortBinding } from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@web/components/ui/item"
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
import type { PortGroup } from "@web/features/ports/domain"
import type { usePorts } from "@web/features/ports/usePorts"
import { cn } from "@web/lib/utils"
import { Fragment, type ReactNode, useMemo, useState } from "react"

type SortKey = "port" | "service" | "processCount"

type PortTableProps = {
  model: ReturnType<typeof usePorts>
  onCopy: (text: string) => void
  onRequestKill: (port: number, pids: number[], names: string[]) => void
}

/** 右栏：按端口聚合的绑定表，行可展开查看每个套接字。 */
export const PortTable = (props: PortTableProps) => {
  const { model, onCopy, onRequestKill } = props
  const [sortKey, setSortKey] = useState<SortKey>("port")
  const [descending, setDescending] = useState(false)

  const sortedGroups = useMemo(() => {
    const factor = descending ? -1 : 1
    return [...model.groups].sort((left, right) => {
      if (sortKey === "port") return (left.port - right.port) * factor
      if (sortKey === "processCount") {
        return (left.pids.length - right.pids.length) * factor
      }
      return left.service.label.localeCompare(right.service.label) * factor
    })
  }, [model.groups, sortKey, descending])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((previous) => !previous)
      return
    }
    setSortKey(key)
    setDescending(key !== "port")
  }

  if (sortedGroups.length === 0) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>没有匹配的端口</EmptyTitle>
            <EmptyDescription>
              换个关键词，或调整协议、状态、范围筛选。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[1%] whitespace-nowrap">
              <SortButton
                label="端口"
                active={sortKey === "port"}
                descending={descending}
                onClick={() => toggleSort("port")}
              />
            </TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">
              <SortButton
                label="服务"
                active={sortKey === "service"}
                descending={descending}
                onClick={() => toggleSort("service")}
              />
            </TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">监听地址</TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">进程</TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">
              <SortButton
                label="PID"
                active={sortKey === "processCount"}
                descending={descending}
                onClick={() => toggleSort("processCount")}
              />
            </TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">启动者</TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">状态</TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">暴露</TableHead>
            <TableHead className="w-full">命令</TableHead>
            <TableHead className="w-[1%]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedGroups.map((group) => {
            const open = model.isExpanded(group.port)
            return (
              <Fragment key={group.port}>
                <TableRow
                  className={cn(
                    "cursor-pointer",
                    model.selectedPort === group.port && "bg-muted/60"
                  )}
                  onClick={() =>
                    model.selectPort(
                      model.selectedPort === group.port ? null : group.port
                    )
                  }
                >
                  <TableCell className="font-medium tabular-nums">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-left hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation()
                        model.toggleExpanded(group.port)
                      }}
                    >
                      <HugeiconsIcon
                        icon={open ? ArrowDown01Icon : ArrowRight01Icon}
                        className="size-3.5 text-muted-foreground"
                      />
                      {group.port}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{group.service.label}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {group.addresses.join(" · ")}
                  </TableCell>
                  <TableCell>{group.processNames.join(", ")}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {group.pids.join(", ")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {group.starters.join(", ")}
                  </TableCell>
                  <TableCell>
                    <StateBadge state={group.state} />
                  </TableCell>
                  <TableCell>
                    <ExposureBadge
                      exposed={group.exposed}
                      state={group.state}
                    />
                  </TableCell>
                  <TableCell className="max-w-0 truncate text-muted-foreground">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="block truncate">
                            {group.bindings[0]?.command}
                          </span>
                        }
                      />
                      <TooltipContent className="max-w-lg break-all">
                        {group.bindings[0]?.command}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <RowActions
                      onCopy={() => onCopy(buildGroupText(group, model.view))}
                      onCopyPids={() => onCopy(group.pids.join(", "))}
                      onKill={() =>
                        onRequestKill(
                          group.port,
                          group.pids,
                          group.processNames
                        )
                      }
                    />
                  </TableCell>
                </TableRow>

                {open ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={10} className="bg-muted/20 p-0">
                      <ItemGroup className="gap-1 p-2 pl-8">
                        {group.bindings.map((item) => (
                          <BindingDetail
                            key={item.key}
                            binding={item}
                            onCopy={onCopy}
                          />
                        ))}
                      </ItemGroup>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}

/** 展开后的单个套接字绑定，展示聚合行看不到的字段。 */
const BindingDetail = (props: {
  binding: PortBinding
  onCopy: (text: string) => void
}) => {
  const { binding: item } = props
  return (
    <Item variant="muted" size="xs" className="rounded-md">
      <ItemContent>
        <ItemTitle>
          <Badge variant="outline">
            {item.protocol} · {item.family}
          </Badge>
          <span className="font-mono">{item.address}</span>
          {item.peer ? (
            <span className="font-mono text-muted-foreground">
              → {item.peer}
            </span>
          ) : null}
          <StateBadge state={item.state} />
        </ItemTitle>
        <ItemDescription className="flex flex-wrap gap-x-4">
          <span>用户 {item.user}</span>
          <span>PID {item.pid}</span>
          <span>启动者 {item.startedBy}</span>
          <span>启动于 {formatTimestamp(item.startedAt)}</span>
          <span>目录 {item.cwd}</span>
        </ItemDescription>
        <ItemDescription className="break-all">
          命令 {item.command}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="icon-sm" variant="ghost" title="绑定操作">
                <HugeiconsIcon icon={MoreHorizontalIcon} />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => props.onCopy(item.command)}>
              <HugeiconsIcon icon={Copy01Icon} />
              复制命令
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => props.onCopy(String(item.pid))}>
              <HugeiconsIcon icon={Copy01Icon} />
              复制 PID
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => props.onCopy(item.cwd)}>
              <HugeiconsIcon icon={Copy01Icon} />
              复制工作目录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  )
}

type RowActionsProps = {
  onCopy: () => void
  onCopyPids: () => void
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
      <DropdownMenuItem onClick={props.onCopyPids}>
        <HugeiconsIcon icon={Copy01Icon} />
        复制 PID
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={props.onKill}>
        <HugeiconsIcon icon={Delete02Icon} />
        结束进程
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)

const StateBadge = (props: { state: PortBinding["state"] }) => {
  const text =
    props.state === "LISTEN"
      ? "监听中"
      : props.state === "ESTABLISHED"
        ? "已连接"
        : "UDP"
  return (
    <Badge
      variant={props.state === "LISTEN" ? "secondary" : "outline"}
      className={cn(props.state === "LISTEN" && "text-emerald-600")}
    >
      {text}
    </Badge>
  )
}

/** 对外暴露用橙色强调，出站连接用蓝色，仅本机用中性色。 */
const ExposureBadge = (props: {
  exposed: boolean
  state: PortBinding["state"]
}) => {
  if (props.state === "ESTABLISHED") {
    return (
      <Badge variant="outline" className="gap-1 text-sky-600">
        <HugeiconsIcon icon={FlowConnectionIcon} className="size-3" />
        出站连接
      </Badge>
    )
  }
  return props.exposed ? (
    <Badge
      variant="outline"
      className="gap-1 border-orange-500/40 text-orange-600"
    >
      <HugeiconsIcon icon={Globe02Icon} className="size-3" />
      对外暴露
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <HugeiconsIcon icon={SquareLock01Icon} className="size-3" />
      仅本机
    </Badge>
  )
}

type SortButtonProps = {
  label: ReactNode
  active: boolean
  descending: boolean
  onClick: () => void
}

const SortButton = (props: SortButtonProps) => (
  <Button
    size="xs"
    variant={props.active ? "secondary" : "ghost"}
    className="-ml-2"
    onClick={props.onClick}
  >
    {props.label}
    {props.active ? (
      <HugeiconsIcon
        icon={props.descending ? ArrowDown01Icon : ArrowUp01Icon}
        className="size-3"
      />
    ) : null}
  </Button>
)

/** 复制给 AI 分析用的整段端口信息。 */
const buildGroupText = (group: PortGroup, view: string): string => {
  const exposure =
    group.state === "ESTABLISHED"
      ? "出站连接"
      : group.exposed
        ? "对外暴露"
        : "仅本机"
  const lines = [
    `端口: ${group.port}`,
    `服务: ${group.service.label}`,
    `分类: ${group.category}`,
    `范围: ${view}`,
    `监听地址: ${group.addresses.join(", ")}`,
    `协议: ${group.protocols.join(", ")}`,
    `进程: ${group.processNames.join(", ")}`,
    `PID: ${group.pids.join(", ")}`,
    `启动者: ${group.starters.join(", ")}`,
    `状态: ${group.state}`,
    `暴露: ${exposure}`,
    "",
    "绑定明细:",
  ]
  for (const item of group.bindings) {
    lines.push(
      `- ${item.protocol}/${item.family} ${item.address}` +
        (item.peer ? ` → ${item.peer}` : "") +
        ` | pid ${item.pid} ${item.processName} | ${item.startedBy} | ${item.command} | cwd ${item.cwd}`
    )
  }
  return lines.join("\n")
}
