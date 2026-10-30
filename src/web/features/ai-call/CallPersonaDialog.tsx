import type { AiCallPersona } from "@shared/api-contract"
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
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@web/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import { Skeleton } from "@web/components/ui/skeleton"
import { Textarea } from "@web/components/ui/textarea"
import { usePiModelDirectory } from "@web/features/ai-assistant/queries"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  useAiCallPersonasQuery,
  useCreateAiCallPersona,
  useDeleteAiCallPersona,
  useUpdateAiCallPersona,
} from "./queries"

type ModelOption = { providerId: string; modelId: string; label: string }

type Draft = {
  id: string | null
  name: string
  systemPrompt: string
  providerId: string
  modelId: string
}

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  systemPrompt: "",
  providerId: "",
  modelId: "",
})

const draftOf = (persona: AiCallPersona): Draft => ({
  id: persona.id,
  name: persona.name,
  systemPrompt: persona.systemPrompt,
  providerId: persona.providerId ?? "",
  modelId: persona.modelId ?? "",
})

/**
 * 通话角色管理：每个角色一套提示词与自己的模型。
 *
 * 与 AI 助手的设置完全分开，也不内置默认角色：没有角色就不能开始通话，
 * 免得又退回成「和助手同一个身份」。角色在开始通话时选定，一次通话不换人。
 */
export const CallPersonaDialog = (props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  useHistoryOverlay(props.open, () => props.onOpenChange(false))
  const personas = useAiCallPersonasQuery()
  const models = usePiModelDirectory(props.open)
  const create = useCreateAiCallPersona()
  const update = useUpdateAiCallPersona()
  const remove = useDeleteAiCallPersona()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AiCallPersona | null>(null)

  const providers = models.data?.providers ?? []
  const options: ModelOption[] = providers.flatMap((entry) =>
    entry.provider.models.map((model) => ({
      providerId: entry.id,
      modelId: model.id,
      label: `${entry.id}/${model.name ?? model.id}`,
    }))
  )
  const selected = draft
    ? options.find(
        (option) =>
          option.providerId === draft.providerId &&
          option.modelId === draft.modelId
      )
    : undefined

  const form = draft
  const canSave =
    form !== null &&
    form.name.trim() !== "" &&
    form.providerId !== "" &&
    form.modelId !== ""

  const submit = (): void => {
    if (!form || !canSave) return
    const values = {
      name: form.name.trim(),
      systemPrompt: form.systemPrompt,
      providerId: form.providerId,
      modelId: form.modelId,
    }
    const done = {
      onSuccess: () => {
        toast.success(form.id ? "角色已更新" : "角色已创建")
        setDraft(null)
      },
      onError: (error: unknown) => {
        toast.error(error instanceof Error ? error.message : "保存失败")
      },
    }
    if (form.id) update.mutate({ personaId: form.id, values }, done)
    else create.mutate(values, done)
  }

  const list = personas.data?.personas ?? []

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>通话角色</DialogTitle>
            <DialogDescription>
              每个角色有自己的提示词与模型。开始通话时选一个。
            </DialogDescription>
          </DialogHeader>

          {personas.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  还没有角色。新建一个才能开始通话。
                </p>
              ) : (
                list.map((persona) => (
                  <div
                    key={persona.id}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 flex-col text-left"
                      onClick={() => setDraft(draftOf(persona))}
                    >
                      <span className="truncate text-sm font-medium">
                        {persona.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {persona.modelId ?? "未设置模型"}
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`删除 ${persona.name}`}
                      onClick={() => setPendingDelete(persona)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}

          {form ? (
            <div className="flex flex-col gap-3 border-t pt-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="persona-name">名称</Label>
                <Input
                  id="persona-name"
                  value={form.name}
                  onChange={(event) =>
                    setDraft({ ...form, name: event.target.value })
                  }
                  placeholder="比如：闲聊、英语练习、代码顾问"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>模型</Label>
                <Combobox
                  value={selected?.label ?? ""}
                  onValueChange={(label) => {
                    const option = options.find((item) => item.label === label)
                    if (!option) return
                    setDraft({
                      ...form,
                      providerId: option.providerId,
                      modelId: option.modelId,
                    })
                  }}
                >
                  <ComboboxInput placeholder="选择模型" />
                  <ComboboxContent>
                    <ComboboxList>
                      {options.map((option) => (
                        <ComboboxItem key={option.label} value={option.label}>
                          {option.label}
                        </ComboboxItem>
                      ))}
                    </ComboboxList>
                    <ComboboxEmpty>没有可用模型</ComboboxEmpty>
                  </ComboboxContent>
                </Combobox>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="persona-prompt">提示词</Label>
                <Textarea
                  id="persona-prompt"
                  value={form.systemPrompt}
                  onChange={(event) =>
                    setDraft({ ...form, systemPrompt: event.target.value })
                  }
                  placeholder="这个角色是谁、用什么语气、擅长聊什么"
                  className="min-h-28 text-xs"
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            {form ? (
              <Button
                variant="ghost"
                onClick={() => setDraft(null)}
                className="mr-auto"
              >
                取消编辑
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setDraft(emptyDraft())}>
              <Plus aria-hidden />
              新角色
            </Button>
            <Button onClick={submit} disabled={!canSave || create.isPending}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除角色「{pendingDelete?.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              用这个角色的历史通话仍能回看，但不能继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingDelete
                setPendingDelete(null)
                if (!target) return
                remove.mutate(target.id, {
                  onSuccess: () => toast.success("角色已删除"),
                  onError: (error) =>
                    toast.error(
                      error instanceof Error ? error.message : "删除失败"
                    ),
                })
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
