import { Menu } from "@base-ui/react/menu"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  EthernetPortIcon,
  FlowConnectionIcon,
  Globe02Icon,
  MoreHorizontalIcon,
  RefreshIcon,
  Search01Icon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons"
import { Fragment, useMemo, useState, type ReactNode } from "react"
import { formatTimestamp } from "@shared/format"
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Input } from "@web/components/ui/input"
import { ScrollArea } from "@web/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { cn } from "@web/lib/utils"
import type {
  PortBinding,
  PortGroup,
} from "@web/features/ports/mock-data"
import {
  PORT_VIEWS,
  REFRESH_INTERVAL_SECONDS,
  usePorts,
  type PortExposureFilter,
  type PortProtocolFilter,
  type PortScopeFilter,
} from "@web/features/ports/usePorts"

const PROTOCOL_OPTIONS: { value: PortProtocolFilter; label: string }[] = [
  { value: "all", label: "全部协议" },
  { value: "TCP", label: "TCP" },
  { value: "UDP", label: "UDP" },
]

const SCOPE_OPTIONS: { value: PortScopeFilter; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "listening", label: "仅监听" },
  { value: "connected", label: "仅连接" },
]

const EXPOSURE_OPTIONS: { value: PortExposureFilter; label: string }[] = [
  { value: "all", label: "全部范围" },
  { value: "local", label: "仅本机" },
  { value: "exposed", label: "对外暴露" },
]

