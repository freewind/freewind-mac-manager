import { Delete02Icon, File01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { DockerContainer } from "@shared/api-contract"
import { ActionButton } from "@web/components/ActionButton"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@web/components/ui/item"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { ContainerLogsSheet } from "@web/features/docker/ContainerLogsSheet"
import {
  type ContainerAction,
  containerActionBusyLabels,
  containerActionLabels,
  containerStateLabels,
  type DangerAction,
  formatContainerPorts,
  formatContainerStartedAt,
} from "@web/features/docker/labels"
import {
  type ContainerActionInput,
  useDockerContainers,
} from "@web/features/docker/useDocker"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { useState } from "react"

/**
 * 一键可做的动作：运行中给停止/重启，非运行中给启动。
 * 终止（kill）与删除都要先二次确认，因此不在这个快捷列表里。
 */
const QUICK_ACTIONS: ContainerAction[] = ["start", "stop", "restart"]

const quickActionsFor = (container: DockerContainer): ContainerAction[] =>
  container.state === "running"
    ? QUICK_ACTIONS.filter((action) => action !== "start")
    : ["start"]

export const ContainerList = () => {
  const model = useDockerContainers()
  const isDesktop = useIsDesktop()
  const [logsFor, setLogsFor] = useState<DockerContainer | null>(null)
  const submission = useDialogSubmit(
    () => model.cancelDanger(),
    model.action.busy
  )

  const runAction = (
    container: DockerContainer,
    action: ContainerAction,
    force?: boolean
  ): void => {
    const input: ContainerActionInput = {
      containerId: container.id,
      action,
      force,
    }
    void model.action.run(input)
  }

  const pending = model.pendingDanger
  const confirmDanger = (force?: boolean): void => {
    if (!pending) return
    void submission.submit(() =>
      model.action.run({
        containerId: pending.container.id,
        action: pending.action,
        // 强制删除是显式选择：只有这条路径才带 force，后端不替用户决定
        force,
      })
    )
  }

  if (model.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">正在读取容器列表…</p>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">容器</h2>
        <p className="text-xs text-muted-foreground">
          共 {model.containers.length} 个；动作完成后列表会重新读取真实状态
        </p>
      </div>

      {model.error ? (
        <p className="text-sm text-destructive" role="alert">
          读取容器列表失败：{model.error}
        </p>
      ) : null}

      {model.containers.length === 0 ? (
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={File01Icon} />
            </EmptyMedia>
            <EmptyTitle>没有容器</EmptyTitle>
            <EmptyDescription>
              新建容器或 docker run 之后会出现在这里。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : isDesktop ? (
        <ContainerTable
          containers={model.containers}
          busy={model.action.busy}
          onAction={runAction}
          onDanger={model.requestDanger}
          onLogs={setLogsFor}
        />
      ) : (
        <ContainerCards
          containers={model.containers}
          busy={model.action.busy}
          onAction={runAction}
          onDanger={model.requestDanger}
          onLogs={setLogsFor}
        />
      )}

      <ContainerLogsSheet
        container={logsFor}
        onClose={() => setLogsFor(null)}
      />

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) model.cancelDanger()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.action === "kill"
                ? `立即终止容器 ${pending.container.name}？`
                : `删除容器 ${pending?.container.name ?? ""}？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.action === "kill"
                ? `终止会立刻杀掉容器 ${pending.container.name} 的进程（SIGKILL），进程没有清理机会，未写入的数据可能丢失；挂载的卷与绑定目录不受影响。需要优雅停止请改用「停止」。`
                : pending?.container.state === "running"
                  ? `容器 ${pending.container.name} 正在运行。删除会丢掉容器本身的文件系统改动（挂载的卷与绑定目录不受影响），但不会删除镜像与卷。可以先停止它，再删除；或者显式选择强制删除。`
                  : `容器 ${pending?.container.name ?? ""} 已停止。删除会丢掉容器本身的文件系统改动（挂载的卷与绑定目录不受影响）。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.busy}>
              取消
            </AlertDialogCancel>
            {pending?.action === "kill" ? (
              <ActionButton
                variant="destructive"
                busy={submission.busy}
                busyLabel={containerActionBusyLabels.kill}
                onClick={() => confirmDanger()}
              >
                立即终止容器 {pending.container.name}
              </ActionButton>
            ) : pending?.container.state === "running" ? (
              <ActionButton
                variant="destructive"
                busy={submission.busy}
                busyLabel={containerActionBusyLabels.remove}
                onClick={() => confirmDanger(true)}
              >
                强制删除容器 {pending.container.name}
              </ActionButton>
            ) : (
              <ActionButton
                variant="destructive"
                busy={submission.busy}
                busyLabel={containerActionBusyLabels.remove}
                onClick={() => confirmDanger()}
              >
                删除容器 {pending?.container.name ?? ""}
              </ActionButton>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

const ContainerActions = (props: {
  container: DockerContainer
  busy: boolean
  onAction: (container: DockerContainer, action: ContainerAction) => void
  onDanger: (container: DockerContainer, action: DangerAction) => void
  onLogs: (container: DockerContainer) => void
}) => (
  <div className="flex flex-wrap items-center gap-1.5">
    {quickActionsFor(props.container).map((action) => (
      <ActionButton
        key={action}
        variant="outline"
        className="min-h-11 px-3"
        busy={props.busy}
        busyLabel={containerActionBusyLabels[action]}
        onClick={() => props.onAction(props.container, action)}
      >
        {containerActionLabels[action]}
      </ActionButton>
    ))}
    {props.container.state === "running" ? (
      <Button
        variant="outline"
        className="min-h-11 px-3 text-destructive"
        disabled={props.busy}
        onClick={() => props.onDanger(props.container, "kill")}
      >
        {containerActionLabels.kill}
      </Button>
    ) : null}
    <Button
      variant="ghost"
      size="icon"
      className="size-11"
      aria-label={`查看容器 ${props.container.name} 的日志`}
      disabled={props.busy}
      onClick={() => props.onLogs(props.container)}
    >
      <HugeiconsIcon icon={File01Icon} aria-hidden="true" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      className="size-11 text-destructive"
      aria-label={`删除容器 ${props.container.name}`}
      disabled={props.busy}
      onClick={() => props.onDanger(props.container, "remove")}
    >
      <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
    </Button>
  </div>
)

const ContainerSummary = ({ container }: { container: DockerContainer }) => (
  <>
    <ItemTitle className="truncate">{container.name}</ItemTitle>
    <ItemDescription className="truncate">
      {container.image} ·{" "}
      {container.status || containerStateLabels[container.state]}
    </ItemDescription>
  </>
)

const ContainerStateBadge = ({ container }: { container: DockerContainer }) => (
  <Badge variant={container.state === "running" ? "default" : "outline"}>
    {containerStateLabels[container.state]}
  </Badge>
)

/** 手机默认视图：单列卡片，信息与动作都在列表里。 */
const ContainerCards = (props: {
  containers: DockerContainer[]
  busy: boolean
  onAction: (container: DockerContainer, action: ContainerAction) => void
  onDanger: (container: DockerContainer, action: DangerAction) => void
  onLogs: (container: DockerContainer) => void
}) => (
  <ItemGroup className="min-w-0">
    {props.containers.map((container) => (
      <Item
        key={container.id}
        variant="outline"
        className="min-w-0 flex-col items-stretch gap-2"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <ContainerSummary container={container} />
            <ContainerStateBadge container={container} />
          </div>
          <p className="text-xs text-muted-foreground">
            端口 {formatContainerPorts(container.ports)}
          </p>
          <p className="text-xs text-muted-foreground">
            启动于 {formatContainerStartedAt(container)}
          </p>
        </div>
        <ItemActions className="flex-wrap">
          <ContainerActions
            container={container}
            busy={props.busy}
            onAction={props.onAction}
            onDanger={props.onDanger}
            onLogs={props.onLogs}
          />
        </ItemActions>
      </Item>
    ))}
  </ItemGroup>
)

/** md 及以上：表格能一次看更多列。 */
const ContainerTable = (props: {
  containers: DockerContainer[]
  busy: boolean
  onAction: (container: DockerContainer, action: ContainerAction) => void
  onDanger: (container: DockerContainer, action: DangerAction) => void
  onLogs: (container: DockerContainer) => void
}) => (
  <div className="min-w-0 overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>镜像</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>端口</TableHead>
          <TableHead>启动时间</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.containers.map((container) => (
          <TableRow key={container.id}>
            <TableCell className="max-w-[16rem] truncate">
              {container.name}
            </TableCell>
            <TableCell className="max-w-[16rem] truncate">
              {container.image}
            </TableCell>
            <TableCell>
              <ContainerStateBadge container={container} />
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatContainerPorts(container.ports)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatContainerStartedAt(container)}
            </TableCell>
            <TableCell>
              <div className="flex justify-end">
                <ContainerActions
                  container={container}
                  busy={props.busy}
                  onAction={props.onAction}
                  onDanger={props.onDanger}
                  onLogs={props.onLogs}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
)
