import { RefreshIcon, RotateLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
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
import { Label } from "@web/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select"
import { Skeleton } from "@web/components/ui/skeleton"
import { Textarea } from "@web/components/ui/textarea"
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
  const selectedProvider = providers.find(
    (entry) => entry.id === form.providerId
  )
  const providerModels = selectedProvider?.provider.models ?? []
  const promptLength = form.systemPrompt.length

  const submit = (): void => {
    if (!loaded || !form.providerId || !form.modelId) return
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
                className="min-h-11 w-fit"
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
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => void models.refetch()}
                disabled={models.isFetching}
              >
                <HugeiconsIcon icon={RefreshIcon} aria-hidden="true" />
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
            ) : providers.length === 0 ? (
              <Alert role="status">
                <AlertTitle>Pi 还没有可用的 Provider</AlertTitle>
                <AlertDescription>
                  先在「模型」标签里配置 Provider 与模型，再回来选择助手模型。
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <Label className="grid gap-1 text-xs">
                Provider
                <Select
                  value={form.providerId}
                  onValueChange={(value) => {
                    const providerId = value ?? ""
                    // 换 Provider 后原模型可能不属于它：清空，避免保存出无效组合。
                    const nextModels =
                      providers.find((entry) => entry.id === providerId)
                        ?.provider.models ?? []
                    const keepsModel = nextModels.some(
                      (model) => model.id === form.modelId
                    )
                    update({
                      providerId,
                      modelId: keepsModel ? form.modelId : "",
                    })
                  }}
                >
                  <SelectTrigger
                    aria-label="助手 Provider"
                    className="min-h-11"
                  >
                    <SelectValue placeholder="选择 Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>

              <Label className="grid gap-1 text-xs">
                模型
                <Select
                  value={form.modelId}
                  onValueChange={(value) => update({ modelId: value ?? "" })}
                >
                  <SelectTrigger aria-label="助手模型" className="min-h-11">
                    <SelectValue
                      placeholder={
                        form.providerId ? "选择模型" : "先选择 Provider"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {providerModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name ?? model.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>

              <Label className="grid gap-1 text-xs md:col-span-2">
                Thinking 档位
                <Select
                  value={form.thinkingLevel}
                  onValueChange={(value) =>
                    update({ thinkingLevel: toThinkingOption(value ?? "") })
                  }
                >
                  <SelectTrigger
                    aria-label="助手 Thinking 档位"
                    className="min-h-11"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={THINKING_DEFAULT}>
                      跟随 Pi 默认
                    </SelectItem>
                    {AI_ASSISTANT_THINKING_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                variant="outline"
                className="min-h-11"
                onClick={() =>
                  update({
                    systemPrompt: loaded?.defaults.systemPrompt ?? "",
                  })
                }
              >
                <HugeiconsIcon icon={RotateLeft01Icon} aria-hidden="true" />
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
                className="min-h-11"
                onClick={submit}
                disabled={save.isPending || !form.providerId || !form.modelId}
              >
                {save.isPending ? "正在保存…" : "保存设置"}
              </Button>
              {!form.providerId || !form.modelId ? (
                <p className="text-xs text-muted-foreground">
                  选好 Provider 与模型后才能保存。
                </p>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