export const PortsPage = () => {
  const model = usePorts()

  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string
    description: string
    confirmText: string
    onConfirm: () => void
  } | null>(null)

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      model.notify("已复制到剪贴板")
    } catch {
      model.notify("复制失败：浏览器拒绝了剪贴板访问")
    }
  }

  const refreshedText = useMemo(
    () => formatTimestamp(Math.floor(model.refreshedAt / 1000)),
    [model.refreshedAt]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon icon={EthernetPortIcon} className="size-4" />
          <h1 className="text-sm font-medium">端口管理</h1>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={model.search}
                onChange={(event) => model.setSearch(event.target.value)}
                placeholder="搜索端口 / 进程 / 命令 / 项目"
                className="h-7 w-64 pl-7"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={model.autoRefresh}
                onChange={(event) =>
                  model.setAutoRefresh(event.target.checked)
                }
              />
              自动刷新（{REFRESH_INTERVAL_SECONDS}s）
            </label>
            <Button size="sm" variant="outline" onClick={model.refresh}>
              <HugeiconsIcon icon={RefreshIcon} />
              刷新
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="监听端口"
            value={String(model.totals.listening)}
            description={`共 ${model.totals.bindings} 个套接字绑定`}
          />
          <StatCard
            title="已建立连接"
            value={String(model.totals.connected)}
            description="按对端服务端口聚合"
          />
          <StatCard
            title="对外暴露"
            value={String(model.totals.exposed)}
            description="监听在所有网卡，局域网可访问"
          />
          <StatCard
            title="涉及进程"
            value={String(model.totals.processCount)}
            description="当前筛选结果内的进程数"
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-52 shrink-0 flex-col border-r">
          <div className="border-b px-3 py-2 text-xs font-medium">快捷视图</div>
          <ScrollArea className="min-h-0 flex-1">
            {PORT_VIEWS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => model.setView(item.key)}
                className={cn(
                  "flex w-full items-center justify-between border-b px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50",
                  model.view === item.key && "bg-muted font-medium"
                )}
              >
                <span>{item.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {model.viewCounts[item.key]}
                </span>
              </button>
            ))}
          </ScrollArea>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-4 border-b px-4 py-2">
            <FilterGroup
              label="协议"
              options={PROTOCOL_OPTIONS}
              value={model.protocol}
              onChange={model.setProtocol}
            />
            <FilterGroup
              label="状态"
              options={SCOPE_OPTIONS}
              value={model.scope}
              onChange={model.setScope}
            />
            <FilterGroup
              label="范围"
              options={EXPOSURE_OPTIONS}
              value={model.exposure}
              onChange={model.setExposure}
            />
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[1%] whitespace-nowrap">
                    <SortButton
                      label="端口"
                      active={model.sortKey === "port"}
                      descending={model.descending}
                      onClick={() => model.toggleSort("port")}
                    />
                  </TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">
                    <SortButton
                      label="服务"
                      active={model.sortKey === "service"}
                      descending={model.descending}
                      onClick={() => model.toggleSort("service")}
                    />
                  </TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">
                    监听地址
                  </TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">
                    进程
                  </TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">
                    <SortButton
                      label="PID"
                      active={model.sortKey === "processCount"}
                      descending={model.descending}
                      onClick={() => model.toggleSort("processCount")}
                    />
                  </TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">
                    启动者
                  </TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">
                    状态
                  </TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">
                    暴露
                  </TableHead>
                  <TableHead className="w-full">命令</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.groups.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-10 text-center text-muted-foreground"
                    >
                      没有匹配的端口，换个关键词或调整筛选条件。
                    </TableCell>
                  </TableRow>
                ) : null}
                {model.groups.map((group) => {
                  const open = model.isExpanded(group.port)
                  return (
                    <Fragment key={group.port}>
                      <TableRow
                        className={cn(
                          "cursor-pointer",
                          model.selected === group.port && "bg-muted/60"
                        )}
                        onClick={() => model.select(group.port)}
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
                              icon={
                                open ? ArrowDown01Icon : ArrowRight01Icon
                              }
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
                        <TableCell>
                          {group.processNames.join(", ")}
                        </TableCell>
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
                        <TableCell
                          className="max-w-0 truncate text-muted-foreground"
                          title={group.bindings[0]?.command}
                        >
                          {group.bindings[0]?.command}
                        </TableCell>
                        <TableCell>
                          <RowActions
                            actions={[
                              {
                                label: "复制整行信息",
                                icon: Copy01Icon,
                                onSelect: () =>
                                  void copyText(
                                    buildGroupText(group, model.view)
                                  ),
                              },
                              {
                                label: "复制 PID",
                                icon: Copy01Icon,
                                onSelect: () =>
                                  void copyText(group.pids.join(", ")),
                              },
                              {
                                label: "结束进程",
                                icon: Delete02Icon,
                                onSelect: () =>
                                  setPendingConfirm({
                                    title: `结束端口 ${group.port} 上的 ${group.pids.length} 个进程？`,
                                    description: `进程：${group.processNames.join(", ")}；PID：${group.pids.join(", ")}。进程被结束后不可恢复。`,
                                    confirmText: "结束进程",
                                    onConfirm: () =>
                                      model.terminate(
                                        group.port,
                                        group.pids
                                      ),
                                  }),
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>

                      {open ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={10} className="bg-muted/20 p-0">
                            <div className="flex flex-col divide-y divide-border/60 border-b">
                              {group.bindings.map((item) => (
                                <BindingDetail
                                  key={item.key}
                                  binding={item}
                                  onCopy={copyText}
                                />
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>
          当前显示 {model.groups.length} 个端口 /{" "}
          {model.groups.reduce((sum, group) => sum + group.bindings.length, 0)}{" "}
          个套接字
        </span>
        {model.notice ? (
          <span className="text-foreground">{model.notice}</span>
        ) : null}
        <span className="ml-auto">
          {model.autoRefresh
            ? `自动刷新（每 ${REFRESH_INTERVAL_SECONDS} 秒）`
            : "自动刷新已关闭"}
          {" · 上次更新 "}
          {refreshedText}
        </span>
      </footer>

      <AlertDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pendingConfirm?.onConfirm()
                setPendingConfirm(null)
              }}
            >
              {pendingConfirm?.confirmText ?? "确认"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 展开后的单个套接字绑定详情，展示聚合行看不到的字段。 */
const BindingDetail = (props: {
  binding: PortBinding
  onCopy: (text: string) => Promise<void>
}) => {
  const { binding: item } = props
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-1 px-4 py-2 pl-10 text-xs">
      <Field label="协议">
        {item.protocol} · {item.family}
      </Field>
      <Field label="地址">{item.address}</Field>
      <Field label="对端">{item.peer ?? "—"}</Field>
      <Field label="用户">{item.user}</Field>
      <Field label="PID">{item.pid}</Field>
      <Field label="启动者">{item.startedBy}</Field>
      <Field label="状态">
        <StateBadge state={item.state} />
      </Field>
      <Field label="启动时间">
        {formatTimestamp(item.startedAt)}
      </Field>
      <Field label="工作目录" wide>
        {item.cwd}
      </Field>
      <Field label="命令" wide>
        <span className="break-all">{item.command}</span>
      </Field>
      <div className="ml-auto self-center">
        <RowActions
          title="绑定操作"
          actions={[
            {
              label: "复制命令",
              icon: Copy01Icon,
              onSelect: () => void props.onCopy(item.command),
            },
            {
              label: "复制 PID",
              icon: Copy01Icon,
              onSelect: () => void props.onCopy(String(item.pid)),
            },
            {
              label: "复制工作目录",
              icon: Copy01Icon,
              onSelect: () => void props.onCopy(item.cwd),
            },
          ]}
        />
      </div>
    </div>
  )
}

const Field = (props: { label: string; wide?: boolean; children: ReactNode }) => (
  <span className={cn("flex gap-1", props.wide && "w-full")}>
    <span className="shrink-0 text-muted-foreground">{props.label}</span>
    <span className="min-w-0 text-foreground">{props.children}</span>
  </span>
)

type RowActionItem = {
  label: string
  icon?: typeof Copy01Icon
  disabled?: boolean
  onSelect: () => void
}

/** 行尾操作菜单：后续新增的操作都加在这里。 */
const RowActions = (props: { actions: RowActionItem[]; title?: string }) => (
  <Menu.Root>
    <Menu.Trigger
      render={
        <Button size="icon-sm" variant="ghost" title={props.title ?? "操作"}>
          <HugeiconsIcon icon={MoreHorizontalIcon} />
        </Button>
      }
    />
    <Menu.Portal>
      <Menu.Positioner sideOffset={4} align="end">
        <Menu.Popup className="z-50 min-w-44 rounded-md border bg-popover p-1 text-xs shadow-md">
          {props.actions.map((action) => (
            <Menu.Item
              key={action.label}
              disabled={action.disabled}
              onClick={action.onSelect}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50"
            >
              {action.icon ? (
                <HugeiconsIcon icon={action.icon} className="size-3.5" />
              ) : null}
              {action.label}
            </Menu.Item>
          ))}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
)

const FilterGroup = <T extends string>(props: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) => (
  <div className="flex items-center gap-1">
    <span className="text-xs text-muted-foreground">{props.label}</span>
    {props.options.map((option) => (
      <Button
        key={option.value}
        size="xs"
        variant={props.value === option.value ? "secondary" : "ghost"}
        onClick={() => props.onChange(option.value)}
      >
        {option.label}
      </Button>
    ))}
  </div>
)

const SortButton = (props: {
  label: string
  active: boolean
  descending: boolean
  onClick: () => void
}) => (
  <Button
    size="xs"
    variant={props.active ? "secondary" : "ghost"}
    className="-ml-2"
    onClick={props.onClick}
  >
    {props.label}
    {props.active ? (
      <span className="text-[0.625rem]">{props.descending ? "▼" : "▲"}</span>
    ) : null}
  </Button>
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

type StatCardProps = {
  title: string
  value: string
  description: string
}

const StatCard = (props: StatCardProps) => (
  <Card className="gap-1 py-3">
    <CardHeader className="px-4">
      <CardDescription>{props.title}</CardDescription>
      <CardTitle className="text-lg tabular-nums">{props.value}</CardTitle>
    </CardHeader>
    <CardContent className="px-4">
      <p className="text-xs text-muted-foreground">{props.description}</p>
    </CardContent>
  </Card>
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
