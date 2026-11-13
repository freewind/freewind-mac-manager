import { clearAccessPasswordCookie } from "@shared/client-api"
import { useQueryClient } from "@tanstack/react-query"
import { createRootRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { AppSidebar, type FeatureKey } from "@web/components/app-sidebar"
import { Button } from "@web/components/ui/button"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@web/components/ui/sidebar"
import { AiAssistantButton } from "@web/features/ai-assistant/AiAssistantButton"
import { AiAssistantDialog } from "@web/features/ai-assistant/AiAssistantDialog"
import { AiCallPage } from "@web/features/ai-call/AiCallPage"
import { AiTopicsPage } from "@web/features/ai-topics/AiTopicsPage"
import { LoginPage } from "@web/features/auth/LoginPage"
import { CaddyPage } from "@web/features/caddy/CaddyPage"
import { ClashVergePage } from "@web/features/clash-verge/ClashVergePage"
import { DashboardPage } from "@web/features/dashboard/DashboardPage"
import { DatabasePage } from "@web/features/database/DatabasePage"
import { DiskGrowthPage } from "@web/features/disk-growth/DiskGrowthPage"
import { DockerPage } from "@web/features/docker/DockerPage"
import { FilesPage } from "@web/features/files/FilesPage"
import { FrpPage } from "@web/features/frp/FrpPage"
import { HardwarePage } from "@web/features/hardware/HardwarePage"
import { McpServersPage } from "@web/features/mcp-servers/McpServersPage"
import { PiPage } from "@web/features/pi/PiPage"
import { PortsPage } from "@web/features/ports/PortsPage"
import { ProcessesPage } from "@web/features/processes/ProcessesPage"
import { SystemServicesPage } from "@web/features/system-services/SystemServicesPage"
import { TaskCenter } from "@web/features/tasks/TaskCenter"
import { TrafficPage } from "@web/features/traffic/TrafficPage"
import {
  markAuthenticated,
  markUnauthenticated,
  refreshAuthStatus,
  useAuthStatus,
} from "@web/hooks/use-auth-status"
import { ArrowLeft } from "lucide-react"
import { useCallback, useEffect, useSyncExternalStore } from "react"

const FEATURE_KEYS: readonly FeatureKey[] = [
  "overview",
  "files",
  "disk-growth",
  "processes",
  "traffic",
  "ports",
  "frp",
  "caddy",
  "system-services",
  "pi",
  "clash-verge",
  "docker",
  "database",
  "hardware",
  "mcp-servers",
  "ai-topics",
  "ai-call",
]

/** URL 查询参数的规范化结果：值只能是字符串或删除（undefined）。 */
export type AppSearch = { feature?: FeatureKey } & Record<
  string,
  string | undefined
>

/**
 * 规范化 ?feature=：合法值原样保留；缺失或非法时删除该参数（渲染时回落概览），
 * 不把默认值写回 URL，保持「概览页 URL 不带 feature」的既有形态。
 */
export const parseFeatureSearch = (
  search: Record<string, unknown>
): AppSearch => {
  const { feature, ...rest } = search
  // URL 查询参数的值只会是字符串；非字符串值（不应出现）按未知参数丢弃。
  const stringRest = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => typeof value === "string")
  ) as Record<string, string | undefined>
  if (typeof feature !== "string") return stringRest
  return FEATURE_KEYS.includes(feature as FeatureKey)
    ? { ...stringRest, feature: feature as FeatureKey }
    : stringRest
}

const useFeatureNavigation = () => {
  const search = rootRoute.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const feature = search.feature ?? "overview"

  // 返回按钮只在「当前历史条目由应用内导航产生」时出现：router 导航与未迁移的
  // 分区 hook 都会留下非空 history state，直接打开链接或回到首条时是 null。
  const subscribeHistory = useCallback(
    (onStoreChange: () => void) => router.history.subscribe(onStoreChange),
    [router]
  )
  const canGoBack = useSyncExternalStore(
    subscribeHistory,
    () => window.history.state !== null,
    () => false
  )

  const selectFeature = (next: FeatureKey): void => {
    if (next === feature) return
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({
        ...prev,
        feature: next === "overview" ? undefined : next,
        // 切换功能时清掉 Pi 子页定位，避免留下无意义的深链。
        piTab: undefined,
      }),
    })
  }

  return { feature, canGoBack, selectFeature }
}

