import type { SystemService } from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
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
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
import type { ServiceAction } from "@web/features/system-services/actions"
import { domainLabels } from "@web/features/system-services/labels"
import type { useSystemServices } from "@web/features/system-services/useSystemServices"
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
  Square,
  Trash2,
} from "lucide-react"
import {
  ACTION_LABELS,
  actionAvailability,
  launchCommandOf,
  stateBadge,
} from "./service-display"

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

/** 服务详情：桌面右列与手机 Sheet 共用同一份内容，不做两套挂载。 */
export const ServiceDetail = (props: {
  isLoading: boolean
  service: SystemService | null
  model: ReturnType<typeof useSystemServices>
  /** plist 原文面板当前展开在哪个服务上；切换服务自动收起。 */
  plistOpenLabel: string | null
  onPlistOpenChange: (label: string | null) => void
}) => {
  const { model, plistOpenLabel } = props
  const service = props.service
  const launchCommand = service === null ? "" : launchCommandOf(service)

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

  if (props.isLoading) {
    return (
      <div className="flex flex-col gap-3 px-4 py-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    )
  }
  if (!service) {
    return (
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
  }

  return (
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
              props.onPlistOpenChange(open ? service.label : null)
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
  )
}
