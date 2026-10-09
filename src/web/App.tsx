import { useState } from "react"
import { AppSidebar, type FeatureKey } from "@web/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@web/components/ui/sidebar"
import { DiskGrowthPage } from "@web/features/disk-growth/DiskGrowthPage"

export const App = () => {
  const [feature, setFeature] = useState<FeatureKey>("disk-growth")

  return (
    <SidebarProvider>
      <AppSidebar active={feature} onSelect={setFeature} />
      <SidebarInset>{feature === "disk-growth" ? <DiskGrowthPage /> : null}</SidebarInset>
    </SidebarProvider>
  )
}
