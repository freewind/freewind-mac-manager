import type { DockerVolume } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
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
import { useDockerVolumes } from "@web/features/docker/useDocker"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { Database, Trash2 } from "lucide-react"

const sizeTextOf = (volume: DockerVolume): string =>
  volume.sizeBytes === null ? "未知" : formatBytes(volume.sizeBytes)

export const VolumeList = () => {
  const model = useDockerVolumes()
  const isDesktop = useIsDesktop()
  const submission = useDialogSubmit(
    () => model.cancelRemove(),
    model.action.busy
  )
  const pending = model.pendingRemove

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">卷</h2>
        <p className="text-xs text-muted-foreground">
          {model.isLoading
            ? "被容器使用的卷不能删除"
            : `共 ${model.volumes.length} 个；被容器使用的卷不能删除`}
        </p>
      </div>

      {model.error ? (
        <p className="text-sm text-destructive" role="alert">
          读取卷列表失败：{model.error}
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
          <p className="text-sm text-muted-foreground">正在读取卷列表…</p>
          <Skeleton className="h-20 w-full" />
        </div>
      ) : model.volumes.length === 0 ? (
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Database />
            </EmptyMedia>
            <EmptyTitle>没有卷</EmptyTitle>
            <EmptyDescription>
              容器或 docker volume create 创建的卷会出现在这里。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : isDesktop ? (
        <VolumeTable
          volumes={model.volumes}
          busy={model.action.busy}
          onRemove={model.requestRemove}
        />
      ) : (
        <VolumeCards
          volumes={model.volumes}
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
            <AlertDialogTitle>删除卷 {pending?.name ?? ""}？</AlertDialogTitle>
            <AlertDialogDescription>
              删除会永久丢掉这个卷里的数据（挂载它的容器若仍在使用，docker
              会拒绝删除）； 镜像、容器与网络不受影响。
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
                  model.action.run({ name: pending.name })
                )
              }}
            >
              删除卷 {pending?.name ?? ""}
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

const VolumeSummary = ({ volume }: { volume: DockerVolume }) => (
  <>
    <p className="truncate font-medium">{volume.name}</p>
    <p className="truncate text-xs text-muted-foreground">
      驱动 {volume.driver} · {sizeTextOf(volume)} · 挂载点{" "}
      {volume.mountpoint || "—"}
    </p>
  </>
)

/** 被容器使用的卷：按钮禁用并说明原因（后端 409 仍是兜底）。 */
const RemoveVolumeButton = (props: {
  volume: DockerVolume
  busy: boolean
  onRemove: (volume: DockerVolume) => void
}) => {
  const inUse = props.volume.inUse
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 text-destructive"
      aria-label={`删除卷 ${props.volume.name}`}
      disabled={props.busy || inUse}
      onClick={() => props.onRemove(props.volume)}
    >
      <Trash2 aria-hidden="true" />
    </Button>
  )
}

const VolumeCards = (props: {
  volumes: DockerVolume[]
  busy: boolean
  onRemove: (volume: DockerVolume) => void
}) => (
  <ul className="flex min-w-0 flex-col gap-2">
    {props.volumes.map((volume) => (
      <li
        key={volume.name}
        className="flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2.5"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <VolumeSummary volume={volume} />
          <p className="text-xs text-muted-foreground">
            {volume.inUse
              ? "正被容器使用，不能删除（请先删除相关容器）"
              : "没有容器使用"}
          </p>
        </div>
        <div className="flex justify-end">
          <RemoveVolumeButton
            volume={volume}
            busy={props.busy}
            onRemove={props.onRemove}
          />
        </div>
      </li>
    ))}
  </ul>
)

const VolumeTable = (props: {
  volumes: DockerVolume[]
  busy: boolean
  onRemove: (volume: DockerVolume) => void
}) => (
  <div className="min-w-0 overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">驱动</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">大小</TableHead>
          <TableHead>挂载点</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">被容器使用</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap text-right">
            操作
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.volumes.map((volume) => (
          <TableRow key={volume.name}>
            <TableCell className="max-w-0">
              <Tooltip>
                <TooltipTrigger
                  render={<span className="block truncate">{volume.name}</span>}
                />
                <TooltipContent className="max-w-lg break-all">
                  {volume.name}
                </TooltipContent>
              </Tooltip>
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              {volume.driver}
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              {sizeTextOf(volume)}
            </TableCell>
            <TableCell className="max-w-0 text-xs text-muted-foreground">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="block truncate">
                      {volume.mountpoint || "—"}
                    </span>
                  }
                />
                <TooltipContent className="max-w-lg break-all">
                  {volume.mountpoint || "—"}
                </TooltipContent>
              </Tooltip>
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              {volume.inUse ? "使用中（不能删除）" : "—"}
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              <div className="flex justify-end">
                <RemoveVolumeButton
                  volume={volume}
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
