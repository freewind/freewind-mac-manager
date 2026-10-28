import { AI_ASSISTANT_THINKING_LEVELS } from "@shared/api-contract/schemas/ai-assistant"
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
import { Label } from "@web/components/ui/label"
import { Skeleton } from "@web/components/ui/skeleton"
import { Textarea } from "@web/components/ui/textarea"
import { usePiModelDirectory } from "@web/features/ai-assistant/queries"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { RotateCcw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useAiTopicSettings, useSaveAiTopicSettings } from "./queries"

/** 跟随 Pi 默认：不写 thinkingLevel，交给 Pi 自己决定。 */
const THINKING_DEFAULT = "__default__"
const SYSTEM_PROMPT_MAX = 8000

type ThinkingOption =
  | typeof THINKING_DEFAULT
  | (typeof AI_ASSISTANT_THINKING_LEVELS)[number]

type Draft = {
  providerId: string
  modelId: string
  thinkingLevel: ThinkingOption
  /** null 表示跟随默认提示词（不写 systemPrompt）。 */
  systemPrompt: string | null
}

type ModelOption = {
  providerId: string
  modelId: string
  label: string
}

const toThinkingOption = (value: string | undefined): ThinkingOption =>
  value && (AI_ASSISTANT_THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as (typeof AI_ASSISTANT_THINKING_LEVELS)[number])
    : THINKING_DEFAULT

const statusOf = (error: unknown): number | null =>
  typeof error === "object" && error !== null && "status" in error
    ? typeof (error as { status?: unknown }).status === "number"
      ? ((error as { status: number }).status as number)
      : null
    : null

type TopicSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 话题设置：模型与系统提示词都只属于话题，与 AI 助手互不影响。
 *
 * 保存后只影响之后新建的话题会话；已在内存里的会话仍用旧配置，直到被
 * 回收或服务重启。这一点与助手设置保持一致，避免进行中的对话被换模型。
 */
