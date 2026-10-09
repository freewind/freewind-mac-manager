import { HugeiconsIcon } from "@hugeicons/react"
import {
  BanIcon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  FolderOpenIcon,
  Link01Icon,
  MoreHorizontalIcon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
  Shield01Icon,
  StopIcon,
  TrashIcon,
} from "@hugeicons/core-free-icons"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import { Input } from "@web/components/ui/input"
import { ScrollArea } from "@web/components/ui/scroll-area"
import { Separator } from "@web/components/ui/separator"
import { cn } from "@web/lib/utils"
import {
  domainLabels,
  stateLabels,
  type LaunchService,
  type ServiceDomain,
  type ServiceState,
} from "@web/features/system-services/mock-data"
import {
  useSystemServices,
  type DomainFilter,
  type ServiceAction,
  type StateFilter,
} from "@web/features/system-services/useSystemServices"

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

/** 每个动作在当前状态下是否可用，以及不可用的原因。 */
const actionAvailability = (
  service: LaunchService,
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
        运行中
      </Badge>
    )
  }
  if (state === "failed") {
    return <Badge variant="destructive">启动失败</Badge>
  }
  if (state === "disabled") {
    return <Badge variant="ghost">已禁用</Badge>
  }
  return <Badge variant="outline">已停止</Badge>
}

const stateDot = (state: ServiceState) => (
  <span
    className={cn(
      "size-1.5 shrink-0 rounded-full",
      state === "running"
        ? "bg-emerald-500"
        : state === "failed"
          ? "bg-destructive"
          : state === "disabled"
            ? "bg-muted-foreground/40"
            : "bg-muted-foreground"
    )}
  />
)

const summaryOf = (service: LaunchService): string => {
  if (service.pid !== null) return `pid ${service.pid}`
  if (!service.exists) return "plist 已移入废纸篓"
  if (service.state === "failed")
    return `上次退出码 ${service.lastExitCode ?? "—"}`
  if (service.state === "disabled") return "未加载，开机不启动"
  if (!service.loaded) return "未加载"
  return "未运行"
}

const Field = (props: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
      {props.label}
    </span>
    <span className="text-xs break-all">{props.children}</span>
  </div>
)

