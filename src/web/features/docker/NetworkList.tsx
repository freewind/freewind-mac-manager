import { Delete02Icon, EthernetPortIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { DockerNetwork } from "@shared/api-contract"
import { ActionButton } from "@web/components/ActionButton"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Button } from "@web/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
import { useDockerNetworks } from "@web/features/docker/useDocker"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useIsDesktop } from "@web/hooks/use-is-desktop"

export const BUILTIN_NETWORK_HINT = "Docker 内置网络，不能删除"

export const NetworkList = () => {
  const model = useDockerNetworks()
  const isDesktop = useIsDesktop()
  const submission = useDialogSubmit(
    () => model.cancelRemove(),
    model.action.busy
  )
  const pending = model.pendingRemove

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">网络</h2>
        <p className="text-xs text-muted-foreground">
          {model.isLoading
            ? "内置网络不能删除"
            : `共 ${model.networks.length} 个；内置网络不能删除`}
        </p>
      </div>

      {model.error ? (
        <p className="text-sm text-destructive" role="alert">
          读取网络列表失败：{model.error}
        </p>
      ) : null}

      {model.failure ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>操作没有完成</AlertTitle>
          <AlertDescription>{model.failure}</AlertDescription>
        </Alert>
      ) : null}

      {model.isLoading ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">正在读取网络列表…</p>
          <Skeleton className="h-20 w-full" />
        </div>
      ) : model.networks.length === 0 ? (
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={EthernetPortIcon} />
            </EmptyMedia>
            <EmptyTitle>没有网络</EmptyTitle>
            <EmptyDescription>
              docker network create 或容器编排创建的网络会出现在这里。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : isDesktop ? (
        <NetworkTable
          networks={model.networks}
          busy={model.action.busy}
          onRemove={model.requestRemove}
        />
      ) : (
        <NetworkCards
          networks={model.networks}
          busy={model.action.busy}
          onRemove={model.requestRemove}
        />
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) model.cancelRemove()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除网络 {pending?.name ?? ""}？
            </AlertDialogTitle>
            <AlertDialogDescription>
              网络 {pending?.name ?? ""}
              当前有 {pending?.containers ?? 0}{" "}
              个容器接入。删除只影响这个自定义网络，
              不会删除容器、镜像与卷；若仍有容器接入，docker 会拒绝删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.busy}>
              取消
            </AlertDialogCancel>
            <ActionButton
              variant="destructive"
              busy={submission.busy}
              busyLabel="正在删除…"
              onClick={() => {
                if (!pending) return
                void submission.submit(() =>
                  model.action.run({ networkId: pending.id })
                )
              }}
            >
              删除网络 {pending?.name ?? ""}
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

const NetworkSummary = ({ network }: { network: DockerNetwork }) => (
  <>
    <p className="truncate font-medium">{network.name}</p>
    <p className="truncate text-xs text-muted-foreground">
      驱动 {network.driver} · scope {network.scope} · 接入 {network.containers}{" "}
      个容器
    </p>
  </>
)

/** 内置网络：按钮禁用并说明原因；其余网络走确认流程。 */
const RemoveNetworkButton = (props: {
  network: DockerNetwork
  busy: boolean
  onRemove: (network: DockerNetwork) => void
}) => (
  <Button
    variant="ghost"
    size="icon"
    className="size-11 text-destructive"
    aria-label={`删除网络 ${props.network.name}`}
    disabled={props.busy || props.network.builtin}
    onClick={() => props.onRemove(props.network)}
  >
    <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
  </Button>
)

const NetworkCards = (props: {
  networks: DockerNetwork[]
  busy: boolean
  onRemove: (network: DockerNetwork) => void
}) => (
  <ul className="flex min-w-0 flex-col gap-2">
    {props.networks.map((network) => (
      <li
        key={network.id}
        className="flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2.5"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <NetworkSummary network={network} />
          <p className="text-xs text-muted-foreground">
            {network.builtin
              ? BUILTIN_NETWORK_HINT
              : network.containers > 0
                ? "仍有容器接入，删除会被拒绝（请先断开）"
                : "没有容器接入"}
          </p>
        </div>
        <div className="flex justify-end">
          <RemoveNetworkButton
            network={network}
            busy={props.busy}
            onRemove={props.onRemove}
          />
        </div>
      </li>
    ))}
  </ul>
)

const NetworkTable = (props: {
  networks: DockerNetwork[]
  busy: boolean
  onRemove: (network: DockerNetwork) => void
}) => (
  <div className="min-w-0 overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">驱动</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">scope</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">接入容器</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">说明</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap text-right">
            操作
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.networks.map((network) => (
          <TableRow key={network.id}>
            <TableCell className="max-w-0">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="block truncate">{network.name}</span>
                  }
                />
                <TooltipContent className="max-w-lg break-all">
                  {network.name}
                </TooltipContent>
              </Tooltip>
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              {network.driver}
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              {network.scope}
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              {network.containers}
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap text-xs text-muted-foreground">
              {network.builtin
                ? BUILTIN_NETWORK_HINT
                : network.containers > 0
                  ? "仍有容器接入"
                  : "—"}
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              <div className="flex justify-end">
                <RemoveNetworkButton
                  network={network}
                  busy={props.busy}
                  onRemove={props.onRemove}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
)
