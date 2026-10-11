import type { DockerColimaStatus } from "@shared/api-contract"
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { colimaStateOf, useDockerColima } from "@web/features/docker/useDocker"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"

const COLIMA_TONE: Record<ReturnType<typeof colimaStateOf>, string> = {
  running: "text-emerald-600",
  stopped: "text-amber-600",
  missing: "text-muted-foreground",
}

const STATE_LABELS: Record<ReturnType<typeof colimaStateOf>, string> = {
  running: "运行中",
  stopped: "未运行",
  missing: "未安装",
}

/** 停止 / 重启会影响正在运行的容器数量，确认文案要把影响范围说清楚。 */
const impactOf = (action: "stop" | "restart", running: number): string =>
  action === "stop"
    ? `停止 Colima 会同时停止全部正在运行的容器（当前 ${running} 个），Docker 能力会一直不可用，直到再次启动。`
    : `重启 Colima 会先停止再启动虚拟机，正在运行的 ${running} 个容器会被中断（容器本身与卷、镜像不会被删除）。`

const confirmLabelOf = (action: "stop" | "restart", running: number): string =>
  action === "stop"
    ? `停止 Colima 并停止 ${running} 个容器`
    : `重启 Colima（会中断 ${running} 个容器）`

type ColimaCardProps = {
  /** 概览里的状态，用于首屏渲染；卡片自己的查询结果更新后会替换它。 */
  colima: DockerColimaStatus
  /** 正在运行的容器数：停止/重启的影响范围。 */
  runningContainers: number
}

/** Colima 卡片：状态 + 按状态给出的启动 / 停止 / 重启入口。 */
export const ColimaCard = (props: ColimaCardProps) => {
  const model = useDockerColima()
  const colima = model.colima ?? props.colima
  const state = colimaStateOf(colima)
  const busy = model.action.busy
  const pending = model.pending
  // 只有停止与重启需要确认，启动走直接执行
  const pendingDanger: "stop" | "restart" | null =
    pending === "stop" || pending === "restart" ? pending : null
  const submission = useDialogSubmit(
    () => model.cancelAction(),
    model.action.busy
  )

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Colima</CardTitle>
        <CardDescription>{colima.status}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className={`text-2xl font-medium ${COLIMA_TONE[state]}`}>
          {STATE_LABELS[state]}
        </p>
        <p className="text-xs text-muted-foreground">
          {state === "missing"
            ? "未安装 colima，Docker 能力不可用"
            : `runtime ${colima.runtime ?? "—"} · 架构 ${colima.arch ?? "—"}`}
        </p>

        {model.failure ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Colima 操作没有完成</AlertTitle>
            <AlertDescription>{model.failure}</AlertDescription>
          </Alert>
        ) : null}

        {state === "missing" ? (
          <p className="text-xs text-muted-foreground">
            未安装时不提供启动/停止操作，请先在系统里安装 Colima。
          </p>
        ) : state === "running" ? (
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              className="min-h-11 px-3"
              disabled={busy}
              onClick={() => model.requestAction("stop")}
            >
              停止
            </Button>
            <Button
              variant="outline"
              className="min-h-11 px-3"
              disabled={busy}
              onClick={() => model.requestAction("restart")}
            >
              重启
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="min-h-11 self-start px-3"
            disabled={busy}
            onClick={() => {
              // 启动不影响现有容器，不需要二次确认
              void model.action.run({ action: "start" })
            }}
          >
            启动
          </Button>
        )}
      </CardContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) model.cancelAction()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDanger === "stop"
                ? `停止 Colima 并停止 ${props.runningContainers} 个容器？`
                : `重启 Colima（会中断 ${props.runningContainers} 个容器）？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDanger
                ? impactOf(pendingDanger, props.runningContainers)
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.busy}>
              取消
            </AlertDialogCancel>
            <ActionButton
              variant="destructive"
              busy={submission.busy}
              busyLabel={pendingDanger === "stop" ? "正在停止…" : "正在重启…"}
              onClick={() => {
                if (!pendingDanger) return
                void submission.submit(() =>
                  model.action.run({ action: pendingDanger })
                )
              }}
            >
              {pendingDanger
                ? confirmLabelOf(pendingDanger, props.runningContainers)
                : ""}
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
