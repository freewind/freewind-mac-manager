import type { ClashVergeAvailability } from "@shared/api-contract"
import { PageHeader } from "@web/components/PageHeader"
import { Button } from "@web/components/ui/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@web/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import { RefreshCw } from "lucide-react"
import { ConfigDetailPanel } from "./ConfigDetailPanel"
import { ConnectionsList } from "./ConnectionsList"
import { CurrentProfileCard } from "./CurrentProfileCard"
import { CustomRulesPanel } from "./CustomRulesPanel"
import { GeoDatabasesPanel } from "./GeoDatabasesPanel"
import { MergeProfilesPanel } from "./MergeProfilesPanel"
import { ProfilesPanel } from "./ProfilesPanel"
import { ProxyGroups } from "./ProxyGroups"
import { StatusCards } from "./StatusCards"
import { CLASH_TABS, type ClashTab, useClashTab } from "./useClashTab"
import { useClashVerge } from "./useClashVerge"

/**
 * 单一节文案兜底：优先展示服务端 availability.message（任务 26 后
 * 404/429 分别带 not_found / rate_limited 的具体文案，自动发现失败时
 * message 也已带尝试过的来源），不把它们都归并成「不可用」。
 * 兜底只在 message 为空时使用，前端不重复实现发现逻辑。
 */
const sectionNotice = (
  label: string,
  availability: ClashVergeAvailability | undefined
): string | null => {
  if (!availability || availability.state === "available") return null
  if (availability.message) return `${label}：${availability.message}`
  const fallback: Record<string, string> = {
    not_configured: "未发现本机控制接口",
    unauthorized: "控制接口认证失败；请检查服务端配置",
    unavailable: "控制接口不可用；当前数据可能过期",
  }
  return `${label}：${fallback[availability.state] ?? "数据不可用"}`
}

export const ClashVergePage = () => {
  const model = useClashVerge()
  const { tab, selectTab } = useClashTab()

  // 每个非 available 的数据块给出一条提示；查询层失败单独一条。
  // 初始加载中的 undefined 不算过期，交给各分区的空态文案。
  const notices = [
    sectionNotice("状态", model.status?.availability),
    model.statusQueryIsError ? "状态：读取失败" : null,
    sectionNotice("代理组", model.proxies?.availability),
    sectionNotice("连接", model.connections?.availability),
  ].filter((notice): notice is string => notice !== null)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <PageHeader title="Clash Verge" loading={model.isLoading} />
          {notices.length > 0 ? (
            <span
              role="status"
              aria-label="数据状态提示"
              className="min-w-0 text-xs break-words text-amber-700 dark:text-amber-400"
            >
              {notices.join("；")}
            </span>
          ) : null}
          <Button
            size="sm"
            className="ml-auto min-w-11"
            variant="outline"
            onClick={model.refresh}
            disabled={model.isFetching}
          >
            <RefreshCw aria-hidden="true" />
            刷新
          </Button>
        </div>
        <ClashTabNav tab={tab} selectTab={selectTab} />
      </header>

      {/* 每个标签只有一个主体滚动区，滚动不再把整页内容往下推 */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        {tab === "status" ? (
          <div className="space-y-6">
            {model.isLoading ? (
              <p className="text-sm text-muted-foreground">
                正在读取 Clash Verge 内核状态…
              </p>
            ) : null}
            <StatusCards status={model.status} />
            {/* 代理组跟着当前订阅走：它描述的正是这份配置里的分组 */}
            <Tabs defaultValue="profile">
              <TabsList>
                <TabsTrigger value="profile">当前订阅</TabsTrigger>
                <TabsTrigger value="connections">活动连接</TabsTrigger>
              </TabsList>
              <TabsContent value="profile" className="space-y-3 pt-3">
                <CurrentProfileCard
                  profiles={model.profiles}
                  isError={model.profilesQueryIsError}
                  proxies={model.proxies}
                />
                <ProxyGroups
                  proxies={model.proxies}
                  isError={model.proxiesQueryIsError}
                />
              </TabsContent>
              <TabsContent value="connections" className="pt-3">
                <ConnectionsList
                  connections={model.connections?.connections ?? []}
                  total={model.connections?.total ?? 0}
                  truncated={model.connections?.truncated ?? false}
                  sampledAt={model.connections?.sampledAt}
                  limit={model.connections?.limit}
                />
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
        {tab === "profiles" ? <ProfilesPanel /> : null}
        {tab === "merge" ? <MergeProfilesPanel /> : null}
        {tab === "customRules" ? <CustomRulesPanel /> : null}
        {tab === "geoData" ? <GeoDatabasesPanel /> : null}
        {tab === "config" ? <ConfigDetailPanel /> : null}
      </div>
    </div>
  )
}

const ClashTabNav = (props: {
  tab: ClashTab
  selectTab: (tab: ClashTab) => void
}) => (
  <ToggleGroup
    variant="outline"
    className="flex-wrap"
    value={[props.tab]}
    onValueChange={(values) => {
      const next = values[0]
      if (next) props.selectTab(next as ClashTab)
    }}
  >
    {CLASH_TABS.map((item) => (
      <ToggleGroupItem key={item.key} value={item.key} className="px-3">
        {item.label}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
)
