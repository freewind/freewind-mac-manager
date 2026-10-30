import type { AiCallSettingsResponse } from "@shared/api-contract"
import { Button } from "@web/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import { Label } from "@web/components/ui/label"
import { Skeleton } from "@web/components/ui/skeleton"
import { Textarea } from "@web/components/ui/textarea"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { RotateCcw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useAiCallSettingsQuery, useSaveAiCallSettings } from "./queries"

/**
 * 通话设置：只改提示词。
 *
 * 模型不在这里选：通话就是 AI 助手的语音形态，沿用助手那份设置，
 * 免得用户为同一个模型配两遍。
 *
 * 提示词只写「语气、打断习惯」这类用户偏好；「只能通过 speak 说话」
 * 的硬规则由服务端在自定义提示词后强制追加，这里删不掉。
 */
export const CallSettingsDialog = (props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  useHistoryOverlay(props.open, () => props.onOpenChange(false))
  const settingsQuery = useAiCallSettingsQuery()
  const save = useSaveAiCallSettings()
  const [draft, setDraft] = useState<string | null>(null)
  const [signature, setSignature] = useState<string | null>(null)

  const data: AiCallSettingsResponse | undefined = settingsQuery.data
  // 服务端内容第一次到达、或保存后 signature 变了，就把草稿同步一次；
  // 用户编辑期间不会被后台刷新覆盖。
  if (data && signature !== data.signature) {
    setSignature(data.signature)
    setDraft(data.settings.systemPrompt ?? "")
  }

  const current = draft ?? ""
  const defaultPrompt = data?.defaults.systemPrompt ?? ""
  const custom = current.trim() !== ""

  const submit = (): void => {
    if (!data) return
    save.mutate(
      {
        signature: data.signature,
        settings: custom ? { systemPrompt: current } : {},
        clearFields: custom ? [] : ["systemPrompt"],
      },
      {
        onSuccess: () => {
          toast.success("通话设置已保存")
          props.onOpenChange(false)
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : "保存失败，请重试"
          )
        },
      }
    )
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>通话设置</DialogTitle>
          <DialogDescription>
            决定它怎么说话、什么时候打断你。留空即使用默认提示词。
          </DialogDescription>
        </DialogHeader>
        {settingsQuery.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : settingsQuery.isError ? (
          <p className="text-sm text-destructive">读取通话设置失败</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="call-prompt">自定义提示词</Label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDraft("")}
                disabled={!custom}
              >
                <RotateCcw aria-hidden />
                恢复默认
              </Button>
            </div>
            <Textarea
              id="call-prompt"
              value={current}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={defaultPrompt}
              className="min-h-48 font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              「只能通过 speak 说话」的规则会自动追加，不用自己写。
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={save.isPending || !data}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
