import { HugeiconsIcon } from "@hugeicons/react"
import {
  Activity01Icon,
  AnalyticsUpIcon,
  ArrowRight01Icon,
  CircleGaugeIcon,
  CpuIcon,
  DashboardSpeed02Icon,
  EthernetPortIcon,
  FolderShared01Icon,
  Globe02Icon,
  ServerStack01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@web/components/ui/sidebar"

/** 功能菜单的唯一清单；新增功能只在这里加一项。 */
export type FeatureKey =
  | "overview"
  | "files"
  | "disk-growth"
  | "processes"
  | "traffic"
  | "ports"
  | "frp"
  | "system-services"

type FeatureItem = {
  key: FeatureKey
  label: string
  icon: typeof AnalyticsUpIcon
}

/** 顶层功能，直接平铺。 */
const FEATURES: FeatureItem[] = [
  { key: "overview", label: "概览", icon: CircleGaugeIcon },
  { key: "files", label: "文件管理", icon: FolderShared01Icon },
  { key: "disk-growth", label: "磁盘增长", icon: AnalyticsUpIcon },
  { key: "processes", label: "进程管理", icon: CpuIcon },
  { key: "traffic", label: "流量监控", icon: DashboardSpeed02Icon },
  { key: "ports", label: "端口管理", icon: EthernetPortIcon },
]

/** 可折叠「服务」组下的子项。 */
const SERVICES: FeatureItem[] = [
  { key: "frp", label: "FRP 内网穿透", icon: Globe02Icon },
  { key: "system-services", label: "系统服务", icon: Activity01Icon },
]

const SERVICE_KEYS = SERVICES.map((item) => item.key)

type AppSidebarProps = {
  active: FeatureKey
  onSelect: (key: FeatureKey) => void
}

export const AppSidebar = (props: AppSidebarProps) => {
  const { active, onSelect } = props
  const serviceActive = SERVICE_KEYS.includes(active)

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

            <Collapsible defaultOpen className="group/collapsible">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={serviceActive}
                  render={<CollapsibleTrigger />}
                >
                  <HugeiconsIcon icon={ServerStack01Icon} />
                  <span>服务</span>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    className="ml-auto transition-transform group-data-open/collapsible:rotate-90"
                  />
                </SidebarMenuButton>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {SERVICES.map((service) => (
                      <SidebarMenuSubItem key={service.key}>
                        <SidebarMenuSubButton
                          isActive={active === service.key}
                          onClick={() => onSelect(service.key)}
                        >
                          <HugeiconsIcon icon={service.icon} />
                          <span>{service.label}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
