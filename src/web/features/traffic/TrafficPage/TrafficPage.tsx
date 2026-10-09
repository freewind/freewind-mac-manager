import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  DashboardSpeed02Icon,
  Delete02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { Fragment, useMemo, useState } from "react"
import { formatBytes, formatTimestamp } from "@shared/format"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { ScrollArea } from "@web/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { cn } from "@web/lib/utils"
import { useTraffic } from "@web/features/traffic/useTraffic"

type SortKey = "name" | "bytesIn" | "bytesOut" | "total"

export const TrafficPage = () => {
  const model = useTraffic()
  const [sortKey, setSortKey] = useState<SortKey>("total")
  const [descending, setDescending] = useState(true)

  const sortedGroups = useMemo(() => {
    const factor = descending ? -1 : 1
    return [...model.groups].sort((left, right) => {
      if (sortKey === "name") {
        return left.name.localeCompare(right.name) * factor
      }
      const leftValue =
        sortKey === "bytesIn"
          ? left.bytesIn
          : sortKey === "bytesOut"
            ? left.bytesOut
            : left.bytesIn + left.bytesOut
      const rightValue =
        sortKey === "bytesIn"
          ? right.bytesIn
          : sortKey === "bytesOut"
            ? right.bytesOut
            : right.bytesIn + right.bytesOut
      return (leftValue - rightValue) * factor
    })
  }, [model.groups, sortKey, descending])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((previous) => !previous)
      return
    }
    setSortKey(key)
    setDescending(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon icon={DashboardSpeed02Icon} className="size-4" />
          <h1 className="text-sm font-medium">流量监控</h1>
          <Badge variant="outline">演示数据</Badge>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={model.ignoreProxy}
                onChange={(event) => model.setIgnoreProxy(event.target.checked)}
              />
              忽略代理进程
            </label>
            <Button size="sm" variant="outline" onClick={model.refresh}>
              <HugeiconsIcon icon={RefreshIcon} />
              刷新
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            title="实时下载"
            value={`${formatBytes(model.status.downloadRate)}/s`}
            description={`每 ${model.status.intervalSeconds} 秒采样一次`}
          />
          <StatCard
            title="实时上传"
            value={`${formatBytes(model.status.uploadRate)}/s`}
            description={`每 ${model.status.intervalSeconds} 秒采样一次`}
          />
          <StatCard
            title="本快照合计"
            value={formatBytes(model.totals.total)}
            description={`上传 ${formatBytes(model.totals.bytesIn)} · 下载 ${formatBytes(model.totals.bytesOut)}`}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-medium">快照（增量）</span>
            <Button size="xs" variant="outline" onClick={model.saveSnapshot}>
              保存快照
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {model.snapshots.map((snapshot) => {
              const active = snapshot.id === model.selectedSnapshotId
              return (
                <button
                  key={snapshot.id}
                  type="button"
                  onClick={() => model.selectSnapshot(snapshot.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left transition-colors hover:bg-muted/50",
                    active && "bg-muted"
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {formatTimestamp(Math.floor(snapshot.savedAt / 1000))}
                    {snapshot.savedBy === "manual" ? (
                      <Badge variant="secondary">手动</Badge>
                    ) : null}
                  </span>
                  <span className="text-[0.6875rem] text-muted-foreground">
                    合计 {formatBytes(snapshot.bytesIn + snapshot.bytesOut)}
                  </span>
                  <span className="text-[0.6875rem] text-muted-foreground/70">
                    {snapshot.rangeText}
                  </span>
                </button>
              )
            })}
          </ScrollArea>
        </aside>

        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortButton
                    label="进程"
                    active={sortKey === "name"}
                    descending={descending}
                    onClick={() => toggleSort("name")}
                  />
                </TableHead>
                <TableHead className="w-28">启动者</TableHead>
                <TableHead className="w-32">PID</TableHead>
                <TableHead className="w-20">状态</TableHead>
                <TableHead className="w-24 text-right">
                  <SortButton
                    label="上传"
                    active={sortKey === "bytesIn"}
                    descending={descending}
                    onClick={() => toggleSort("bytesIn")}
                  />
                </TableHead>
                <TableHead className="w-24 text-right">
                  <SortButton
                    label="下载"
                    active={sortKey === "bytesOut"}
                    descending={descending}
                    onClick={() => toggleSort("bytesOut")}
                  />
                </TableHead>
                <TableHead className="w-24 text-right">
                  <SortButton
                    label="总计"
                    active={sortKey === "total"}
                    descending={descending}
                    onClick={() => toggleSort("total")}
                  />
                </TableHead>
                <TableHead>命令</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedGroups.map((groupItem) => {
                const expanded = model.isExpanded(groupItem.name)
                const runningPids = groupItem.children
                  .filter((item) => item.running)
                  .flatMap((item) => item.pids)
                return (
                  <Fragment key={groupItem.name}>
                    <TableRow
                      className={cn(
                        "cursor-pointer",
                        model.selected === groupItem.name && "bg-muted/60"
                      )}
                      onClick={() => model.select(groupItem.name)}
                    >
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="mr-1 inline-flex align-middle text-muted-foreground hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation()
                            model.toggleExpanded(groupItem.name)
                          }}
                        >
                          <HugeiconsIcon
                            icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
                            className="size-3.5"
                          />
                        </button>
                        {groupItem.name}
                      </TableCell>
                      <TableCell />
                      <TableCell className="text-muted-foreground">
                        {groupItem.children.flatMap((item) => item.pids).length}{" "}
                        个
                      </TableCell>
                      <TableCell>
                        <StatusBadge running={runningPids.length > 0} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBytes(groupItem.bytesIn)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBytes(groupItem.bytesOut)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBytes(groupItem.bytesIn + groupItem.bytesOut)}
                      </TableCell>
                      <TableCell className="max-w-0 truncate text-muted-foreground">
                        {groupItem.children[0]?.command}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={runningPids.length === 0}
                          title="结束进程"
                          onClick={(event) => {
                            event.stopPropagation()
                            model.terminate(groupItem.name, runningPids)
                          }}
                        >
                          <HugeiconsIcon icon={Delete02Icon} />
                        </Button>
                      </TableCell>
                    </TableRow>

                    {expanded &&
                      groupItem.children.map((childItem) => (
                        <TableRow
                          key={groupItem.name + childItem.key}
                          className={cn(
                            "cursor-pointer bg-muted/20",
                            model.selected === groupItem.name + childItem.key &&
                              "bg-muted/60"
                          )}
                          onClick={() =>
                            model.select(groupItem.name + childItem.key)
                          }
                        >
                          <TableCell className="pl-8 text-xs">
                            {childItem.scriptName}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {childItem.parent}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground tabular-nums">
                            {childItem.pids.join(", ")}
                          </TableCell>
                          <TableCell>
                            <StatusBadge running={childItem.running} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatBytes(childItem.bytesIn)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatBytes(childItem.bytesOut)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatBytes(
                              childItem.bytesIn + childItem.bytesOut
                            )}
                          </TableCell>
                          <TableCell
                            className="max-w-0 truncate text-muted-foreground"
                            title={childItem.command}
                          >
                            {childItem.command}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={!childItem.running}
                              title="结束进程"
                              onClick={(event) => {
                                event.stopPropagation()
                                model.terminate(
                                  childItem.scriptName,
                                  childItem.pids
                                )
                              }}
                            >
                              <HugeiconsIcon icon={Delete02Icon} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>
          共 {model.totals.processCount} 个进程
          {model.ignoreProxy && model.hiddenCount > 0
            ? `（已隐藏 ${model.hiddenCount} 个代理进程）`
            : ""}
        </span>
        {model.notice ? (
          <span className="text-foreground">{model.notice}</span>
        ) : null}
        <span className="ml-auto">
          {model.selectedSnapshot
            ? `快照区间 ${model.selectedSnapshot.rangeText}`
            : "尚未选择快照"}
        </span>
      </footer>
    </div>
  )
}

type StatCardProps = {
  title: string
  value: string
  description: string
}

const StatCard = (props: StatCardProps) => {
  const { title, value, description } = props
  return (
    <Card className="gap-1 py-3">
      <CardHeader className="px-4">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-lg tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

type SortButtonProps = {
  label: string
  active: boolean
  descending: boolean
  onClick: () => void
}

const SortButton = (props: SortButtonProps) => {
  const { label, active, descending, onClick } = props
  return (
    <Button
      size="xs"
      variant={active ? "secondary" : "ghost"}
      className="-ml-2"
      onClick={onClick}
    >
      {label}
      {active ? (
        <span className="text-[0.625rem]">{descending ? "▼" : "▲"}</span>
      ) : null}
    </Button>
  )
}

const StatusBadge = (props: { running: boolean }) => (
  <Badge
    variant={props.running ? "secondary" : "outline"}
    className={cn(props.running && "text-emerald-600")}
  >
    {props.running ? "运行中" : "已退出"}
  </Badge>
)
