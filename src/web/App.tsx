import { useState } from "react"
import { AppSidebar, type FeatureKey } from "@web/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@web/components/ui/sidebar"
import { DashboardPage } from "@web/features/dashboard/DashboardPage"
import { DiskGrowthPage } from "@web/features/disk-growth/DiskGrowthPage"
import { SystemServicesPage } from "@web/features/system-services/SystemServicesPage"
import { TrafficPage } from "@web/features/traffic/TrafficPage"

export const App = () => {
  const [feature, setFeature] = useState<FeatureKey>("overview")

  return (
    <SidebarProvider>
      <AppSidebar active={feature} onSelect={setFeature} />
      <SidebarInset>
        {feature === "overview" ? <DashboardPage /> : null}
        {feature === "disk-growth" ? <DiskGrowthPage /> : null}
        {feature === "traffic" ? <TrafficPage /> : null}
        {feature === "system-services" ? <SystemServicesPage /> : null}
      </SidebarInset>
    </SidebarProvider>
  )
}
