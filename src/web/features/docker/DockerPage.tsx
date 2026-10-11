import {
  Alert02Icon,
  ContainerIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { DockerColimaStatus, DockerOverview } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Skeleton } from "@web/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import { ContainerList } from "@web/features/docker/ContainerList"
import { ImageList } from "@web/features/docker/ImageList"
import { NetworkList } from "@web/features/docker/NetworkList"
import { colimaStateOf, useDocker } from "@web/features/docker/useDocker"
import {
  DOCKER_TABS,
  type DockerTab,
  useDockerTab,
} from "@web/features/docker/useDockerTab"
import { VolumeList } from "@web/features/docker/VolumeList"

/** 概览一屏：Colima 状态与容器/镜像/卷/网络的真实计数。 */
export const DockerPage = () => {
  const model = useDocker()
  const { tab, selectTab } = useDockerTab()
  const overview = model.overview

  return (
    <div className="flex min-w-0 flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={ContainerIcon} className="size-4 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-medium">Docker</h1>
            <p className="truncate text-xs text-muted-foreground">
              {model.sampledAt
                ? `数据时间 ${model.sampledAt}`
                : "正在读取 Docker 概览"}
            </p>
          </div>
        </div>
        {/* 手机上也够大的触控目标，图标与文字都在按钮里 */}
        <Button
          variant="outline"
          className="ml-auto min-h-11 shrink-0 px-3"
          onClick={model.refresh}
          disabled={model.isRefreshing}
        >
          <HugeiconsIcon icon={RefreshIcon} aria-hidden="true" />
          刷新
        </Button>
      </header>

      {model.error ? (
        <Alert variant="destructive" role="alert">
          <HugeiconsIcon icon={Alert02Icon} aria-hidden="true" />
          <AlertTitle>读取 Docker 概览失败</AlertTitle>
          <AlertDescription>
            {model.error}。页面保留的是上一次读取到的数据，请重试。
          </AlertDescription>
        </Alert>
      ) : null}

      {model.isLoading ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <p className="text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
            正在读取 Docker 概览…
          </p>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : overview ? (
        <DockerOverviewCards overview={overview} />
      ) : null}

      <DockerSections tab={tab} selectTab={selectTab} />
    </div>
  )
}

const DockerOverviewCards = ({ overview }: { overview: DockerOverview }) => (
  <div className="flex min-w-0 flex-col gap-3">
    {overview.available ? null : (
      <Alert role="status">
        <HugeiconsIcon icon={Alert02Icon} aria-hidden="true" />
        <AlertTitle>Docker 当前不可用</AlertTitle>
        <AlertDescription>
          多数情况下是 Colima 没启动；启动后各项计数会自动恢复。
        </AlertDescription>
      </Alert>
    )}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <ColimaCard colima={overview.colima} />
      <StatCard
        title="容器"
        description="来自 docker ps -a"
        total={overview.containers.total}
        unit="容器"
        emptyText="暂无容器"
        detail={`运行 ${overview.containers.running} · 暂停 ${overview.containers.paused} · 停止 ${overview.containers.stopped}`}
      />
      <StatCard
        title="镜像"
        description="来自 docker images 与 system df"
        total={overview.images.total}
        unit="镜像"
        emptyText="暂无镜像"
        detail={`占用 ${formatBytes(overview.images.sizeBytes)}`}
      />
      <StatCard
        title="卷"
        description="来自 docker volume ls"
        total={overview.volumes.total}
        unit="卷"
        emptyText="暂无卷"
        detail={overview.volumes.total === 0 ? "" : "本地卷"}
      />
      <StatCard
        title="网络"
        description="来自 docker network ls"
        total={overview.networks.total}
        unit="网络"
        emptyText="暂无网络"
        detail={overview.networks.total === 0 ? "" : "含内置网络"}
      />
    </div>
  </div>
)

const StatCard = (props: {
  title: string
  description: string
  total: number
  unit: string
  emptyText: string
  detail: string
}) => (
  <Card className="min-w-0">
    <CardHeader>
      <CardTitle>{props.title}</CardTitle>
      <CardDescription>{props.description}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-1">
      <p className="text-2xl font-medium">{props.total}</p>
      <p className="text-xs text-muted-foreground">
        {props.total === 0
          ? props.emptyText
          : `共 ${props.total} 个${props.unit}`}
      </p>
      {props.detail ? (
        <p className="text-xs text-muted-foreground">{props.detail}</p>
      ) : null}
    </CardContent>
  </Card>
)

const COLIMA_TONE: Record<ReturnType<typeof colimaStateOf>, string> = {
  running: "text-emerald-600",
  stopped: "text-amber-600",
  missing: "text-muted-foreground",
}

const ColimaCard = ({ colima }: { colima: DockerColimaStatus }) => {
  const state = colimaStateOf(colima)
  const label =
    state === "running" ? "运行中" : state === "stopped" ? "未运行" : "未安装"
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Colima</CardTitle>
        <CardDescription>{colima.status}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className={`text-2xl font-medium ${COLIMA_TONE[state]}`}>{label}</p>
        <p className="text-xs text-muted-foreground">
          {state === "missing"
            ? "未安装 colima，Docker 能力不可用"
            : `runtime ${colima.runtime ?? "—"} · 架构 ${colima.arch ?? "—"}`}
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * 分区导航与分区内容。
 * 分区状态放 URL（?tab=images），刷新、分享与浏览器返回都能恢复；
 * 手机与桌面共用同一套分区，只由各列表自己决定卡片还是表格。
 */
const DockerSections = (props: {
  tab: DockerTab
  selectTab: (tab: DockerTab) => void
}) => (
  <div className="flex min-w-0 flex-col gap-3">
    <ToggleGroup
      variant="outline"
      className="flex-wrap"
      value={[props.tab]}
      onValueChange={(values) => {
        const next = values[0]
        if (next) props.selectTab(next as DockerTab)
      }}
    >
      {DOCKER_TABS.map((item) => (
        <ToggleGroupItem
          key={item.key}
          value={item.key}
          className="min-h-11 px-3"
        >
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>

    {props.tab === "containers" ? <ContainerList /> : null}
    {props.tab === "images" ? <ImageList /> : null}
    {props.tab === "volumes" ? <VolumeList /> : null}
    {props.tab === "networks" ? <NetworkList /> : null}
  </div>
)
