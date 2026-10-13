import type { DatabaseBackup } from "@shared/api-contract"
import { formatBytes, formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Button } from "@web/components/ui/button"
import { SOURCE_LABELS } from "./labels"

/** 最多逐条列出多少个目标；更多的只报数量，避免确认框被撑爆。 */
const LISTED_TARGETS = 10

export type DeleteBackupsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 选中的备份：带列表当时读到的内容签名。 */
  targets: DatabaseBackup[]
  busy: boolean
  failure: string | null
  /** 结果未知：禁止再次提交，只能重新读取核实。 */
  unknownNotice: string | null
  onVerify: () => void
  onDismissUnknown: () => void
  onConfirm: () => void
}

/**
 * 删除确认：逐条写清删的是哪些备份（文件名、大小、来源、时间），
 * 以及其中有多少份本来可以用于恢复；按钮用动作化文案。
 */
export const DeleteBackupsDialog = (props: DeleteBackupsDialogProps) => {
  const count = props.targets.length
  const totalBytes = props.targets.reduce(
    (sum, backup) => sum + backup.sizeBytes,
    0
  )
  const restorable = props.targets.filter(
    (backup) => backup.restoreBlockedReason === null
  ).length
  const blockedByUnknown = props.unknownNotice !== null

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>删除 {count} 份备份？</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-left">
            <span className="block">
              删除对象（最多列出 {LISTED_TARGETS} 条）：
              {props.targets.slice(0, LISTED_TARGETS).map((backup) => (
                <span key={backup.id} className="block">
                  <span className="font-mono break-all">{backup.fileName}</span>
                  {` · ${formatBytes(backup.sizeBytes)} · ${
                    SOURCE_LABELS[backup.source]
                  } · ${formatTimestamp(backup.createdAt / 1000)}`}
                </span>
              ))}
              {count > LISTED_TARGETS
                ? `……以及另外 ${count - LISTED_TARGETS} 份`
                : ""}
            </span>
            <span className="block">
              共 {count} 份，合计 {formatBytes(totalBytes)}
              ；其中 {restorable} 份本来可用于恢复。
            </span>
            <span className="block">
              删除不可恢复：这些文件会从备份目录里移除，之后不能再用于恢复。
              服务端会按提交的内容签名逐个复核，被替换过的备份不会被删除。
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {props.failure === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>删除没有提交成功</AlertTitle>
            <AlertDescription>{props.failure}</AlertDescription>
          </Alert>
        )}

        {props.unknownNotice === null ? null : (
          <Alert>
            <AlertTitle>结果未知</AlertTitle>
            <AlertDescription className="space-y-2">
              <span>{props.unknownNotice}</span>
              <span className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={props.onVerify}>
                  重新读取核实
                </Button>
                <Button variant="ghost" onClick={props.onDismissUnknown}>
                  已核对，继续
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.busy}>保留备份</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={props.busy || blockedByUnknown}
            onClick={props.onConfirm}
          >
            {props.busy ? "正在删除…" : `删除这 ${count} 份备份`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
