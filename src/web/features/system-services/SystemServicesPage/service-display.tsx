import type {
  ServiceDomain,
  ServiceState,
  SystemService,
} from "@shared/api-contract"
import { Badge } from "@web/components/ui/badge"
import type { ServiceAction } from "@web/features/system-services/actions"
import { domainLabels, stateLabels } from "@web/features/system-services/labels"
import type {
  DomainFilter,
  StateFilter,
} from "@web/features/system-services/store"
import {
  AlertTriangle,
  Ban,
  CircleCheck,
  type LucideIcon,
  Square,
} from "lucide-react"

export const STATE_ORDER: ServiceState[] = [
  "running",
  "stopped",
  "failed",
  "disabled",
]

export const DOMAIN_ORDER: ServiceDomain[] = ["user", "global", "system"]

export const ACTION_LABELS: Record<ServiceAction, string> = {
  start: "启动",
  stop: "停止",
  restart: "重启",
  load: "加载",
  unload: "卸载",
  disable: "禁用",
  enable: "启用",
}

export const CONFIRM_TEXTS: Record<
  ServiceAction,
  { detail: string; ok: string }
> = {
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
export const ServiceStateIcon = ({ state }: { state: ServiceState }) => {
  const Icon = STATE_ICONS[state]
  return <Icon className={STATE_ICON_CLASSES[state]} />
}

/** 每个动作在当前状态下是否可用，以及不可用的原因。 */
export const actionAvailability = (
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

export const stateBadge = (state: ServiceState) => {
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

export const summaryOf = (service: SystemService): string => {
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
export const filterSummaryOf = (
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
export const launchCommandOf = (service: {
  program: string
  args: string[]
}): string => [service.program, ...service.args].filter(Boolean).join(" ")
