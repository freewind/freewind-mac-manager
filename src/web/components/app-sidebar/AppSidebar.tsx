import { HugeiconsIcon } from "@hugeicons/react"
import {
  AnalyticsUpIcon,
  CircleGaugeIcon,
  DashboardSpeed02Icon,
  ServerStack01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@web/components/ui/sidebar"

/** 功能菜单的唯一清单；新增功能只在这里加一项。 */
export type FeatureKey =
  "overview" | "disk-growth" | "traffic" | "system-services"

type FeatureItem = {
  key: FeatureKey
  label: string
  icon: typeof AnalyticsUpIcon
}

const FEATURES: FeatureItem[] = [
  { key: "overview", label: "概览", icon: CircleGaugeIcon },
  { key: "disk-growth", label: "磁盘增长", icon: AnalyticsUpIcon },
  { key: "traffic", label: "流量监控", icon: DashboardSpeed02Icon },
  { key: "system-services", label: "系统服务", icon: ServerStack01Icon },
]

type AppSidebarProps = {
  active: FeatureKey
  onSelect: (key: FeatureKey) => void
}

export const AppSidebar = (props: AppSidebarProps) => {
  const { active, onSelect } = props

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <HugeiconsIcon icon={Settings01Icon} className="size-4" />
          <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">
            Mac Manager
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>功能</SidebarGroupLabel>
          <SidebarMenu>
            {FEATURES.map((feature) => (
              <SidebarMenuItem key={feature.key}>
                <SidebarMenuButton
                  isActive={active === feature.key}
                  tooltip={feature.label}
                  onClick={() => onSelect(feature.key)}
                >
                  <HugeiconsIcon icon={feature.icon} />
                  <span>{feature.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
