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
import { Checkbox } from "@web/components/ui/checkbox"
import { Label } from "@web/components/ui/label"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { SOURCE_LABELS, shortSignature } from "./labels"

const copySignature = async (signature: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(signature)
    toast("已复制完整内容签名")
  } catch {
    toast.error("复制失败，请检查浏览器剪贴板权限")
  }
}

export type RestorePlanDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 选中的备份；带列表当时读到的内容签名。 */
  backup: DatabaseBackup | null
  busy: boolean
  failure: string | null
  unknownNotice: string | null
  backupCurrent: boolean
  onBackupCurrentChange: (next: boolean) => void
  onVerify: () => void
  onDismissUnknown: () => void
  onConfirm: () => void
}

/**
 * 恢复确认：写清目标备份的事实与「提交 ≠ 已恢复」，让用户在按下去之前
 * 就知道重启后会发生什么。当前库签名不在此展示：核实由服务端在恢复
 * 执行时完成（完整性与结构复验），确认阶段不做 GB 级字节比对。
 */
export const RestorePlanDialog = (props: RestorePlanDialogProps) => {
  const backup = props.backup
  if (backup === null) return null
  const blocked = backup.restoreBlockedReason
  const blockedByUnknown = props.unknownNotice !== null
  const cannotRestore = blocked !== null || !backup.integrity.ok

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>安排在下次启动时恢复？</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-left">
            <span className="block font-mono break-all text-foreground">
              {backup.fileName}
            </span>
            <span className="block">
              {`${formatBytes(backup.sizeBytes)} · ${
                SOURCE_LABELS[backup.source]
              } · 创建于 ${formatTimestamp(backup.createdAt / 1000)}`}
            </span>
            <span className="block">
              {backup.tableCount === null || backup.rowCount === null
                ? "规模：尚未统计"
                : `规模：${backup.tableCount} 表 / ${backup.rowCount} 行`}
            </span>
            <span className="block">
              {backup.integrity.ok
                ? "文件完整性：完整"
                : `文件完整性：不完整（${backup.integrity.reason}）`}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 rounded-md border p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">这份备份的签名</span>
            <span className="font-mono">
              {shortSignature(backup.contentSignature)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copySignature(backup.contentSignature)}
            >
              <Copy aria-hidden="true" />
              复制完整签名
            </Button>
          </div>
        </div>

        {blocked === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>这份备份不能用于恢复</AlertTitle>
            <AlertDescription>
              {blocked}：它仍可以在列表里查看与删除，但不会替换应用数据库。
            </AlertDescription>
          </Alert>
        )}

        {backup.integrity.ok ? null : (
          <Alert variant="destructive">
            <AlertTitle>文件完整性检查没有通过</AlertTitle>
            <AlertDescription>{backup.integrity.reason}</AlertDescription>
          </Alert>
        )}

        {/* 关键影响用大字说明：这不是「立刻恢复」 */}
        <Alert className="px-3 py-2">
          <AlertDescription>
            <span className="block text-base leading-relaxed font-semibold text-foreground">
              提交后不会立刻恢复：计划在下次启动应用时执行，届时当前数据库会被整份替换；重启前可以取消。
            </span>
          </AlertDescription>
        </Alert>

        <div className="flex items-start gap-2">
          <Checkbox
            id="backup-current"
            checked={props.backupCurrent}
            onCheckedChange={(checked) =>
              props.onBackupCurrentChange(checked === true)
            }
          />
          <Label htmlFor="backup-current" className="text-xs">
            恢复前先自动生成一份当前库的备份（来源标记为「恢复前自动」）
          </Label>
        </div>

        {props.failure === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>没有建立恢复计划</AlertTitle>
            <AlertDescription>{props.failure}</AlertDescription>
          </Alert>
        )}

        {props.unknownNotice === null ? null : (
          <Alert>
            <AlertTitle>结果未知</AlertTitle>
            <AlertDescription className="space-y-2">
              <span>{props.unknownNotice}</span>
              <span className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={props.onVerify}
                >
                  重新读取核实
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={props.onDismissUnknown}
                >
                  已核对，继续
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11" disabled={props.busy}>
            暂不恢复
          </AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11"
            disabled={props.busy || blockedByUnknown || cannotRestore}
            onClick={props.onConfirm}
          >
            {props.busy ? "正在提交…" : "安排在下次启动时恢复"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