export const App = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { feature, canGoBack, selectFeature } = useFeatureNavigation()
  const { status: authStatus, error: authError } = useAuthStatus()

  useEffect(() => {
    void refreshAuthStatus(true)

    const onUnauthorized = (): void => {
      queryClient.clear()
      markUnauthenticated()
    }
    window.addEventListener("computer-manager:unauthorized", onUnauthorized)
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void refreshAuthStatus(false)
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("online", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("online", onVisibilityChange)
      window.removeEventListener(
        "computer-manager:unauthorized",
        onUnauthorized
      )
    }
  }, [queryClient])

  if (authError)
    return <div className="p-6 text-sm text-destructive">{authError}</div>
  if (!authStatus)
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
        正在检查登录状态…
      </div>
    )
  if (!authStatus.authenticated) {
    return (
      <LoginPage
        configured={authStatus.configured}
        onAuthenticated={() => markAuthenticated()}
      />
    )
  }

  const goBack = (): void => {
    window.history.back()
  }

  /** 定位到 Pi 页的「AI助手」子标签；即使已在 Pi 页，也要改写 piTab 参数。 */
  const openAiAssistantSettings = (): void => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({
        ...prev,
        feature: "pi",
        piTab: "assistant",
      }),
    })
  }

  // 认证是无状态的：清掉密码 cookie 后整页刷新即可回到登录页。
  const signOut = (): void => {
    clearAccessPasswordCookie()
    window.location.reload()
  }

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar active={feature} onSelect={selectFeature} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b px-2 py-2">
          <SidebarTrigger />
          {canGoBack ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="返回"
              title="返回"
              onClick={goBack}
            >
              <ArrowLeft />
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <AiAssistantButton />
            <TaskCenter authenticated={authStatus.authenticated} />
            <Button size="sm" variant="outline" onClick={() => void signOut()}>
              退出登录
            </Button>
          </div>
        </div>
        {/* 内容区只给确定高度与兜底滚动：各页自己用 min-h-0 flex-1 的局部滚动区。 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {feature === "overview" ? <DashboardPage /> : null}
          {feature === "files" ? <FilesPage /> : null}
          {feature === "disk-growth" ? <DiskGrowthPage /> : null}
          {feature === "processes" ? <ProcessesPage /> : null}
          {feature === "traffic" ? <TrafficPage /> : null}
          {feature === "ports" ? <PortsPage /> : null}
          {feature === "frp" ? <FrpPage /> : null}
          {feature === "caddy" ? <CaddyPage /> : null}
          {feature === "system-services" ? <SystemServicesPage /> : null}
          {feature === "pi" ? <PiPage /> : null}
          {feature === "clash-verge" ? <ClashVergePage /> : null}
          {feature === "docker" ? <DockerPage /> : null}
          {feature === "database" ? <DatabasePage /> : null}
          {feature === "hardware" ? <HardwarePage /> : null}
          {feature === "mcp-servers" ? <McpServersPage /> : null}
          {feature === "ai-topics" ? <AiTopicsPage /> : null}
          {feature === "ai-call" ? <AiCallPage /> : null}
        </div>
      </SidebarInset>
      <AiAssistantDialog onOpenModelSettings={openAiAssistantSettings} />
    </SidebarProvider>
  )
}

/** 根路由只负责把 ?feature= 规范化为类型安全的搜索状态，页面分发仍由 App 承担。 */
export const rootRoute = createRootRoute({
  validateSearch: parseFeatureSearch,
  component: App,
})