export const SystemServicesPage = () => {
  const model = useSystemServices()
  const service = model.selected

  const actionButton = (action: ServiceAction, icon: typeof PlayIcon) => {
    if (!service) return null
    const availability = actionAvailability(service, action)
    return (
      <Button
        key={action}
        variant={
          action === "unload" || action === "stop" ? "outline" : "secondary"
        }
        size="sm"
        disabled={availability.disabled}
        title={availability.reason ?? undefined}
        onClick={() => model.requestAction(action, service.label)}
      >
        <HugeiconsIcon icon={icon} />
        {ACTION_LABELS[action]}
      </Button>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-medium">系统服务</h1>
          <span className="text-xs text-muted-foreground">
            共 {model.stats.total} 个 · 运行 {model.stats.running} · 已停止{" "}
            {model.stats.stopped} · 失败 {model.stats.failed} · 禁用{" "}
            {model.stats.disabled} · 需 root {model.stats.requiresRoot}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={model.refresh}
          >
            <HugeiconsIcon icon={RefreshIcon} />
            重新读取
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-80">
            <HugeiconsIcon
              icon={Search01Icon}
              className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={model.keyword}
              onChange={(event) => model.setKeyword(event.target.value)}
              placeholder="搜索 label、程序或 plist 路径"
              className="pl-7"
            />
          </div>
          <FilterGroup
            options={[
              { key: "all", label: "全部状态" },
              ...STATE_ORDER.map((state) => ({
                key: state,
                label: stateLabels[state],
              })),
            ]}
            value={model.stateFilter}
            onSelect={(key) => model.setStateFilter(key as StateFilter)}
          />
          <FilterGroup
            options={[
              { key: "all", label: "全部域" },
              ...DOMAIN_ORDER.map((domain) => ({
                key: domain,
                label: domainLabels[domain],
              })),
            ]}
            value={model.domainFilter}
            onSelect={(key) => model.setDomainFilter(key as DomainFilter)}
          />
          <span className="text-xs text-muted-foreground">
            显示 {model.filtered.length} 个
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
            服务列表
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-0.5 px-2 pb-2">
              {model.filtered.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => model.select(item.label)}
                  className={cn(
                    "flex flex-col gap-1 rounded-md px-2 py-1.5 text-left",
                    model.selectedLabel === item.label
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {stateDot(item.state)}
                    <span className="truncate text-xs font-medium">
                      {item.label}
                    </span>
                    {item.requiresRoot ? (
                      <HugeiconsIcon
                        icon={Shield01Icon}
                        className="size-3 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                  </span>
                  <span className="flex items-center gap-1.5 pl-3 text-[0.6875rem] text-muted-foreground">
                    <span>{domainLabels[item.domain]}</span>
                    <span>·</span>
                    <span>{summaryOf(item)}</span>
                  </span>
                </button>
              ))}
              {model.filtered.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  没有符合当前筛选条件的服务。
                </p>
              ) : null}
            </div>
          </ScrollArea>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          {service ? (
            <>
              <div className="flex flex-col gap-2 border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium">{service.label}</h2>
                  {stateBadge(service.state)}
                  <Badge variant="outline">
                    {domainLabels[service.domain]}域
                  </Badge>
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
                  <div className="ml-auto flex items-center gap-1.5">
                    {actionButton("start", PlayIcon)}
                    {actionButton("stop", StopIcon)}
                    {actionButton("restart", RefreshIcon)}
                    {actionButton("load", Link01Icon)}
                    {actionButton("unload", TrashIcon)}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="更多操作"
                            disabled={service.requiresRoot}
                            title={
                              service.requiresRoot
                                ? "位于系统域，需要 root 权限"
                                : undefined
                            }
                          >
                            <HugeiconsIcon icon={MoreHorizontalIcon} />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            model.requestAction("disable", service.label)
                          }
                          disabled={service.disabled}
                        >
                          <HugeiconsIcon icon={BanIcon} />
                          禁用（开机不启动）
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            model.requestAction("enable", service.label)
                          }
                          disabled={!service.disabled}
                        >
                          <HugeiconsIcon icon={CheckmarkCircle02Icon} />
                          启用（恢复开机启动）
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            model.copy(service.filePath, " plist 路径")
                          }
                        >
                          <HugeiconsIcon icon={Copy01Icon} />
                          复制 plist 路径
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            model.copy(service.plist, " plist 内容")
                          }
                        >
                          <HugeiconsIcon icon={Copy01Icon} />
                          复制 plist 内容
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => model.reveal(service)}>
                          <HugeiconsIcon icon={FolderOpenIcon} />
                          在访达中显示
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {service.requiresRoot ? (
                  <p className="text-xs text-muted-foreground">
                    该系统域服务由 root 管理，此处只提供查看、复制与访达定位。
                  </p>
                ) : null}
                {service.lastAction ? (
                  <p className="text-xs text-foreground">
                    {service.lastAction}
                  </p>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <Field label="plist 路径">
                    <span className="font-mono">{service.filePath}</span>
                  </Field>
                  <Field label="程序">
                    <span className="font-mono">{service.program}</span>
                  </Field>
                  <Field label="参数">
                    <span className="font-mono">
                      {service.args.length > 0 ? service.args.join(" ") : "—"}
                    </span>
                  </Field>
                  <Field label="工作目录">
                    <span className="font-mono">
                      {service.workingDirectory ?? "—"}
                    </span>
                  </Field>
                  <Field label="RunAtLoad">
                    {service.runAtLoad ? "是（加载即启动）" : "否"}
                  </Field>
                  <Field label="KeepAlive">
                    {service.keepAlive ? "是（退出后自动拉起）" : "否"}
                  </Field>
                  <Field label="StartInterval">
                    {service.startInterval === null
                      ? "—"
                      : `每 ${service.startInterval} 秒`}
                  </Field>
                  <Field label="ProcessType">
                    {service.processType ?? "—"}
                  </Field>
                  <Field label="ThrottleInterval">
                    {service.throttleInterval === null
                      ? "—"
                      : `${service.throttleInterval} 秒`}
                  </Field>
                  <Field label="PID">
                    {service.pid === null ? "—" : service.pid}
                  </Field>
                  <Field label="本次启动时间">
                    {service.startedAt === null
                      ? "—"
                      : formatTimestamp(service.startedAt)}
                  </Field>
                  <Field label="上次退出码">
                    {service.lastExitCode === null ? "—" : service.lastExitCode}
                  </Field>
                  <Field label="标准输出">
                    <span className="font-mono">
                      {service.stdoutPath ?? "—"}
                    </span>
                  </Field>
                  <Field label="标准错误">
                    <span className="font-mono">
                      {service.stderrPath ?? "—"}
                    </span>
                  </Field>
                  <Field label="环境变量">
                    <span className="font-mono">
                      {Object.keys(service.environment).length === 0
                        ? "—"
                        : Object.entries(service.environment)
                            .map(([key, value]) => `${key}=${value}`)
                            .join("  ")}
                    </span>
                  </Field>
                  <Field label="加载状态">
                    {service.loaded ? "已加载到域中" : "未加载"}
                  </Field>
                </div>

                <Separator className="my-4" />

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">plist 原文</span>
                    <span className="text-xs text-muted-foreground">
                      {service.exists ? "文件位于磁盘" : "该文件已移入废纸篓"}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => model.copy(service.plist, " plist 内容")}
                      >
                        <HugeiconsIcon icon={Copy01Icon} />
                        复制内容
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => model.reveal(service)}
                      >
                        <HugeiconsIcon icon={FolderOpenIcon} />
                        访达定位
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/30">
                    <ScrollArea className="max-h-80">
                      <pre className="p-3 font-mono text-[0.6875rem] leading-relaxed">
                        {service.plist}
                      </pre>
                    </ScrollArea>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              左侧没有可显示的服务。
            </div>
          )}
        </div>
      </div>

      {model.notice ? (
        <div className="flex items-center gap-2 border-t px-4 py-1.5 text-xs">
          <span className="truncate">{model.notice}</span>
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={model.clearNotice}
          >
            知道了
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={model.pending !== null}
        onOpenChange={(open) => {
          if (!open) model.cancelPending()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {model.pending
                ? `${ACTION_LABELS[model.pending.action]} ${model.pending.label}？`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {model.pending ? CONFIRM_TEXTS[model.pending.action].detail : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={
                model.pending &&
                ["unload", "stop", "disable"].includes(model.pending.action)
                  ? "destructive"
                  : "default"
              }
              onClick={model.confirmPending}
            >
              {model.pending ? CONFIRM_TEXTS[model.pending.action].ok : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type FilterGroupProps = {
  options: { key: string; label: string }[]
  value: string
  onSelect: (key: string) => void
}

const FilterGroup = ({ options, value, onSelect }: FilterGroupProps) => (
  <div className="flex items-center gap-0.5 rounded-md border p-0.5">
    {options.map((option) => (
      <Button
        key={option.key}
        variant={value === option.key ? "secondary" : "ghost"}
        size="xs"
        onClick={() => onSelect(option.key)}
      >
        {option.label}
      </Button>
    ))}
  </div>
)
