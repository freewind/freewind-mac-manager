import type {
  ServiceDomain,
  ServiceState,
  SystemService,
} from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import { PageHeader } from "@web/components/PageHeader"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  AlertDialog,
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
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
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
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "@web/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@web/components/ui/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@web/components/ui/item"
import { ScrollArea } from "@web/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import { Skeleton } from "@web/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
import type { ServiceAction } from "@web/features/system-services/actions"
import { domainLabels, stateLabels } from "@web/features/system-services/labels"
import type {
  DomainFilter,
  StateFilter,
} from "@web/features/system-services/store"
import {
  type PendingAction,
  useSystemServices,
} from "@web/features/system-services/useSystemServices"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CircleCheck,
  Copy,
  FolderOpen,
  Link,
  type LucideIcon,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Shield,
  Square,
  Trash2,
} from "lucide-react"
import { useState } from "react"

const STATE_ORDER: ServiceState[] = ["running", "stopped", "failed", "disabled"]

const DOMAIN_ORDER: ServiceDomain[] = ["user", "global", "system"]

const ACTION_LABELS: Record<ServiceAction, string> = {
  start: "启动",
  stop: "停止",
  restart: "重启",
  load: "加载",
  unload: "卸载",
  disable: "禁用",
  enable: "启用",
}

const CONFIRM_TEXTS: Record<ServiceAction, { detail: string; ok: string }> = {
  start: { detail: "服务会立即开始运行。", ok: "启动" },
  stop: {
    detail:
      "服务会立即退出；若 plist 里 KeepAlive 为真，launchd 会再次拉起它。",
    ok: "停止",
  },
  restart: {
    detail: "服务会被强制结束并立刻重新启动，正在处理的请求会中断。",
    ok: "重启",
  },
  load: {
    detail: "把 plist 重新 bootstrap 到当前域并立即启动。",
    ok: "加载",
  },
  unload: {
    detail: "服务会停止运行，plist 文件移入废纸篓，可在废纸篓里找回。",
    ok: "卸载",
  },
  disable: {
    detail: "服务会停止运行，并且下次登录或开机不再自动启动。",
    ok: "禁用",
  },
  enable: { detail: "服务下次登录时会自动启动。", ok: "启用" },
}

const STATE_ICONS: Record<ServiceState, LucideIcon> = {
  running: CircleCheck,
  stopped: Square,
  failed: AlertTriangle,
  disabled: Ban,
}

const STATE_ICON_CLASSES: Record<ServiceState, string> = {
  running: "text-emerald-600 dark:text-emerald-400",
  stopped: "text-muted-foreground",
  failed: "text-destructive",
  disabled: "text-muted-foreground/60",
}

/** 状态图标：按服务状态取 lucide 组件，颜色跟随状态样式。 */
const ServiceStateIcon = ({ state }: { state: ServiceState }) => {
  const Icon = STATE_ICONS[state]
  return <Icon className={STATE_ICON_CLASSES[state]} />
}

/** 每个动作在当前状态下是否可用，以及不可用的原因。 */
const actionAvailability = (
  service: SystemService,
  action: ServiceAction
): { disabled: boolean; reason: string | null } => {
  if (service.requiresRoot) {
    return { disabled: true, reason: "位于系统域，需要 root 权限" }
  }
  const running = service.state === "running"
  if (action === "start") {
    return running
      ? { disabled: true, reason: "服务已在运行" }
      : { disabled: false, reason: null }
  }
  if (action === "stop" || action === "restart") {
    return running
      ? { disabled: false, reason: null }
      : { disabled: true, reason: "服务未运行" }
  }
  if (action === "load") {
    return service.loaded && service.exists
      ? { disabled: true, reason: "服务已在域中加载" }
      : { disabled: false, reason: null }
  }
  if (action === "unload") {
    return service.loaded && service.exists
      ? { disabled: false, reason: null }
      : { disabled: true, reason: "服务未加载，或 plist 已不在原处" }
  }
  if (action === "disable") {
    return service.disabled
      ? { disabled: true, reason: "服务已禁用" }
      : { disabled: false, reason: null }
  }
  return service.disabled
    ? { disabled: false, reason: null }
    : { disabled: true, reason: "服务未处于禁用状态" }
}

