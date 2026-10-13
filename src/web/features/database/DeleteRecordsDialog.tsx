import type {
  DatabaseRecordLocatorKey,
  DatabaseTable,
} from "@shared/api-contract"
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
import { formatRecordKey } from "./format"

export type DeleteTarget = {
  key: DatabaseRecordLocatorKey
  expectedSignature: string
}

/** 最多逐条列出多少个目标；更多的只报数量，避免确认框被撑爆。 */
const LISTED_TARGETS = 10

export type DeleteRecordsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: DatabaseTable
  targets: DeleteTarget[]
  busy: boolean
  failure: string | null
  /** 结果未知：禁止再次提交，只能重新读取核实。 */
  unknownNotice: string | null
  onVerify: () => void
  onDismissUnknown: () => void
  onConfirm: () => void
}

/**
 * 删除确认：用官方 AlertDialog，写清删的是哪张表、哪些记录、几条，
 * 以及外键级联与写触发器可能带来的额外影响；按钮用动作化文案。
 */
export const DeleteRecordsDialog = (props: DeleteRecordsDialogProps) => {
  const count = props.targets.length
  const cascades = props.table.referencedBy.filter(
    (item) => item.onDelete !== "NO ACTION"
  )
  const blockedByUnknown = props.unknownNotice !== null

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>删除 {count} 条记录？</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-left">
            <span className="block">
              目标表：<span className="font-mono">{props.table.name}</span>
              ；已选 {count} 条。
            </span>
            <span className="block">
              {count === 1 ? (
                <>
                  主键：
                  <span className="font-mono">
                    {formatRecordKey(props.targets[0].key)}
                  </span>
                </>
              ) : (
                <>
                  删除对象（最多列出 {LISTED_TARGETS} 条）：
                  {props.targets.slice(0, LISTED_TARGETS).map((target) => (
                    <span
                      key={formatRecordKey(target.key)}
                      className="block font-mono"
                    >
                      {formatRecordKey(target.key)}
                    </span>
                  ))}
                  {count > LISTED_TARGETS
                    ? `……以及另外 ${count - LISTED_TARGETS} 条`
                    : ""}
                </>
              )}
            </span>
            <span className="block">
              批量删除要么全部成功，要么整批回滚：任何一条冲突或不存在都不会部分删除。
            </span>
            {cascades.length === 0 ? null : (
              <span className="block">
                级联影响：
                {cascades
                  .map(
                    (item) =>
                      `${item.table}(${item.columns.join("，")}) ON DELETE ${item.onDelete}`
                  )
                  .join("；")}
                ，删除会连带影响这些表的数据。
              </span>
            )}
            {props.table.triggers.length === 0 ? null : (
              <span className="block">
                本表有写触发器（{props.table.triggers.join("，")}
                ）：触发器可能带来额外业务影响。
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {props.failure === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>删除失败</AlertTitle>
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
          <AlertDialogCancel disabled={props.busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={props.busy || blockedByUnknown}
            onClick={props.onConfirm}
          >
            {props.busy ? "正在删除…" : `删除 ${count} 条记录`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
