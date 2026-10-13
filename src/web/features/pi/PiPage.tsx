import type { PiBenchmarkResult } from "@shared/api-contract"
import {
  ApiRequestError,
  addPiProvider,
  deletePiBenchmarks,
  deletePiProvider,
  newRequestId,
  startPiBenchmark,
  updatePiProvider,
} from "@shared/client-api"
import { formatToSeconds } from "@shared/format"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@web/components/PageHeader"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import { Textarea } from "@web/components/ui/textarea"
import { SettingsCard } from "@web/features/ai-assistant/SettingsCard"
import {
  forgetPendingRequest,
  rememberPendingRequest,
} from "@web/features/tasks/pending-requests"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import {
  Bot,
  Ellipsis,
  Gauge,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { GroupsTab } from "./GroupsTab"
import { LabTab } from "./LabTab"
import {
  benchmarkRunningExpired,
  piKeys,
  usePiBenchmarks,
  usePiModels,
} from "./queries"
import { SettingsTab } from "./SettingsTab"
import { PI_TABS, type PiTab, usePiTab } from "./use-pi-tab"

/** 分区在界面上的名字；顺序与 PI_TABS 一致。 */
const PI_TAB_LABELS: Record<PiTab, string> = {
  models: "模型",
  groups: "分组",
  settings: "设置",
  probe: "能力探测",
  chat: "Playground",
  assistant: "AI助手",
}

type ProviderEntry = ReturnType<typeof usePiModels>["data"] extends infer T
  ? T extends { providers: (infer P)[] }
    ? P
    : never
  : never

type ProviderDraft = {
  providerId: string
  name: string
  baseUrl: string
  api: string
  apiKey: string
  clearApiKey: boolean
  modelsJson: string
}

const emptyDraft = (): ProviderDraft => ({
  providerId: "",
  name: "",
  baseUrl: "",
  api: "openai-completions",
  apiKey: "",
  clearApiKey: false,
  modelsJson: JSON.stringify(
    [
      {
        id: "",
        name: "",
        reasoning: false,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
    null,
    2
  ),
})

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/**
 * 模型行上的测速状态：提交中、测速中、首字耗时或失败原因。
 * 超过服务端上限仍停在 running 的记录不再算「测速中」，也不再阻止重测。
 */
const benchmarkStatusText = (
  record: PiBenchmarkResult | undefined,
  pending: boolean,
  now: number
): { text: string; failed: boolean } | null => {
  if (pending) return { text: "提交中…", failed: false }
  if (record === undefined) return null
  if (record.status === "running") {
    return benchmarkRunningExpired(record, now)
      ? { text: "结果未知", failed: true }
      : { text: "测速中…", failed: false }
  }
  if (record.status === "done") {
    const firstByteMs =
      record.metrics.firstTextMs ?? record.metrics.firstEventMs
    return { text: `首字 ${formatToSeconds(firstByteMs)}`, failed: false }
  }
  return { text: record.message, failed: true }
}

export const PiPage = () => {
  const queryClient = useQueryClient()
  const query = usePiModels()
  const isDesktop = useIsDesktop()
  const { tab: activeTab, selectTab } = usePiTab()
  const setActiveTab = selectTab
  const [labSelection, setLabSelection] = useState<{
    provider: string
    model: string
  } | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProviderEntry | null>(null)
  /** 已发出但还没拿到回执的测速目标，键为 `provider/model`。 */
  const [pendingTargets, setPendingTargets] = useState<string[]>([])
  const history = usePiBenchmarks(activeTab === "models")
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: piKeys.all })
  const save = useMutation({
    mutationFn: async () => {
      if (!draft || !query.data) throw new Error("请先加载配置")
      let models: unknown
      try {
        models = JSON.parse(draft.modelsJson)
      } catch {
        throw new Error("模型列表不是有效 JSON")
      }
      if (!Array.isArray(models)) throw new Error("模型列表必须是 JSON 数组")
      const provider = {
        ...asRecord(
          editingId
            ? query.data.providers.find((item) => item.id === editingId)
                ?.provider
            : undefined
        ),
        name: draft.name,
        baseUrl: draft.baseUrl,
        api: draft.api,
        models,
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      }
      const payload = {
        providerId: draft.providerId,
        signature: query.data.signature,
        clearApiKey: draft.clearApiKey,
        provider,
      }
      return editingId
        ? updatePiProvider(editingId, payload)
        : addPiProvider(payload)
    },
    onSuccess: async (result) => {
      if (result.status < 200 || result.status >= 300) {
        toast.error("保存未完成，请检查配置并刷新后重试")
        return
      }
      toast.success("provider 配置已保存")
      setDraft(null)
      setEditingId(null)
      await invalidate()
    },
    onError: (error) =>
      toast.error(error.message || "保存失败，请重新读取确认"),
  })
  /** 提交一个目标的首字测速：先登记待核实请求，再发送。 */
  const submitBenchmark = async (target: {
    providerId: string
    modelId: string
  }): Promise<void> => {
    const { providerId, modelId } = target
    const requestId = newRequestId()
    const label = `Pi ${providerId}/${modelId}`
    rememberPendingRequest({
      requestId,
      kind: "pi_benchmark",
      target: label,
      startedAt: Date.now(),
      taskId: null,
    })
    try {
      const result = await startPiBenchmark(
        { providerId, modelId, thinkingLevel: "medium" },
        requestId
      )
      if (result.kind === "completed") {
        forgetPendingRequest({ requestId })
        if (result.body.status !== "done") toast.error(result.body.message)
        return
      }
      // 已受理：终态由测速历史轮询补齐，待核实记录保留到确认完成。
      rememberPendingRequest({
        requestId,
        kind: "pi_benchmark",
        target: label,
        startedAt: result.body.startedAt * 1000,
        taskId: result.body.taskId,
      })
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.resultUnknown &&
        error.requestId
      ) {
        toast.error("测速响应未知，正在通过请求标识核实任务")
        return
      }
      toast.error(error instanceof Error ? error.message : "测速未完成")
    }
  }

  /** 并发提交多个目标，避免逐个等回执拖长整体时间。 */
  const runBenchmarks = async (
    targets: { providerId: string; modelId: string }[]
  ): Promise<void> => {
    if (targets.length === 0) return
    const keys = targets.map(
      (target) => `${target.providerId}/${target.modelId}`
    )
    setPendingTargets((current) => [...new Set([...current, ...keys])])
    await Promise.all(targets.map((target) => submitBenchmark(target)))
    await queryClient.invalidateQueries({ queryKey: piKeys.benchmarks() })
    setPendingTargets((current) => current.filter((key) => !keys.includes(key)))
  }
  const removeHistory = useMutation({
    mutationFn: deletePiBenchmarks,
    onSuccess: async (response) => {
      if (response.status !== 204) toast.error("历史删除未完成")
      await queryClient.invalidateQueries({ queryKey: piKeys.benchmarks() })
    },
  })
  const remove = useMutation({
    mutationFn: async (entry: ProviderEntry) =>
      deletePiProvider({
        providerId: entry.id,
        signature: query.data?.signature ?? "",
      }),
    onSuccess: async (result) => {
      if (result.status !== 204) {
        toast.error("删除未完成，请刷新配置核实")
        return
      }
      toast.success("provider 已删除")
      setDeleteTarget(null)
      await invalidate()
    },
    onError: (error) =>
      toast.error(error.message || "删除失败，请刷新配置核实"),
  })

  const startEdit = (entry?: ProviderEntry) => {
    if (!entry) {
      setEditingId(null)
      setDraft(emptyDraft())
      return
    }
    setEditingId(entry.id)
    setDraft({
      providerId: entry.id,
      name: entry.provider.name ?? entry.id,
      baseUrl: entry.provider.baseUrl,
      api: entry.provider.api,
      apiKey: "",
      clearApiKey: false,
      modelsJson: JSON.stringify(entry.provider.models, null, 2),
    })
  }

  /** 全部 Provider 下的全部模型，作为「全部测速」的目标集合。 */
  const allBenchmarkTargets = (query.data?.providers ?? []).flatMap((entry) =>
    entry.provider.models.map((model) => ({
      providerId: entry.id,
      modelId: model.id,
    }))
  )
  const benchmarkRecords = history.data?.benchmarks ?? []
  const now = Date.now()
  /** 每个目标最近一次测速记录；历史按开始时间倒序返回，第一条即最新。 */
  const latestBenchmark = new Map<string, PiBenchmarkResult>()
  for (const record of benchmarkRecords) {
    const key = `${record.providerId}/${record.modelId}`
    if (!latestBenchmark.has(key)) latestBenchmark.set(key, record)
  }
  /** 提交中或运行中的目标：这些目标的按钮不再允许重复提交。 */
  const busyBenchmarkKeys = new Set([
    ...pendingTargets,
    ...benchmarkRecords
      .filter(
        (record) =>
          record.status === "running" && !benchmarkRunningExpired(record, now)
      )
      .map((record) => `${record.providerId}/${record.modelId}`),
  ])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Bot className="size-4" />
        <PageHeader title="Pi 模型管理" loading={query.isLoading} />
        <span className="text-xs text-muted-foreground">
          密钥仅写入、不回显；模型参数由 Pi 上游格式校验
        </span>
        {isDesktop ? (
          <div className="ml-auto flex flex-wrap gap-1 rounded-md bg-muted p-1">
            {PI_TABS.map((tab) => (
              <Button
                key={tab}
                size="sm"
                variant={activeTab === tab ? "default" : "ghost"}
                onClick={() => setActiveTab(tab)}
              >
                {PI_TAB_LABELS[tab]}
              </Button>
            ))}
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`当前分区：${PI_TAB_LABELS[activeTab]}`}
                >
                  {PI_TAB_LABELS[activeTab]}
                </Button>
              }
            />
            <DropdownMenuContent align="start">
              {PI_TABS.map((tab) => (
                <DropdownMenuItem key={tab} onClick={() => setActiveTab(tab)}>
                  {PI_TAB_LABELS[tab]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {activeTab === "models" ? (
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw />
              刷新
            </Button>
            <Button size="sm" onClick={() => startEdit()}>
              <Plus />
              添加 Provider
            </Button>
          </div>
        ) : null}
      </header>
      {activeTab === "groups" ? (
        <GroupsTab />
      ) : activeTab === "assistant" ? (
        <SettingsCard />
      ) : activeTab === "settings" ? (
        <SettingsTab />
      ) : activeTab === "probe" || activeTab === "chat" ? (
        <LabTab
          key={`${activeTab}-${labSelection?.provider}-${labSelection?.model}`}
          mode={activeTab}
          initialProvider={labSelection?.provider}
          initialModel={labSelection?.model}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {query.isLoading ? <p role="status">正在读取 Pi 配置…</p> : null}
          {query.isError ? (
            <Card>
              <CardHeader>
                <CardTitle>无法读取 Pi 配置</CardTitle>
                <CardDescription>{query.error.message}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => void query.refetch()}>重试读取</Button>
              </CardContent>
            </Card>
          ) : null}
          {query.data?.providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚无 Provider。</p>
          ) : null}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Provider 列表</h2>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => void runBenchmarks(allBenchmarkTargets)}
              disabled={
                allBenchmarkTargets.length === 0 || busyBenchmarkKeys.size > 0
              }
            >
              <Gauge />
              {busyBenchmarkKeys.size > 0 ? "测速中…" : "全部测速"}
            </Button>
          </div>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>测速历史（最多 100 条）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {history.isLoading ? (
                <p role="status">正在读取测速历史…</p>
              ) : null}
              {history.isError ? (
                <p role="alert">测速历史读取失败：{history.error.message}</p>
              ) : null}
              {history.data?.benchmarks.length === 0 ? (
                <p>暂无测速记录。</p>
              ) : null}
              {history.data?.benchmarks.map((item) => (
                <div key={item.id} className="rounded border p-3 text-sm">
                  <p>
                    {item.providerId}/{item.modelId} · {item.status} · 配置上限{" "}
                    {item.configuredMaxTokens} tokens
                  </p>
                  <p>
                    首事件 {formatToSeconds(item.metrics.firstEventMs)} · 首正文{" "}
                    {formatToSeconds(item.metrics.firstTextMs)} · 总时长{" "}
                    {formatToSeconds(item.metrics.durationMs)}
                  </p>
                  <p>
                    输入 {item.metrics.inputTokens ?? "—"} · 输出{" "}
                    {item.metrics.outputTokens ?? "—"} · 文本输出{" "}
                    {item.metrics.textOutputTokens ?? "—"} · 缓存读{" "}
                    {item.metrics.cacheReadTokens ?? "—"} · 缓存写{" "}
                    {item.metrics.cacheWriteTokens ?? "—"}
                  </p>
                  <p>
                    正文 tokens/s：
                    {item.metrics.outputTokensPerSecond ?? "—"} · 停止原因：
                    {item.stopReason ?? "—"} · {item.error ?? "无错误"}
                  </p>
                  <p>
                    {new Date(item.startedAt).toLocaleString()} · {item.message}
                  </p>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => removeHistory.mutate([item.id])}
                    disabled={removeHistory.isPending}
                  >
                    删除记录
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {query.data?.providers.map((entry) => (
              <Card key={entry.id}>
                <CardHeader>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="break-all">{entry.id}</CardTitle>
                      <CardDescription className="mt-1 break-all">
                        {entry.provider.baseUrl}
                      </CardDescription>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(entry)}
                      >
                        <Pencil />
                        编辑
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`更多操作：${entry.id}`}
                            >
                              <Ellipsis />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteTarget(entry)}
                          >
                            <Trash2 />
                            删除 Provider
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs">
                    API：{entry.provider.api} · 模型：{entry.modelCount}
                  </p>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    {entry.provider.models.map((model) => {
                      const key = `${entry.id}/${model.id}`
                      const status = benchmarkStatusText(
                        latestBenchmark.get(key),
                        pendingTargets.includes(key),
                        now
                      )
                      return (
                        <div
                          key={model.id}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span className="min-w-0 flex-1 break-all">
                            {model.name ?? model.id} ·{" "}
                            {model.contextWindow ?? "未声明"} context /{" "}
                            {model.maxTokens ?? "未声明"} 输出
                          </span>
                          {/* 触发与结果合成同一个按钮：文字随测速状态变化 */}
                          <Button
                            size="sm"
                            variant="outline"
                            className={
                              status?.failed ? "text-destructive" : undefined
                            }
                            disabled={busyBenchmarkKeys.has(key)}
                            onClick={() =>
                              void runBenchmarks([
                                { providerId: entry.id, modelId: model.id },
                              ])
                            }
                          >
                            <Gauge />
                            {status ? status.text : "测首字"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setLabSelection({
                                provider: entry.id,
                                model: model.id,
                              })
                              setActiveTab("chat")
                            }}
                          >
                            打开 Playground
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) {
            setDraft(null)
            setEditingId(null)
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "编辑 Provider" : "新增 Provider"}
            </DialogTitle>
            <DialogDescription>
              留空密钥会保留已有值；所有模型使用 Pi models.json 原生字段。
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider ID">
                <Input
                  value={draft.providerId}
                  onChange={(event) =>
                    setDraft({ ...draft, providerId: event.target.value })
                  }
                />
              </Field>
              <Field label="显示名称">
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </Field>
              <Field label="Base URL">
                <Input
                  value={draft.baseUrl}
                  onChange={(event) =>
                    setDraft({ ...draft, baseUrl: event.target.value })
                  }
                />
              </Field>
              <Field label="API 协议">
                <Input
                  value={draft.api}
                  onChange={(event) =>
                    setDraft({ ...draft, api: event.target.value })
                  }
                />
              </Field>
              <Field label="API Key（留空保留已保存密钥）">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={draft.apiKey}
                  onChange={(event) =>
                    setDraft({ ...draft, apiKey: event.target.value })
                  }
                />
              </Field>
              {editingId &&
              query.data?.providers.find((entry) => entry.id === editingId)
                ?.hasApiKey ? (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={draft.clearApiKey}
                    onChange={(event) =>
                      setDraft({ ...draft, clearApiKey: event.target.checked })
                    }
                  />
                  清除已保存密钥
                </label>
              ) : null}
              <Field label="模型列表 JSON（支持多个模型）">
                <Textarea
                  className="min-h-52 font-mono text-xs"
                  value={draft.modelsJson}
                  onChange={(event) =>
                    setDraft({ ...draft, modelsJson: event.target.value })
                  }
                />
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDraft(null)}
              disabled={save.isPending}
            >
              取消
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !query.data}
            >
              {save.isPending ? "保存中…" : "保存配置"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 Provider？</DialogTitle>
            <DialogDescription>
              将从 Pi 的 models.json 删除「{deleteTarget?.id}
              」。此操作会创建备份；默认 Provider 不能删除，须先更改默认设置。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={remove.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && remove.mutate(deleteTarget)}
              disabled={remove.isPending}
            >
              {remove.isPending ? "删除中…" : "删除 Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const Field = (props: { label: string; children: React.ReactNode }) => (
  <Label className="grid gap-1 text-xs">
    {props.label}
    {props.children}
  </Label>
)
