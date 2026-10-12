import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import type { BackupDeleteOutcome } from "./useBackupActions"

/**
 * 删除结果常驻提示。
 *
 * 删除是逐条结果，所以标题只说实际发生了什么：一份都没删掉时写「没有删除任何
 * 备份」，绝不写成「删除成功」；有失败就把「文件名：原因」逐条列出来。
 */
export const DeleteResultAlert = (props: {
  outcome: BackupDeleteOutcome
  onDismiss: () => void
}) => {
  const { deleted, failed } = props.outcome
  const title =
    deleted.length === 0
      ? "没有删除任何备份"
      : failed.length === 0
        ? `已删除 ${deleted.length} 份备份`
        : `删除了 ${deleted.length} 份，另有 ${failed.length} 份没有删除`

  return (
    <Alert variant={failed.length === 0 ? "default" : "destructive"}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-1">
        {failed.length === 0 ? null : (
          <>
            <span className="block">
              下面这些备份仍在列表里（失败条目保持选中，可以看清后重新处理）：
            </span>
            {failed.map((item) => (
              <span key={item.id} className="block">
                <span className="font-mono break-all">{item.fileName}</span>
                {`：${item.message}`}
              </span>
            ))}
          </>
        )}
        <span className="block">列表已经重新读取，以服务端为准。</span>
      </AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="sm" onClick={props.onDismiss}>
          知道了
        </Button>
      </AlertAction>
    </Alert>
  )
}
