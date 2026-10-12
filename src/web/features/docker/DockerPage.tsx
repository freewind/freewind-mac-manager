import {
  Alert02Icon,
  ContainerIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type {
  DockerContainersResponse,
  DockerOverview,
} from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import { useQuery } from "@tanstack/react-query"
import { PageHeader } from "@web/components/PageHeader"
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
import { AiAssistantButton } from "@web/features/ai-assistant/AiAssistantButton"
import { buildAiAssistantContext } from "@web/features/ai-assistant/context"
import { ColimaCard } from "@web/features/docker/ColimaCard"
import { ContainerList } from "@web/features/docker/ContainerList"
import { ImageList } from "@web/features/docker/ImageList"
import { NetworkList } from "@web/features/docker/NetworkList"
import { dockerKeys } from "@web/features/docker/queries"
import { useDocker } from "@web/features/docker/useDocker"
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

  // 读容器列表的缓存而不发请求：没打开过容器标签时就不要为了上下文多发一次
  // 接口；拿不到就如实写「未加载」，不拿来饰数据凑数。
  const cachedContainers = useQuery<DockerContainersResponse>({
    queryKey: dockerKeys.containers,
    enabled: false,
  })
  const containers = cachedContainers.data?.containers ?? []
  // 区分「没读过」与「读过但没有容器」：两者不能用同一句话。
  const containersLoaded = cachedContainers.isSuccess

  // 只整理页面上已经显示出来的计数与缓存里的容器条目。
  const assistantContext = buildAiAssistantContext({
    feature: "Docker",
    subject: [
      overview ? `docker ${overview.version ?? "版本未知"}` : null,
      overview?.colima.running ? "Colima 运行中" : null,
      `当前分区 ${tab}`,
    ]
      .filter(Boolean)
      .join(" · "),
    collectedAt: overview?.checkedAt ?? null,
    status: overview ? "ready" : model.error ? "error" : "loading",
    errorMessage: model.error,
    summary: overview
      ? [
          `Docker 可用：${overview.available ? "是" : "否"}`,
          `容器：共 ${overview.containers.total} · 运行 ${overview.containers.running} · 暂停 ${overview.containers.paused} · 停止 ${overview.containers.stopped}`,
          `镜像：${overview.images.total} 个，占用 ${formatBytes(overview.images.sizeBytes)}`,
          `卷：${overview.volumes.total} 个 · 网络：${overview.networks.total} 个`,
          containersLoaded
            ? containers.length > 0
              ? `容器明细：已从缓存读到 ${containers.length} 条`
              : "容器明细：已读取，当前没有容器"
            : "容器明细：尚未读取（未打开容器分区时不会额外请求）",
        ]
      : [],
    lists: [
      {
        label: "容器（缓存快照）",
        items: containers
          .slice(0, 10)
          .map(
            (item) =>
              `#${item.id.slice(0, 12)} ${item.name} · ${item.state} · ${item.status} · 镜像 ${item.image}`
          ),
        total: containers.length,
      },
    ],
  })

  return (
    <div className="flex min-w-0 flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={ContainerIcon} className="size-4 shrink-0" />
          <div className="min-w-0">
            <PageHeader title="Docker" loading={model.isLoading} />
            <p className="truncate text-xs text-muted-foreground">
              {model.sampledAt
                ? `数据时间 ${model.sampledAt}`
                : "正在读取 Docker 概览"}
            </p>
          </div>
        </div>
        {/* 手机上也够大的触控目标，图标与文字都在按钮里 */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <AiAssistantButton context={assistantContext} />
          <Button
            variant="outline"
            className="min-h-11 shrink-0 px-3"
            onClick={model.refresh}
            disabled={model.isRefreshing}
          >
            <HugeiconsIcon icon={RefreshIcon} aria-hidden="true" />
            刷新
          </Button>
        </div>
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
      <ColimaCard
        colima={overview.colima}
        runningContainers={overview.containers.running}
      />
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
