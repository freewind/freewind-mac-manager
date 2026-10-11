import type { PiSettingsInput } from "@shared/api-contract"
import { fetchPiSettings, savePiSettings } from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select"
import { useState } from "react"
import { toast } from "sonner"
import { piKeys, usePiModels } from "./queries"

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const

type SettingsDraft = {
  defaultProvider: string
  defaultModel: string
  defaultThinkingLevel: string
  theme: string
  retryEnabled: boolean
  maxRetries: number
  baseDelayMs: number
  compactionEnabled: boolean
  reserveTokens: number
  keepRecentTokens: number
}

const resolveDraft = (
  settings: Awaited<ReturnType<typeof fetchPiSettings>>
): SettingsDraft => ({
  defaultProvider: settings.settings.defaultProvider ?? "",
  defaultModel: settings.settings.defaultModel ?? "",
  defaultThinkingLevel:
    settings.settings.defaultThinkingLevel ??
    settings.defaults.defaultThinkingLevel,
  theme: settings.settings.theme ?? settings.defaults.theme,
  retryEnabled:
    settings.settings.retry?.enabled ?? settings.defaults.retry.enabled,
  maxRetries:
    settings.settings.retry?.maxRetries ?? settings.defaults.retry.maxRetries,
  baseDelayMs:
    settings.settings.retry?.baseDelayMs ?? settings.defaults.retry.baseDelayMs,
  compactionEnabled:
    settings.settings.compaction?.enabled ??
    settings.defaults.compaction.enabled,
  reserveTokens:
    settings.settings.compaction?.reserveTokens ??
    settings.defaults.compaction.reserveTokens,
  keepRecentTokens:
    settings.settings.compaction?.keepRecentTokens ??
    settings.defaults.compaction.keepRecentTokens,
})

