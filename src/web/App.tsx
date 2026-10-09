import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  fetchAuthStatus,
  logout,
  ensureCsrf,
  type AuthStatus,
} from "@shared/client-api"
import { AppSidebar, type FeatureKey } from "@web/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@web/components/ui/sidebar"
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

export const App = () => {
  const queryClient = useQueryClient()
  const [feature, setFeature] = useState<FeatureKey>("overview")
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        await ensureCsrf()
        setAuthStatus(await fetchAuthStatus())
      } catch (cause) {
        setAuthError(cause instanceof Error ? cause.message : "无法连接服务")
      }
    }
    void load()

    const onUnauthorized = (): void => {
      queryClient.clear()
      setAuthStatus((current) =>
        current ? { ...current, authenticated: false } : current
      )
    }
    window.addEventListener("mac-manager:unauthorized", onUnauthorized)
    return () =>
      window.removeEventListener("mac-manager:unauthorized", onUnauthorized)
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
      <AppSidebar active={feature} onSelect={setFeature} />
      <SidebarInset>
        <div className="flex justify-end border-b px-4 py-2">
          <Button size="sm" variant="outline" onClick={() => void signOut()}>
            退出登录
          </Button>
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
