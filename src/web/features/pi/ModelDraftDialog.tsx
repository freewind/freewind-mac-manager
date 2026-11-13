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
import type { ModelDraft } from "./provider-drafts"

export type ModelDraftDialogProps = {
  /** null 表示弹窗关闭。 */
  modelDraft: ModelDraft | null
  addModel: { isPending: boolean; mutate: (draft: ModelDraft) => void }
  onChange: (draft: ModelDraft) => void
  /** 用户试图关闭弹层且不在保存中时调用。 */
  onDismiss: () => void
  /** 点击「取消」按钮。 */
  onCancel: () => void
}

/** 新增/编辑模型的弹窗：粘贴 JSON 时以 JSON 为准，否则按字段拼。 */
export const ModelDraftDialog = (props: ModelDraftDialogProps) => {
  const { modelDraft, addModel } = props
  return (
    <Dialog
      open={modelDraft !== null}
      onOpenChange={(open) => {
        if (!open && !addModel.isPending) props.onDismiss()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {modelDraft?.editingModelId ? "模型详情" : "添加模型"}
          </DialogTitle>
          <DialogDescription>
            {modelDraft?.editingModelId
              ? `修改「${modelDraft.editingModelId}」的字段，保存后写回 models.json。`
              : `模型会追加到「${modelDraft?.providerId}」的 models 列表；id 必须唯一。`}
          </DialogDescription>
        </DialogHeader>
        {modelDraft ? (
          <div className="grid gap-3">
            <Field label="模型 JSON（粘贴后以它为准）">
              <Textarea
                className="min-h-32 font-mono text-xs"
                value={modelDraft.json}
                onChange={(event) =>
                  props.onChange({ ...modelDraft, json: event.target.value })
                }
              />
            </Field>
            <Field label="模型 id（必填）">
              <Input
                value={modelDraft.id}
                onChange={(event) =>
                  props.onChange({ ...modelDraft, id: event.target.value })
                }
              />
            </Field>
            <Field label="显示名称（可选）">
              <Input
                value={modelDraft.name}
                onChange={(event) =>
                  props.onChange({ ...modelDraft, name: event.target.value })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={modelDraft.reasoning}
                onChange={(event) =>
                  props.onChange({
                    ...modelDraft,
                    reasoning: event.target.checked,
                  })
                }
              />
              推理模型（reasoning）
            </label>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-muted-foreground">输入类型</span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={modelDraft.inputText}
                  onChange={(event) =>
                    props.onChange({
                      ...modelDraft,
                      inputText: event.target.checked,
                    })
                  }
                />
                文本
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={modelDraft.inputImage}
                  onChange={(event) =>
                    props.onChange({
                      ...modelDraft,
                      inputImage: event.target.checked,
                    })
                  }
                />
                图片
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="context window（可选）">
                <Input
                  inputMode="numeric"
                  value={modelDraft.contextWindow}
                  onChange={(event) =>
                    props.onChange({
                      ...modelDraft,
                      contextWindow: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="最大输出（可选）">
                <Input
                  inputMode="numeric"
                  value={modelDraft.maxTokens}
                  onChange={(event) =>
                    props.onChange({
                      ...modelDraft,
                      maxTokens: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
            <Field label="thinking 档位映射（JSON，可选）">
              <Textarea
                className="min-h-20 font-mono text-xs"
                placeholder='{"off": null, "high": "high"}'
                value={modelDraft.thinkingLevelMapJson}
                onChange={(event) =>
                  props.onChange({
                    ...modelDraft,
                    thinkingLevelMapJson: event.target.value,
                  })
                }
              />
            </Field>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={props.onCancel}
            disabled={addModel.isPending}
          >
            取消
          </Button>
          <Button
            onClick={() => modelDraft && addModel.mutate(modelDraft)}
            disabled={
              addModel.isPending ||
              ((modelDraft?.json.trim() ?? "") === "" &&
                (modelDraft?.id.trim() ?? "") === "")
            }
          >
            {addModel.isPending
              ? "保存中…"
              : modelDraft?.editingModelId
                ? "保存"
                : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