export const SettingsTab = () => {
  const client = useQueryClient()
  const models = usePiModels()
  const query = useQuery({
    queryKey: [...piKeys.all, "settings"],
    queryFn: fetchPiSettings,
    retry: false,
  })
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [resetAll, setResetAll] = useState(false)

  const save = useMutation({
    mutationFn: async () => {
      if (!query.data) throw new Error("请先读取设置")
      const current = draft ?? resolveDraft(query.data)
      const selectedProvider = models.data?.providers.find(
        (provider) => provider.id === current.defaultProvider
      )
      if (current.defaultProvider && !selectedProvider) {
        throw new Error("默认 Provider 不存在")
      }
      if (
        current.defaultModel &&
        selectedProvider &&
        !selectedProvider.provider.models.some(
          (model) => model.id === current.defaultModel
        )
      ) {
        throw new Error("所选模型不属于默认 Provider")
      }
      const clearFields: PiSettingsInput["clearFields"] = []
      const clearSubfields: PiSettingsInput["clearSubfields"] = []
      if (resetAll) {
        clearFields.push(
          "defaultProvider",
          "defaultModel",
          "defaultThinkingLevel",
          "theme",
          "retry",
          "compaction"
        )
        clearSubfields.push(
          "defaultThinkingLevel",
          "theme",
          "retry.enabled",
          "retry.maxRetries",
          "retry.baseDelayMs",
          "compaction.enabled",
          "compaction.reserveTokens",
          "compaction.keepRecentTokens"
        )
      } else {
        if (!current.defaultProvider) clearFields.push("defaultProvider")
        if (!current.defaultModel) clearFields.push("defaultModel")
      }
      return savePiSettings({
        signature: query.data.signature,
        modelsSignature: models.data?.signature ?? "",
        clearFields,
        clearSubfields,
        settings: {
          ...(current.defaultProvider
            ? { defaultProvider: current.defaultProvider }
            : {}),
          ...(current.defaultModel
            ? { defaultModel: current.defaultModel }
            : {}),
          ...(current.defaultThinkingLevel
            ? {
                defaultThinkingLevel:
                  current.defaultThinkingLevel as (typeof THINKING_LEVELS)[number],
              }
            : {}),
          ...(current.theme ? { theme: current.theme } : {}),
          retry: {
            enabled: current.retryEnabled,
            maxRetries: current.maxRetries,
            baseDelayMs: current.baseDelayMs,
          },
          compaction: {
            enabled: current.compactionEnabled,
            reserveTokens: current.reserveTokens,
            keepRecentTokens: current.keepRecentTokens,
          },
        },
      })
    },
    onSuccess: async (result) => {
      if (result.status !== 200) {
        toast.error("设置保存未完成，请刷新后核实")
        return
      }
      toast.success("Pi 设置已保存；运行中的会话需重载配置后生效")
      setDraft(null)
      setResetAll(false)
      await client.invalidateQueries({ queryKey: [...piKeys.all, "settings"] })
    },
    onError: (error) =>
      toast.error(error.message || "设置保存失败，请重新读取确认"),
  })

  if (query.isLoading || models.isLoading) {
    return (
      <p className="p-4 text-sm" role="status">
        正在读取 Pi 设置…
      </p>
    )
  }
  if (query.isError || models.isError || !query.data) {
    return (
      <Card className="m-4">
        <CardHeader>
          <CardTitle>无法读取 Pi 设置</CardTitle>
          <CardDescription>
            {query.error?.message ?? models.error?.message}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() =>
              void Promise.all([query.refetch(), models.refetch()])
            }
          >
            重新读取
          </Button>
        </CardContent>
      </Card>
    )
  }

  const currentDraft = draft ?? resolveDraft(query.data)
  const update = <K extends keyof SettingsDraft>(
    key: K,
    value: SettingsDraft[K]
  ) =>
    setDraft((current) => ({
      ...(current ?? resolveDraft(query.data)),
      [key]: value,
    }))
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>默认模型</CardTitle>
          <CardDescription>
            保存到全局 settings.json；已运行的 Pi 会话不会自动切换。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="默认 Provider（可填内置或自定义 Provider ID）">
            <Input
              list="pi-provider-options"
              value={currentDraft.defaultProvider}
              onChange={(event) =>
                update("defaultProvider", event.target.value)
              }
              placeholder="留空时由 Pi 自动选择"
            />
            <datalist id="pi-provider-options">
              {models.data?.providers.map((item) => (
                <option key={item.id} value={item.id} />
              ))}
            </datalist>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update("defaultProvider", "")}
            >
              清除覆盖
            </Button>
          </Field>
          <Field label="默认模型 ID（可填 Pi 内置或自定义模型）">
            <Input
              value={currentDraft.defaultModel}
              onChange={(event) => update("defaultModel", event.target.value)}
              placeholder="留空时由 Pi 自动选择"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update("defaultModel", "")}
            >
              清除覆盖
            </Button>
          </Field>
          <Field label="默认 Thinking 档位">
            <Select
              value={currentDraft.defaultThinkingLevel}
              onValueChange={(value) =>
                update("defaultThinkingLevel", value ?? "medium")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THINKING_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="主题">
            <Input
              value={currentDraft.theme}
              onChange={(event) => update("theme", event.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>重试与上下文压缩</CardTitle>
          <CardDescription>范围受限的官方 Pi 设置。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Toggle
            label="启用重试"
            checked={currentDraft.retryEnabled}
            onChange={(value) => update("retryEnabled", value)}
          />
          <NumberField
            label="最大重试次数"
            value={currentDraft.maxRetries}
            max={20}
            onChange={(value) => update("maxRetries", value)}
          />
          <NumberField
            label="基础重试延迟（毫秒）"
            value={currentDraft.baseDelayMs}
            max={300000}
            onChange={(value) => update("baseDelayMs", value)}
          />
          <Toggle
            label="启用自动压缩"
            checked={currentDraft.compactionEnabled}
            onChange={(value) => update("compactionEnabled", value)}
          />
          <NumberField
            label="压缩保留 Token"
            value={currentDraft.reserveTokens}
            max={1000000}
            onChange={(value) => update("reserveTokens", value)}
          />
          <NumberField
            label="保留近期 Token"
            value={currentDraft.keepRecentTokens}
            max={1000000}
            onChange={(value) => update("keepRecentTokens", value)}
          />
          <Button
            variant="outline"
            className="sm:col-span-2"
            onClick={() => {
              if (!query.data) return
              setResetAll(true)
              setDraft(resolveDraft({ ...query.data, settings: {} }))
            }}
          >
            恢复 Pi 默认设置
          </Button>
          <Button
            className="sm:col-span-2"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending ? "保存中…" : "保存设置"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

const Field = (props: { label: string; children: React.ReactNode }) => (
  <Label className="grid gap-1 text-xs">
    {props.label}
    {props.children}
  </Label>
)

const Toggle = (props: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) => (
  <label className="flex min-h-11 items-center gap-2 text-xs">
    <input
      type="checkbox"
      checked={props.checked}
      onChange={(event) => props.onChange(event.target.checked)}
    />
    {props.label}
  </label>
)

const NumberField = (props: {
  label: string
  value: number
  max: number
  onChange: (value: number) => void
}) => (
  <Field label={props.label}>
    <Input
      type="number"
      min={0}
      max={props.max}
      value={props.value}
      onChange={(event) =>
        props.onChange(
          Math.max(0, Math.min(props.max, Number(event.target.value) || 0))
        )
      }
    />
  </Field>
)
