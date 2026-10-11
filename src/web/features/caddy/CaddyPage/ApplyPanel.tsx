import type { CaddyRuleChanges } from "@shared/api-contract"
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useState } from "react"
import { changeSummaryOf, describeChanges } from "../format"

type ApplyPanelProps = {
  changes: CaddyRuleChanges
  /** 将要写入受管区域的正文，应用前给用户看。 */
  previewText: string
  writable: boolean
  blockedReason: string | null
  hasUnappliedChanges: boolean
  /** 应用进行中（含受理后等待终结）。 */
  busy: boolean
  /** 非空表示现在不能应用（离线或读取失败）。 */
  disabledReason: string | null
  onApply: () => Promise<boolean>
}

/**
 * 变更预览与应用。
 *
 * 预览是唯一「将要写进文件的内容」来源：用户确认的是这份文本与变更条数，
 * 不是一句「确定」。
 */
export const ApplyPanel = (props: ApplyPanelProps) => {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const groups = describeChanges(props.changes)
  const summary = changeSummaryOf(props.changes)

  useHistoryOverlay(confirmOpen, () => setConfirmOpen(false))

  const blockedHint =
    props.disabledReason ??
    (props.writable ? null : props.blockedReason) ??
    (props.hasUnappliedChanges ? null : "当前没有未应用的变更")
  const disabled = blockedHint !== null

  const apply = async (): Promise<boolean> => {
    const done = await props.onApply()
    if (done) setConfirmOpen(false)
    return done
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">变更预览</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3 px-4">
        <p className="text-xs text-muted-foreground">
          {summary.total === 0
            ? "数据库里的规则与上次成功应用的内容一致，没有要写入的变更。"
            : `相对上次成功应用共 ${summary.total} 处变化：${summary.text}。`}
        </p>

        {groups.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {groups.map((group) => (
              <li key={group.key} className="flex flex-col gap-1">
                <span className="text-xs font-medium">
                  {group.label}（{group.items.length}）
                </span>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li
                      key={`${group.key}-${item}`}
                      className="text-xs break-words text-muted-foreground"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium">将要写入受管区域的正文</span>
          {props.previewText === "" ? (
            <p className="text-xs text-muted-foreground">
              受管区域里没有任何规则（全部停用或没有规则）。
            </p>
          ) : (
            <div className="max-w-full overflow-x-auto rounded-md border bg-muted/40">
              <pre className="w-max min-w-full p-3 font-mono text-xs whitespace-pre">
                {props.previewText}
              </pre>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            className="min-h-11 px-4"
            busy={props.busy}
            busyLabel="应用并重新加载中"
            disabled={disabled}
            onClick={() => setConfirmOpen(true)}
          >
            应用变更
          </ActionButton>
          {blockedHint ? (
            <p className="text-xs text-muted-foreground" role="status">
              现在不能应用：{blockedHint}
            </p>
          ) : null}
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>应用变更并重新加载 Caddy？</AlertDialogTitle>
            <AlertDialogDescription>
              这次会{summary.text || "没有变化"}
              ，共 {summary.total} 处变化；确认后先备份当前 Caddyfile，
              再写入受管区域并重新加载 Caddy（不会重启服务）。
              加载失败会自动还原文件；加载后若核实不到全部规则，会记为失败并提示恢复上一版本。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={props.busy}>取消</AlertDialogCancel>
            <ActionButton
              className="min-h-11"
              busy={props.busy}
              busyLabel="应用并重新加载中"
              onClick={() => void apply()}
            >
              应用变更
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
