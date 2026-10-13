import type { AiAssistantSettingsInput } from "@shared/api-contract"
import type { AiAssistantSettingsMutationSchema } from "@shared/api-contract/schemas/ai-assistant"
import { AI_ASSISTANT_THINKING_LEVELS } from "@shared/api-contract/schemas/ai-assistant"
import { saveAiAssistantSettings } from "@shared/client-api"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@web/components/ui/combobox"
import { Label } from "@web/components/ui/label"
import { Skeleton } from "@web/components/ui/skeleton"
import { Textarea } from "@web/components/ui/textarea"
import { RefreshCw, RotateCcw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { z } from "zod"
import {
  aiAssistantKeys,
  useAiAssistantSettings,
  usePiModelDirectory,
} from "./queries"

/** 跟随 Pi 默认：不写 thinkingLevel，交给 Pi 自己决定。 */
const THINKING_DEFAULT = "__default__"

const SYSTEM_PROMPT_MAX = 8000

const THINKING_OPTIONS = [
  THINKING_DEFAULT,
  ...AI_ASSISTANT_THINKING_LEVELS,
] as const
type ThinkingOption = (typeof THINKING_OPTIONS)[number]
/** 可以显式清除的字段：与契约的 clearFields 保持一致。 */
type ClearableField = z.infer<
  typeof AiAssistantSettingsMutationSchema
>["clearFields"][number]

const toThinkingOption = (value: string): ThinkingOption =>
  (THINKING_OPTIONS as readonly string[]).includes(value)
    ? (value as ThinkingOption)
    : THINKING_DEFAULT

type Draft = {
  providerId: string
  modelId: string
  thinkingLevel: ThinkingOption
  systemPrompt: string
}

type ModelOption = {
  providerId: string
  modelId: string
  label: string
}

const EMPTY_DRAFT: Draft = {
  providerId: "",
  modelId: "",
  thinkingLevel: THINKING_DEFAULT,
  systemPrompt: "",
}

const statusOf = (error: unknown): number | null =>
  typeof error === "object" && error !== null && "status" in error
    ? typeof (error as { status?: unknown }).status === "number"
      ? ((error as { status: number }).status as number)
      : null
    : null

/**
 * AI 助手设置卡片：选模型（来自 Pi 已配置的模型目录）、写系统提示词。
 *
 * 这些设置只存在应用自己的 SQLite 里，不写 Pi 全局 settings.json；
 * 保存只影响之后新建的会话，已在进行中的会话仍用旧配置。
 */
export const SettingsCard = () => {
  const queryClient = useQueryClient()
  const settings = useAiAssistantSettings(true)
  const models = usePiModelDirectory(true)
  // 草稿为空时由服务端数据派生；用户一旦开始编辑就固定下来，
  // 刷新设置不会把正在编辑的内容冲掉（保留输入草稿）。
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loaded = settings.data
  const fromServer: Draft | null = loaded
    ? {
        providerId: loaded.settings.providerId ?? "",
        modelId: loaded.settings.modelId ?? "",
        thinkingLevel: toThinkingOption(
          loaded.settings.thinkingLevel ?? THINKING_DEFAULT
        ),
        systemPrompt:
          loaded.settings.systemPrompt ?? loaded.defaults.systemPrompt,
      }
    : null
  const form = draft ?? fromServer ?? EMPTY_DRAFT
  const ready = loaded !== undefined && fromServer !== null
  const update = (patch: Partial<Draft>): void =>
    setDraft({ ...form, ...patch })

  const save = useMutation({
    mutationFn: (input: AiAssistantSettingsInput) =>
      saveAiAssistantSettings(input),
    retry: false,
    onSuccess: async (response) => {
      setSaveError(null)
      queryClient.setQueryData(aiAssistantKeys.settings(), response)
      toast.success("AI 助手设置已保存，对新建会话生效")
      await queryClient.invalidateQueries({
        queryKey: aiAssistantKeys.settings(),
      })
    },
    onError: (error) => {
      const status = statusOf(error)
      setSaveError(
        status === 409
          ? "配置已被其他程序修改（冲突）。请刷新设置核实后再保存。"
          : error instanceof Error && error.message
            ? error.message
            : "保存未完成，请刷新后核实"
      )
    },
  })

  const providers = models.data?.providers ?? []
  const modelOptions: ModelOption[] = providers.flatMap((entry) =>
    entry.provider.models.map((model) => ({
      providerId: entry.id,
      modelId: model.id,
      label: `${entry.id}/${model.name ?? model.id}`,
    }))
  )
  const selectedOption = modelOptions.find(
    (opt) => opt.providerId === form.providerId && opt.modelId === form.modelId
  )
  const promptLength = form.systemPrompt.length
  // 模型目录是唯一可信来源：读失败、还在读，或所选 Provider/模型不在目录里，
  // 都不能保存——否则会把已删掉的模型写进设置里。
  const directoryReady = models.data !== undefined && !models.isError
  const providerKnown = providers.some((entry) => entry.id === form.providerId)
  const modelKnown = modelOptions.some(
    (opt) => opt.providerId === form.providerId && opt.modelId === form.modelId
  )
  const selectionValid = directoryReady && providerKnown && modelKnown
  const selectionInvalid =
    directoryReady && providers.length > 0 && !selectionValid
  const selectionMessage = !providerKnown
    ? "所选 Provider 已不在模型目录里（可能已被删除），请重新选择。"
    : "所选模型已不在该 Provider 下（可能已被删除），请重新选择模型。"

  const rereadSettings = async (): Promise<void> => {
    const result = await settings.refetch()
    // 已重新读到最新配置：冲突提示的使命结束，后面用新 signature 保存。
    if (!result.isError) setSaveError(null)
  }

  const submit = (): void => {
    // 不只靠按钮禁用：刷新后目录变化或签名过期时，这里也不提交。
    if (!loaded || !selectionValid) return
    const prompt = form.systemPrompt
    const cleared: ClearableField[] = []
    if (!prompt.trim()) cleared.push("systemPrompt")
    if (form.thinkingLevel === THINKING_DEFAULT) cleared.push("thinkingLevel")
    save.mutate({
      signature: loaded.signature,
      settings: {
        providerId: form.providerId,
        modelId: form.modelId,
        ...(form.thinkingLevel === THINKING_DEFAULT
          ? {}
          : { thinkingLevel: form.thinkingLevel }),
        ...(prompt.trim() ? { systemPrompt: prompt } : {}),
      },
      clearFields: cleared,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 助手</CardTitle>
        <CardDescription>
          助手用所选模型对话；设置只保存在应用数据库，不会写入 Pi 的
          settings.json。保存后只影响新建会话，进行中的会话仍用旧配置。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {settings.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>读取助手设置失败</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>无法确认当前设置，请重新读取后再修改。</span>
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => void settings.refetch()}
                disabled={settings.isFetching}
              >
                重新读取
              </Button>
            </AlertDescription>
          </Alert>
        ) : settings.isPending || !ready ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : (
          <form
            aria-label="AI 助手设置"
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void models.refetch()}
                disabled={models.isFetching}
              >
                <RefreshCw aria-hidden="true" />
                {models.isFetching ? "正在读取…" : "刷新模型列表"}
              </Button>
              <p className="text-xs text-muted-foreground">
                读取 Pi 已配置的模型目录，不做网络自动发现。
                {models.data ? `（${providers.length} 个 Provider）` : ""}
              </p>
            </div>

            {models.isError ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>读取模型目录失败</AlertTitle>
                <AlertDescription>
                  无法读取 Pi 配置的模型，请确认 Pi 的 models.json 可用后重试。
                </AlertDescription>
              </Alert>
            ) : models.isPending ? (
              <Alert role="status">
                <AlertTitle>正在读取模型目录…</AlertTitle>
                <AlertDescription>
                  读取完成前无法确认所选 Provider 与模型是否仍然存在。
                </AlertDescription>
              </Alert>
            ) : providers.length === 0 ? (
              <Alert role="status">
                <AlertTitle>Pi 还没有可用的 Provider</AlertTitle>
                <AlertDescription>
                  先在「模型」标签里配置 Provider 与模型，再回来选择助手模型。
                </AlertDescription>
              </Alert>
            ) : null}

            {selectionInvalid ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>当前选择已失效</AlertTitle>
                <AlertDescription>{selectionMessage}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <Label className="grid gap-1 text-xs">
                模型
                <Combobox
                  value={selectedOption ?? null}
                  onValueChange={(opt) => {
                    if (opt) {
                      update({
                        providerId: opt.providerId,
                        modelId: opt.modelId,
                      })
                    }
                  }}
                  items={modelOptions}
                  itemToStringLabel={(opt) => opt?.label ?? ""}
                  isItemEqualToValue={(a, b) =>
                    a.providerId === b.providerId && a.modelId === b.modelId
                  }
                >
                  <ComboboxInput
                    aria-label="助手模型"
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

              <Label className="grid gap-1 text-xs md:col-span-2">
                Thinking 档位
                <Combobox
                  items={
                    [
                      THINKING_DEFAULT,
                      ...AI_ASSISTANT_THINKING_LEVELS,
                    ] as string[]
                  }
                  value={form.thinkingLevel}
                  onValueChange={(value) =>
                    update({ thinkingLevel: toThinkingOption(value ?? "") })
                  }
                >
                  <ComboboxInput aria-label="助手 Thinking 档位" />
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
            </div>

            <Label className="grid gap-1 text-xs">
              系统提示词
              <Textarea
                aria-label="助手系统提示词"
                className="min-h-40"
                maxLength={SYSTEM_PROMPT_MAX}
                value={form.systemPrompt}
                onChange={(event) =>
                  update({ systemPrompt: event.target.value })
                }
              />
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  update({
                    systemPrompt: loaded?.defaults.systemPrompt ?? "",
                  })
                }
              >
                <RotateCcw aria-hidden="true" />
                恢复默认提示词
              </Button>
              <p className="text-xs text-muted-foreground">
                {promptLength} / {SYSTEM_PROMPT_MAX} 字符；留空则使用默认提示词
              </p>
            </div>

            {saveError ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>保存未完成</AlertTitle>
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={save.isPending || !selectionValid}
              >
                {save.isPending ? "正在保存…" : "保存设置"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void rereadSettings()}
                disabled={settings.isFetching}
              >
                <RefreshCw aria-hidden="true" />
                {settings.isFetching ? "正在读取…" : "重新读取设置"}
              </Button>
              {!selectionValid ? (
                <p className="text-xs text-muted-foreground">
                  {directoryReady
                    ? "所选 Provider 或模型已失效，请重新选择后再保存。"
                    : "模型目录尚未读取成功，暂时不能保存。"}
                </p>
              ) : null}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