export const TopicSettingsDialog = (props: TopicSettingsDialogProps) => {
  useHistoryOverlay(props.open, () => props.onOpenChange(false))
  const settings = useAiTopicSettings(props.open)
  const models = usePiModelDirectory(props.open)
  const save = useSaveAiTopicSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loaded = settings.data
  const fromServer: Draft | null = loaded
    ? {
        providerId: loaded.settings.providerId ?? "",
        modelId: loaded.settings.modelId ?? "",
        thinkingLevel: toThinkingOption(loaded.settings.thinkingLevel),
        systemPrompt: loaded.settings.systemPrompt ?? null,
      }
    : null
  const form = draft ?? fromServer
  const providers = models.data?.providers ?? []
  const modelOptions: ModelOption[] = providers.flatMap((entry) =>
    entry.provider.models.map((model) => ({
      providerId: entry.id,
      modelId: model.id,
      label: `${entry.id}/${model.name ?? model.id}`,
    }))
  )
  const selectedOption = form
    ? modelOptions.find(
        (opt) =>
          opt.providerId === form.providerId && opt.modelId === form.modelId
      )
    : undefined
  const directoryReady = models.data !== undefined && !models.isError
  const selectionValid = Boolean(
    directoryReady &&
      form &&
      providers.some((entry) => entry.id === form.providerId) &&
      modelOptions.some(
        (opt) =>
          opt.providerId === form.providerId && opt.modelId === form.modelId
      )
  )

  const update = (patch: Partial<Draft>): void => {
    if (!form) return
    setDraft({ ...form, ...patch })
  }

  const submit = (): void => {
    if (!loaded || !form || !selectionValid) return
    const prompt = form.systemPrompt?.trim() ?? ""
    // 提示词留空 = 回到默认规则；不把空串写进设置，否则会话拿到空提示词。
    save.mutate(
      {
        signature: loaded.signature,
        settings: {
          providerId: form.providerId,
          modelId: form.modelId,
          ...(form.thinkingLevel === THINKING_DEFAULT
            ? {}
            : { thinkingLevel: form.thinkingLevel }),
          ...(prompt ? { systemPrompt: prompt } : {}),
        },
        clearFields: [
          ...(prompt ? [] : (["systemPrompt"] as const)),
          ...(form.thinkingLevel === THINKING_DEFAULT
            ? (["thinkingLevel"] as const)
            : []),
        ],
      },
      {
        onSuccess: () => {
          setSaveError(null)
          setDraft(null)
          toast.success("话题设置已保存，对新建的话题会话生效")
          props.onOpenChange(false)
        },
        onError: (error) => {
          const status = statusOf(error)
          setSaveError(
            status === 409
              ? "设置已被其他程序修改（冲突）。请重新打开本窗口后再保存。"
              : error instanceof Error && error.message
                ? error.message
                : "保存未完成，请重新打开本窗口核实"
          )
        },
      }
    )
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>话题设置</DialogTitle>
          <DialogDescription>
            话题用自己的模型与提示词，不会读取或修改 AI 助手的设置。
          </DialogDescription>
        </DialogHeader>

        {settings.isError ? (
          <p className="text-sm text-destructive">
            读取话题设置失败，请关闭后重新打开核实。
          </p>
        ) : settings.isPending || !form ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : (
          <form
            aria-label="话题设置"
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            {models.isError ? (
              <p className="text-sm text-destructive">
                读取模型目录失败，无法确认所选模型是否可用。
              </p>
            ) : models.isPending ? (
              <p className="text-sm text-muted-foreground">正在读取模型目录…</p>
            ) : providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                还没有可用的 Provider，先在「Pi Agent」页配置模型。
              </p>
            ) : null}

            <Label className="grid gap-1 text-xs">
              模型
              <Combobox
                value={selectedOption ?? null}
                onValueChange={(opt) => {
                  if (opt) {
                    update({ providerId: opt.providerId, modelId: opt.modelId })
                  }
                }}
                items={modelOptions}
                itemToStringLabel={(opt) => opt?.label ?? ""}
                isItemEqualToValue={(a, b) =>
                  a.providerId === b.providerId && a.modelId === b.modelId
                }
              >
                <ComboboxInput
                  aria-label="话题模型"
                  placeholder="搜索 Provider 或模型…"
                />
                <ComboboxContent>
                  <ComboboxList>
                    {modelOptions.map((opt) => (
                      <ComboboxItem
                        key={`${opt.providerId}/${opt.modelId}`}
                        value={opt}
                      >
                        {opt.label}
                      </ComboboxItem>
                    ))}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </Label>

            <Label className="grid gap-1 text-xs">
              Thinking 档位
              <Combobox
                items={[THINKING_DEFAULT, ...AI_ASSISTANT_THINKING_LEVELS]}
                value={form.thinkingLevel}
                onValueChange={(value) =>
                  update({ thinkingLevel: toThinkingOption(value ?? "") })
                }
              >
                <ComboboxInput aria-label="话题 Thinking 档位" />
                <ComboboxContent>
                  <ComboboxEmpty>无匹配项</ComboboxEmpty>
                  <ComboboxList>
                    {(item) => (
                      <ComboboxItem key={item} value={item}>
                        {item === THINKING_DEFAULT ? "跟随 Pi 默认" : item}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </Label>

            <Label className="grid gap-1 text-xs">
              系统提示词
              <Textarea
                aria-label="话题系统提示词"
                className="min-h-40"
                maxLength={SYSTEM_PROMPT_MAX}
                value={form.systemPrompt ?? loaded?.defaults.systemPrompt ?? ""}
                onChange={(event) =>
                  // 与默认值一致时回到「未自定义」，避免把默认文本也存一份。
                  update({
                    systemPrompt:
                      event.target.value === loaded?.defaults.systemPrompt
                        ? null
                        : event.target.value,
                  })
                }
              />
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => update({ systemPrompt: null })}
              >
                <RotateCcw aria-hidden="true" />
                恢复默认提示词
              </Button>
              <p className="text-xs text-muted-foreground">
                {form.systemPrompt === null
                  ? "使用默认提示词"
                  : `${form.systemPrompt.length} / ${SYSTEM_PROMPT_MAX} 字符`}
              </p>
            </div>

            {saveError ? (
              <p className="text-sm text-destructive">{saveError}</p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onOpenChange(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={save.isPending || !selectionValid}
              >
                {save.isPending ? "正在保存…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
