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
import {
  Activity,
  ArrowRight,
  Blocks,
  Bot,
  ChartLine,
  CircuitBoard,
  Container,
  Cpu,
  Database,
  EthernetPort,
  FolderTree,
  Gauge,
  Globe,
  type LucideIcon,
  Router,
  Server,
  Settings,
  TrendingUp,
  Wifi,
} from "lucide-react"

/** 功能菜单的唯一清单；新增功能只在这里加一项。 */
export type FeatureKey =
  | "overview"
  | "files"
  | "disk-growth"
  | "processes"
  | "traffic"
  | "ports"
  | "frp"
  | "caddy"
  | "system-services"
  | "pi"
  | "clash-verge"
  | "docker"
  | "database"
  | "hardware"
  | "mcp-servers"

type FeatureItem = {
  key: FeatureKey
  label: string
  icon: LucideIcon
}

/** 顶层功能，直接平铺。 */
const FEATURES: FeatureItem[] = [
  { key: "overview", label: "概览", icon: Gauge },
  { key: "files", label: "文件管理", icon: FolderTree },
  { key: "disk-growth", label: "磁盘增长", icon: TrendingUp },
  { key: "processes", label: "进程管理", icon: Cpu },
  { key: "traffic", label: "流量监控", icon: ChartLine },
  { key: "ports", label: "端口管理", icon: EthernetPort },
  { key: "docker", label: "Docker", icon: Container },
  { key: "database", label: "数据库", icon: Database },
  { key: "pi", label: "Pi Agent", icon: Bot },
  { key: "mcp-servers", label: "MCP Servers", icon: Blocks },
  { key: "hardware", label: "硬件", icon: CircuitBoard },
]

/** 可折叠「服务」组下的子项。 */
const SERVICES: FeatureItem[] = [
  { key: "frp", label: "FRP 内网穿透", icon: Globe },
  { key: "caddy", label: "Caddy 网关", icon: Router },
  { key: "system-services", label: "系统服务", icon: Activity },
  { key: "clash-verge", label: "Clash Verge", icon: Wifi },
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
          <Settings className="size-4" />
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
                  <feature.icon />
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
                  <Server />
                  <span>服务</span>
                  <ArrowRight className="ml-auto transition-transform group-data-open/collapsible:rotate-90" />
                </SidebarMenuButton>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {SERVICES.map((service) => (
                      <SidebarMenuSubItem key={service.key}>
                        <SidebarMenuSubButton
                          isActive={active === service.key}
                          onClick={() => onSelect(service.key)}
                        >
                          <service.icon />
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