const stateBadge = (state: ServiceState) => {
  if (state === "running") {
    return (
      <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">
        {stateLabels.running}
      </Badge>
    )
  }
  if (state === "failed") {
    return <Badge variant="destructive">{stateLabels.failed}</Badge>
  }
  if (state === "disabled") {
    return <Badge variant="ghost">{stateLabels.disabled}</Badge>
  }
  return <Badge variant="outline">{stateLabels.stopped}</Badge>
}

const summaryOf = (service: SystemService): string => {
  if (service.pid !== null) return `pid ${service.pid}`
  if (!service.exists) return "plist 已移入废纸篓"
  if (service.state === "failed") {
    return `上次退出码 ${service.lastExitCode ?? "—"}`
  }
  if (service.state === "disabled") return "未加载，开机不启动"
  if (!service.loaded) return "未加载"
  return "未运行"
}

/** 详细筛选收起时，摘要仍要说明当前的状态与域条件。 */
const filterSummaryOf = (
  state: StateFilter,
  domain: DomainFilter,
  count: number
): string => {
  const stateText = state === "all" ? "全部" : stateLabels[state]
  const domainText = domain === "all" ? "全部" : domainLabels[domain]
  return `状态 ${stateText} · 域 ${domainText} · 显示 ${count} 个`
}

/**
 * 启动命令由 plist 元数据里的程序路径与参数拼出，两者都来自已有接口；
 * 前端不补编造别处没有的参数，契约没暴露的参数也不会出现。
 */
const launchCommandOf = (service: {
  program: string
  args: string[]
}): string => [service.program, ...service.args].filter(Boolean).join(" ")

const MetadataField = (props: { label: string; children: React.ReactNode }) => (
  <Field orientation="horizontal" className="gap-2 min-w-0">
    <FieldLabel className="w-24 shrink-0 text-muted-foreground lg:w-36">
      {props.label}
    </FieldLabel>
    <FieldContent className="text-xs min-w-0 overflow-x-auto whitespace-nowrap">
      {props.children}
    </FieldContent>
  </Field>
)

