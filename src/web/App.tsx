import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AppSidebar, type FeatureKey } from "@web/components/app-sidebar"
import { Button } from "@web/components/ui/button"
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
import { TaskCenter } from "@web/features/tasks/TaskCenter"
import { TrafficPage } from "@web/features/traffic/TrafficPage"
import { useSyncExternalStore } from "react"

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

export const App = () => {
  const { feature, canGoBack, selectFeature } = useFeatureNavigation()

  const goBack = (): void => {
    window.history.back()
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
          <div className="ml-auto flex items-center gap-2">
            <TaskCenter />
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
