import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { useQueryClient } from "@tanstack/react-query"
import {
  fetchAuthStatus,
  logout,
  ensureCsrf,
  type AuthStatus,
} from "@shared/client-api"
import { describeError } from "@shared/format"
import { AppSidebar, type FeatureKey } from "@web/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@web/components/ui/sidebar"
import { DashboardPage } from "@web/features/dashboard/DashboardPage"
import { DiskGrowthPage } from "@web/features/disk-growth/DiskGrowthPage"
import { FilesPage } from "@web/features/files/FilesPage"
import { FrpPage } from "@web/features/frp/FrpPage"
import { PortsPage } from "@web/features/ports/PortsPage"
import { ProcessesPage } from "@web/features/processes/ProcessesPage"
import { SystemServicesPage } from "@web/features/system-services/SystemServicesPage"
import { TrafficPage } from "@web/features/traffic/TrafficPage"
import { LoginPage } from "@web/features/auth/LoginPage"
import { Button } from "@web/components/ui/button"

const FEATURE_KEYS: readonly FeatureKey[] = [
  "overview",
  "files",
  "disk-growth",
  "processes",
  "traffic",
  "ports",
  "frp",
  "system-services",
]

const featureFromUrl = (): FeatureKey => {
  if (typeof window === "undefined") return "overview"
  const value = new URL(window.location.href).searchParams.get("feature")
  return value && FEATURE_KEYS.includes(value as FeatureKey)
    ? (value as FeatureKey)
    : "overview"
}

const featureUrl = (feature: FeatureKey) => {
  const url = new URL(window.location.href)
  if (feature === "overview") url.searchParams.delete("feature")
  else url.searchParams.set("feature", feature)
  return url
}

const isAppFeatureHistory = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  "macManagerFeature" in state &&
  (state as { macManagerFeature?: boolean }).macManagerFeature === true

export const App = () => {
  const queryClient = useQueryClient()
  const [feature, setFeature] = useState<FeatureKey>(featureFromUrl)
  const [canGoBack, setCanGoBack] = useState(
    () =>
      typeof window !== "undefined" && isAppFeatureHistory(window.history.state)
  )
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const onPopState = (event: PopStateEvent): void => {
      setFeature(featureFromUrl())
      setCanGoBack(isAppFeatureHistory(event.state))
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  useEffect(() => {
    const load = async (showError: boolean): Promise<void> => {
      try {
        await ensureCsrf()
        setAuthStatus(await fetchAuthStatus())
      } catch (cause) {
        if (showError) setAuthError(describeError(cause))
      }
    }
    void load(true)

    const onUnauthorized = (): void => {
      queryClient.clear()
      setAuthStatus((current) =>
        current ? { ...current, authenticated: false } : current
      )
    }
    window.addEventListener("mac-manager:unauthorized", onUnauthorized)
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void load(false)
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
        onAuthenticated={() =>
          setAuthStatus({ ...authStatus, authenticated: true })
        }
      />
    )
  }

  const selectFeature = (next: FeatureKey): void => {
    if (next === feature) return
    window.history.pushState({ macManagerFeature: true }, "", featureUrl(next))
    setFeature(next)
    setCanGoBack(true)
  }

  const goBack = (): void => {
    window.history.back()
  }

  const signOut = async (): Promise<void> => {
    try {
      await logout()
    } finally {
      queryClient.clear()
      setAuthStatus({ ...authStatus, authenticated: false })
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar active={feature} onSelect={selectFeature} />
      <SidebarInset>
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
          <div className="ml-auto">
            <Button size="sm" variant="outline" onClick={() => void signOut()}>
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
        {feature === "system-services" ? <SystemServicesPage /> : null}
      </SidebarInset>
    </SidebarProvider>
  )
}
