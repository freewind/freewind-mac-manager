import { Button } from "@web/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import { Input } from "@web/components/ui/input"
import { Textarea } from "@web/components/ui/textarea"
import { Field } from "./fields"
import type { ProviderDraft } from "./provider-drafts"

export type ProviderDraftDialogProps = {
  /** null 表示弹窗关闭。 */
  draft: ProviderDraft | null
  /** 非空表示在编辑该 provider（影响标题、密钥提示与模型列表入口）。 */
  editingId: string | null
  /** 正在编辑的 provider 是否已保存过密钥（决定是否显示「清除密钥」勾选）。 */
  hasSavedKey: boolean
  save: { isPending: boolean; mutate: () => void }
  /** models 配置是否已读到：没读到前不允许提交。 */
  canSave: boolean
  onChange: (draft: ProviderDraft) => void
  /** 用户试图关闭弹层且不在保存中时调用（页面负责复位草稿与编辑态）。 */
  onDismiss: () => void
  /** 点击「取消」按钮：只收起草稿，不清理编辑态，与既有行为一致。 */
  onCancel: () => void
}

/** 新增/编辑 Provider 的弹窗：编辑时不改模型列表，模型在卡片上逐条增删。 */
export const ProviderDraftDialog = (props: ProviderDraftDialogProps) => {
  const { draft, editingId, save } = props
  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open && !save.isPending) props.onDismiss()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editingId ? "编辑 Provider" : "新增 Provider"}
          </DialogTitle>
          <DialogDescription>
            {editingId
              ? "留空密钥会保留已有值；模型请在卡片上逐条添加或删除。"
              : "留空密钥会保留已有值；所有模型使用 Pi models.json 原生字段。"}
          </DialogDescription>
        </DialogHeader>
        {draft ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider ID">
              <Input
                value={draft.providerId}
                onChange={(event) =>
                  props.onChange({ ...draft, providerId: event.target.value })
                }
              />
            </Field>
            <Field label="显示名称">
              <Input
                value={draft.name}
                onChange={(event) =>
                  props.onChange({ ...draft, name: event.target.value })
                }
              />
            </Field>
            <Field label="Base URL">
              <Input
                value={draft.baseUrl}
                onChange={(event) =>
                  props.onChange({ ...draft, baseUrl: event.target.value })
                }
              />
            </Field>
            <Field label="API 协议">
              <Input
                value={draft.api}
                onChange={(event) =>
                  props.onChange({ ...draft, api: event.target.value })
                }
              />
            </Field>
            <Field label="API Key（留空保留已保存密钥）">
              <Input
                type="password"
                autoComplete="new-password"
                value={draft.apiKey}
                onChange={(event) =>
                  props.onChange({ ...draft, apiKey: event.target.value })
                }
              />
            </Field>
            {editingId && props.hasSavedKey ? (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={draft.clearApiKey}
                  onChange={(event) =>
                    props.onChange({
                      ...draft,
                      clearApiKey: event.target.checked,
                    })
                  }
                />
                清除已保存密钥
              </label>
            ) : null}
            {editingId === null ? (
              <Field label="模型列表 JSON（支持多个模型）">
                <Textarea
                  className="min-h-52 font-mono text-xs"
                  value={draft.modelsJson}
                  onChange={(event) =>
                    props.onChange({ ...draft, modelsJson: event.target.value })
                  }
                />
              </Field>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={props.onCancel}
            disabled={save.isPending}
          >
            取消
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !props.canSave}
          >
            {save.isPending ? "保存中…" : "保存配置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
