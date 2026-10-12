import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { clearAccessPasswordCookie } from "@shared/client-api"
import { useQueryClient } from "@tanstack/react-query"
import { AppSidebar, type FeatureKey } from "@web/components/app-sidebar"
import { Button } from "@web/components/ui/button"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@web/components/ui/sidebar"
import { AiAssistantButton } from "@web/features/ai-assistant/AiAssistantButton"
import { AiAssistantDialog } from "@web/features/ai-assistant/AiAssistantDialog"
import { LoginPage } from "@web/features/auth/LoginPage"
import { CaddyPage } from "@web/features/caddy/CaddyPage"
import { ClashVergePage } from "@web/features/clash-verge/ClashVergePage"
import { DashboardPage } from "@web/features/dashboard/DashboardPage"
import { DiskGrowthPage } from "@web/features/disk-growth/DiskGrowthPage"
import { DockerPage } from "@web/features/docker/DockerPage"
import { FilesPage } from "@web/features/files/FilesPage"
import { FrpPage } from "@web/features/frp/FrpPage"
import { HardwarePage } from "@web/features/hardware/HardwarePage"
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
import { useEffect, useSyncExternalStore } from "react"

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
  "hardware",
]

const featureFromUrl = (): FeatureKey => {
  if (typeof window === "undefined") return "overview"
  const value = new URL(window.location.href).searchParams.get("feature")
  return value && FEATURE_KEYS.includes(value as FeatureKey)
    ? (value as FeatureKey)
    : "overview"
}

const featureUrl = (feature: FeatureKey, piTab?: string) => {
  const url = new URL(window.location.href)
  if (feature === "overview") url.searchParams.delete("feature")
  else url.searchParams.set("feature", feature)
  // 子标签只在明确指定时保留；切到别的功能时清掉，避免留下无意义的定位。
  if (feature === "pi" && piTab) url.searchParams.set("piTab", piTab)
  else url.searchParams.delete("piTab")
  return url
}

const isAppFeatureHistory = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  "macManagerFeature" in state &&
  (state as { macManagerFeature?: boolean }).macManagerFeature === true

const featureNavigationSnapshot = (): string =>
  `${featureFromUrl()}:${isAppFeatureHistory(window.history.state)}`

const subscribeFeatureNavigation = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

const useFeatureNavigation = () => {
  const snapshot = useSyncExternalStore(
    subscribeFeatureNavigation,
    featureNavigationSnapshot,
    () => "overview:false"
  )
  const [featureValue, canGoBackValue] = snapshot.split(":")
  const feature = featureValue as FeatureKey

  const selectFeature = (next: FeatureKey): void => {
    if (next === feature) return
    window.history.pushState({ macManagerFeature: true }, "", featureUrl(next))
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state })
    )
  }

  return { feature, canGoBack: canGoBackValue === "true", selectFeature }
}

/**
 * 定位到 Pi 页的「AI助手」子标签。
 * 已经在 Pi 页时 selectFeature 会因功能未变而直接返回，所以这里直接写 URL
 * 并派发 popstate：PiPage 订阅该事件后能切到正确子标签。
 */
const openAiAssistantSettings = (): void => {
  window.history.pushState(
    { macManagerFeature: true },
    "",
    featureUrl("pi", "assistant")
  )
  window.dispatchEvent(
    new PopStateEvent("popstate", { state: window.history.state })
  )
}

export const App = () => {
  const queryClient = useQueryClient()
  const { feature, canGoBack, selectFeature } = useFeatureNavigation()
  const { status: authStatus, error: authError } = useAuthStatus()

  useEffect(() => {
    void refreshAuthStatus(true)

    const onUnauthorized = (): void => {
      queryClient.clear()
      markUnauthenticated()
    }
    window.addEventListener("mac-manager:unauthorized", onUnauthorized)
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
      window.removeEventListener("mac-manager:unauthorized", onUnauthorized)
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

  // 认证是无状态的：清掉密码 cookie 后整页刷新即可回到登录页。
  const signOut = (): void => {
    clearAccessPasswordCookie()
    window.location.reload()
  }

  return (
    <SidebarProvider>
      <AppSidebar active={feature} onSelect={selectFeature} />
      <SidebarInset className="min-w-0">
        <div className="flex items-center gap-2 border-b px-2 py-2">
          <SidebarTrigger />
          {canGoBack ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="返回"
              title="返回"
              onClick={goBack}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} />
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <AiAssistantButton />
            <TaskCenter authenticated={authStatus.authenticated} />
            <Button
              size="sm"
              className="min-h-11"
              variant="outline"
              onClick={() => void signOut()}
            >
              退出登录
            </Button>
          </div>
        </div>
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
        {feature === "hardware" ? <HardwarePage /> : null}
      </SidebarInset>
      <AiAssistantDialog onOpenModelSettings={openAiAssistantSettings} />
    </SidebarProvider>
  )
}