export const SystemServicesPage = () => {
  const model = useSystemServices()
  const submission = useDialogSubmit(model.cancelPending, model.isPending)
  useHistoryOverlay(model.pending !== null, model.cancelPending)
  const service = model.selected
  const launchCommand = service === null ? "" : launchCommandOf(service)
  const pending: PendingAction | null = model.pending

  const isDesktop = useIsDesktop()
  /** 手机上详情进 Sheet：默认只显示列表，点选后才打开。 */
  const [detailOpen, setDetailOpen] = useState(false)
  // 系统返回先关详情 Sheet，再退页面（与任务 48/52 同一做法）。
  useHistoryOverlay(!isDesktop && detailOpen, () => setDetailOpen(false))
  /** 状态与域的详细筛选按需展开，搜索与筛选摘要常驻。 */
  const [filtersOpen, setFiltersOpen] = useState(false)
  /** 记住 plist 面板属于哪个服务：切换服务就自动收起，不用额外副作用。 */
  const [plistOpenLabel, setPlistOpenLabel] = useState<string | null>(null)

  const selectService = (label: string) => {
    model.selectService(label)
    if (!isDesktop) setDetailOpen(true)
  }

  const actionButton = (action: ServiceAction, Icon: LucideIcon) => {
    if (!service) return null
    const availability = actionAvailability(service, action)
    return (
      <ActionButton
        busy={model.isPending}
        busyLabel="执行中…"
        key={action}
        variant={
          action === "unload" || action === "stop" ? "outline" : "secondary"
        }
        size="sm"
        disabled={availability.disabled || model.isPending}
        title={availability.reason ?? undefined}
        onClick={() => model.requestAction(action, service)}
      >
        <Icon />
        {ACTION_LABELS[action]}
      </ActionButton>
    )
  }

  /** 详情只有一个定义：桌面右列与手机 Sheet 二选一渲染，不做两套挂载。 */
  const detailBody = model.isLoading ? (
    <div className="flex flex-col gap-3 px-4 py-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  ) : service ? (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 服务身份与主要操作固定：滚动元数据、切换服务都不影响它们 */}
      <Card className="rounded-none border-x-0 border-t-0">
        <CardHeader>
          <CardTitle>{service.label}</CardTitle>
          <CardDescription className="font-mono">
            {service.program}
          </CardDescription>
          <CardAction className="flex flex-wrap items-center gap-1.5">
            {stateBadge(service.state)}
            <Badge variant="outline">{domainLabels[service.domain]}域</Badge>
            {service.requiresRoot ? (
              <Badge variant="outline" className="text-muted-foreground">
                需 root
              </Badge>
            ) : null}
            {service.disabled ? (
              <Badge variant="outline">launchctl 已禁用</Badge>
            ) : null}
            {!service.exists ? (
              <Badge variant="outline">plist 已移入废纸篓</Badge>
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {actionButton("start", Play)}
            {actionButton("stop", Square)}
            {actionButton("restart", RefreshCw)}
            {actionButton("load", Link)}
            {actionButton("unload", Trash2)}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="更多操作"
                    disabled={service.requiresRoot || model.isPending}
                    title={
                      service.requiresRoot
                        ? "位于系统域，需要 root 权限"
                        : undefined
                    }
                  >
                    <MoreHorizontal />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => model.requestAction("disable", service)}
                  disabled={service.disabled || model.isPending}
                >
                  <Ban />
                  禁用（开机不启动）
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => model.requestAction("enable", service)}
                  disabled={!service.disabled || model.isPending}
                >
                  <CircleCheck />
                  启用（恢复开机启动）
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => model.copy(service.filePath, " plist 路径")}
                >
                  <Copy />
                  复制 plist 路径
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => model.copy(service.plist, " plist 内容")}
                >
                  <Copy />
                  复制 plist 内容
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={launchCommand === ""}
                  onClick={() => model.copy(launchCommand, "启动命令")}
                >
                  <Copy />
                  复制启动命令
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={model.isPending}
                  onClick={() => model.reveal(service)}
                >
                  <FolderOpen />
                  在访达中显示
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {service.requiresRoot ? (
            <p className="text-xs text-muted-foreground">
              该系统域服务由 root 管理，此处只提供查看、复制与访达定位。
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* 元数据与原文随详情滚动；切换服务重建容器，滚动位置回到顶部 */}
      <div key={service.label} className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="flex flex-col gap-3 px-4 py-3">
          <Card>
            <CardHeader>
              <CardTitle>服务元数据</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
                <MetadataField label="plist 路径">
                  <span className="font-mono">{service.filePath}</span>
                </MetadataField>
                <MetadataField label="参数">
                  <span className="font-mono">
                    {service.args.length > 0 ? service.args.join(" ") : "—"}
                  </span>
                </MetadataField>
                <MetadataField label="启动命令">
                  {launchCommand === "" ? (
                    "—"
                  ) : (
                    <span className="flex min-w-0 items-center gap-1">
                      {/* 参数里没有可执行文件，这里补全成一条完整命令：格子内截断，悬停看全文。 */}
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="min-w-0 truncate font-mono">
                              {launchCommand}
                            </span>
                          }
                        />
                        <TooltipContent className="max-w-lg break-all">
                          {launchCommand}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  )}
                </MetadataField>
                <MetadataField label="工作目录">
                  <span className="font-mono">
                    {service.workingDirectory ?? "—"}
                  </span>
                </MetadataField>
                <MetadataField label="RunAtLoad">
                  {service.runAtLoad ? "是（加载即启动）" : "否"}
                </MetadataField>
                <MetadataField label="KeepAlive">
                  {service.keepAlive ? "是（退出后自动拉起）" : "否"}
                </MetadataField>
                <MetadataField label="StartInterval">
                  {service.startInterval === null
                    ? "—"
                    : `每 ${service.startInterval} 秒`}
                </MetadataField>
                <MetadataField label="ProcessType">
                  {service.processType ?? "—"}
                </MetadataField>
                <MetadataField label="ThrottleInterval">
                  {service.throttleInterval === null
                    ? "—"
                    : `${service.throttleInterval} 秒`}
                </MetadataField>
                <MetadataField label="PID">
                  {service.pid === null ? "—" : service.pid}
                </MetadataField>
                <MetadataField label="本次启动时间">
                  {service.startedAt === null
                    ? "—"
                    : formatTimestamp(service.startedAt)}
                </MetadataField>
                <MetadataField label="上次退出码">
                  {service.lastExitCode === null ? "—" : service.lastExitCode}
                </MetadataField>
                <MetadataField label="标准输出">
                  <span className="font-mono">{service.stdoutPath ?? "—"}</span>
                </MetadataField>
                <MetadataField label="标准错误">
                  <span className="font-mono">{service.stderrPath ?? "—"}</span>
                </MetadataField>
                <MetadataField label="加载状态">
                  {service.loaded ? "已加载到域中" : "未加载"}
                </MetadataField>
                <MetadataField label="环境变量">
                  <span className="font-mono">
                    {Object.keys(service.environment).length === 0
                      ? "—"
                      : Object.entries(service.environment)
                          .map(([key, value]) => `${key}=${value}`)
                          .join("  ")}
                  </span>
                </MetadataField>
              </FieldGroup>
            </CardContent>
          </Card>

          <Collapsible
            open={plistOpenLabel === service.label}
            onOpenChange={(open) =>
              setPlistOpenLabel(open ? service.label : null)
            }
          >
            <Card>
              <CardHeader>
                <CardTitle>plist 原文</CardTitle>
                <CardDescription>
                  {service.exists ? "文件位于磁盘" : "该文件已移入废纸篓"}
                </CardDescription>
                <CardAction className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => model.copy(service.plist, " plist 内容")}
                  >
                    <Copy />
                    复制内容
                  </Button>
                  <ActionButton
                    busy={model.revealing}
                    busyLabel="定位中…"
                    disabled={model.isPending}
                    variant="outline"
                    size="xs"
                    onClick={() => model.reveal(service)}
                  >
                    <FolderOpen />
                    访达定位
                  </ActionButton>
                  {/* 原文默认收起：需要的时侯再展开，面板自己的滚动不变 */}
                  <CollapsibleTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-expanded={plistOpenLabel === service.label}
                      >
                        {plistOpenLabel === service.label ? (
                          <ArrowUp aria-hidden="true" />
                        ) : (
                          <ArrowDown aria-hidden="true" />
                        )}
                        {plistOpenLabel === service.label
                          ? "收起原文"
                          : "查看原文"}
                      </Button>
                    }
                  />
                </CardAction>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  <div className="max-h-80 overflow-auto rounded-md border bg-muted/30">
                    <pre className="w-max min-w-full p-3 font-mono text-[0.6875rem] leading-relaxed whitespace-pre">
                      {service.plist}
                    </pre>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>
    </div>
  ) : (
    <div className="flex flex-1 items-center justify-center">
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangle />
          </EmptyMedia>
          <EmptyTitle>没有可显示的服务</EmptyTitle>
          <EmptyDescription>
            左侧列表里挑一个服务，或点「重新读取」再试。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <PageHeader title="系统服务" loading={model.isLoading} />
          <Badge variant="outline">共 {model.stats.total}</Badge>
          <Badge variant="ghost">运行 {model.stats.running}</Badge>
          <Badge variant="ghost">已停止 {model.stats.stopped}</Badge>
          <Badge variant="ghost">失败 {model.stats.failed}</Badge>
          <Badge variant="ghost">禁用 {model.stats.disabled}</Badge>
          <Badge variant="ghost">需 root {model.stats.requiresRoot}</Badge>
          {model.skipped.length > 0 ? (
            <Badge variant="ghost" title={model.skipped[0]?.reason}>
              跳过 {model.skipped.length}
            </Badge>
          ) : null}
          {model.isFetching ? <Badge variant="ghost">读取中…</Badge> : null}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={model.refresh}
          >
            <RefreshCw />
            重新读取
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="w-full md:w-80">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={model.keyword}
              onChange={(event) => model.setKeyword(event.target.value)}
              placeholder="搜索 label、程序或 plist 路径"
            />
          </InputGroup>
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <CollapsibleTrigger
              render={
                <Button variant="outline" size="sm" aria-expanded={filtersOpen}>
                  {filtersOpen ? (
                    <ArrowUp aria-hidden="true" />
                  ) : (
                    <ArrowDown aria-hidden="true" />
                  )}
                  详细筛选
                </Button>
              }
            />
            {/* 默认收起，展开后占满一行，不挤压搜索框。 */}
            <CollapsibleContent className="flex w-full flex-wrap items-center gap-2">
              <ToggleGroup
                variant="outline"
                size="sm"
                className="flex-wrap"
                value={[model.stateFilter]}
                onValueChange={(values) =>
                  model.setStateFilter((values[0] ?? "all") as StateFilter)
                }
              >
                <ToggleGroupItem value="all">全部状态</ToggleGroupItem>
                {STATE_ORDER.map((state) => (
                  <ToggleGroupItem key={state} value={state}>
                    {stateLabels[state]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <ToggleGroup
                variant="outline"
                size="sm"
                className="flex-wrap"
                value={[model.domainFilter]}
                onValueChange={(values) =>
                  model.setDomainFilter((values[0] ?? "all") as DomainFilter)
                }
              >
                <ToggleGroupItem value="all">全部域</ToggleGroupItem>
                {DOMAIN_ORDER.map((domain) => (
                  <ToggleGroupItem key={domain} value={domain}>
                    {domainLabels[domain]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </CollapsibleContent>
          </Collapsible>
          <span className="text-xs text-muted-foreground">
            {filterSummaryOf(
              model.stateFilter,
              model.domainFilter,
              model.filtered.length
            )}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <aside className="flex min-h-0 w-full flex-1 flex-col border-b md:w-80 md:flex-none md:border-r md:border-b-0">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
            服务列表
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <ItemGroup className="gap-0.5 px-2 pb-2">
              {model.filtered.map((item) => (
                <Item
                  key={item.label}
                  render={
                    <button
                      type="button"
                      onClick={() => selectService(item.label)}
                    />
                  }
                  variant={
                    model.selectedLabel === item.label ? "muted" : "default"
                  }
                  size="xs"
                  className="cursor-pointer"
                >
                  <ItemMedia variant="icon">
                    <ServiceStateIcon state={item.state} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{item.label}</ItemTitle>
                    <ItemDescription>
                      {domainLabels[item.domain]} · {summaryOf(item)}
                    </ItemDescription>
                  </ItemContent>
                  {item.requiresRoot ? (
                    <ItemActions>
                      <Shield className="size-3 text-muted-foreground" />
                    </ItemActions>
                  ) : null}
                </Item>
              ))}
            </ItemGroup>
            {model.filtered.length === 0 ? (
              <Empty className="mx-2 py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Search />
                  </EmptyMedia>
                  <EmptyTitle>没有符合条件的服务</EmptyTitle>
                  <EmptyDescription>
                    换一个搜索词，或把状态与域的筛选放宽。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
          </ScrollArea>
        </aside>

        {isDesktop ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {detailBody}
          </div>
        ) : null}
        {isDesktop ? null : (
          <Sheet
            open={detailOpen}
            onOpenChange={(open) => {
              if (!open) setDetailOpen(false)
            }}
          >
            <SheetContent side="right" className="gap-0 p-0 sm:max-w-md">
              <SheetHeader className="border-b p-4">
                <SheetTitle className="sr-only">
                  服务详情：{service?.label ?? "未选择服务"}
                </SheetTitle>
              </SheetHeader>
              {detailBody}
            </SheetContent>
          </Sheet>
        )}
      </div>

      {model.error ? (
        <Alert
          variant="destructive"
          className="rounded-none border-x-0 border-b-0"
        >
          <AlertTitle>读取服务失败</AlertTitle>
          <AlertDescription>{model.error}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) model.cancelPending()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending
                ? `${ACTION_LABELS[pending.action]} ${pending.label}？`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? CONFIRM_TEXTS[pending.action].detail : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.busy}>
              取消
            </AlertDialogCancel>
            <ActionButton
              busy={submission.busy}
              busyLabel="执行中…"
              variant={
                pending &&
                ["unload", "stop", "disable"].includes(pending.action)
                  ? "destructive"
                  : "default"
              }
              onClick={() => void submission.submit(model.confirmPending)}
            >
              {pending ? CONFIRM_TEXTS[pending.action].ok : ""}
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
