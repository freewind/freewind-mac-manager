import type { CaddyVersionSummary } from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"
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
import { Badge } from "@web/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Skeleton } from "@web/components/ui/skeleton"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { History } from "lucide-react"
import { useState } from "react"
import { CADDY_APPLY_STATUS_LABELS, caddyApplyStatusVariant } from "../format"

type VersionPanelProps = {
  versions: CaddyVersionSummary[]
  isLoading: boolean
  error: string | null
  /** 恢复进行中（含受理后等待终结）。 */
  busy: boolean
  /** 非空表示现在不能恢复（离线或读取失败）。 */
  disabledReason: string | null
  onRestore: (versionId: string) => Promise<boolean>
}

/** 历史版本与恢复：恢复同样是写文件 + 重新加载，因此要二次确认。 */
export const VersionPanel = (props: VersionPanelProps) => {
  const [pending, setPending] = useState<CaddyVersionSummary | null>(null)
  const disabled = props.busy || props.disabledReason !== null

  useHistoryOverlay(pending !== null, () => setPending(null))

  const confirm = async (): Promise<boolean> => {
    const version = pending
    if (version === null) return false
    const done = await props.onRestore(version.id)
    if (done) setPending(null)
    return done
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">应用历史</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3 px-4">
        {props.isLoading ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">正在读取应用历史…</p>
            <Skeleton className="h-16 w-full" />
          </div>
        ) : props.error ? (
          <Alert variant="destructive">
            <AlertTitle>读取应用历史失败</AlertTitle>
            <AlertDescription>{props.error}</AlertDescription>
          </Alert>
        ) : props.versions.length === 0 ? (
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History />
              </EmptyMedia>
              <EmptyTitle>还没有应用历史</EmptyTitle>
              <EmptyDescription>
                第一次应用变更后会在这里留下一份版本，可以随时恢复。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {props.versions.map((version) => (
              <li
                key={version.id}
                className="flex min-w-0 flex-col gap-2 rounded-lg border p-3"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {formatTimestamp(version.appliedAt)}
                  </span>
                  <Badge variant={caddyApplyStatusVariant(version.status)}>
                    {CADDY_APPLY_STATUS_LABELS[version.status]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {version.ruleCount} 条规则
                  </span>
                  <ActionButton
                    variant="outline"
                    className="ml-auto px-3"
                    busy={props.busy && pending?.id === version.id}
                    busyLabel="恢复中"
                    disabled={disabled}
                    onClick={() => setPending(version)}
                  >
                    恢复此版本
                  </ActionButton>
                </div>
                <p className="text-xs break-words text-muted-foreground">
                  {version.message}
                </p>
              </li>
            ))}
          </ul>
        )}

        {props.disabledReason ? (
          <p className="text-xs text-muted-foreground" role="status">
            {props.disabledReason}
          </p>
        ) : null}
      </CardContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              恢复 {pending ? formatTimestamp(pending.appliedAt) : ""} 的版本？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该版本有 {pending?.ruleCount ?? 0} 条规则。
              恢复会把数据库里的规则整体换回这一版本，重新生成受管区域并重新加载
              Caddy；当前未应用的改动会丢失。
              {pending?.status === "success"
                ? ""
                : "这一版本当时没有成功应用（失败或结果未知），恢复后需要重新核实运行配置。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={props.busy}>取消</AlertDialogCancel>
            <ActionButton
              busy={props.busy}
              busyLabel="恢复中"
              onClick={() => void confirm()}
            >
              恢复此版本
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
