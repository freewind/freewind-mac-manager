import type { PiBenchmarkResult } from "@shared/api-contract"
import {
  ApiRequestError,
  addPiProvider,
  deletePiProvider,
  newRequestId,
  startPiBenchmark,
  unwrap,
  updatePiProvider,
} from "@shared/client-api"
import { formatToSeconds } from "@shared/format"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { HighlightText } from "@web/components/HighlightText"
import { PageHeader } from "@web/components/PageHeader"
import { Badge } from "@web/components/ui/badge"
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
import { Sheet, SheetContent, SheetTitle } from "@web/components/ui/sheet"
import { Textarea } from "@web/components/ui/textarea"
import { SettingsCard } from "@web/features/ai-assistant/SettingsCard"
import {
  forgetPendingRequest,
  rememberPendingRequest,
} from "@web/features/tasks/pending-requests"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import {
  Bot,
  ChevronDown,
  Copy,
  Ellipsis,
  Eye,
  Gauge,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { BenchmarkHistoryTab } from "./BenchmarkHistoryTab"
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
  history: "测速历史",
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

/** 新增模型的表单：粘上 JSON 时以 JSON 为准，否则用下面的字段拼。 */
type ModelDraft = {
  providerId: string
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  json: string
}

/** 粘贴的模型 JSON：必须是对象且带非空 id，其余字段原样保留。 */
const parseModelJson = (text: string): Record<string, unknown> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("模型 JSON 不是合法 JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("模型 JSON 必须是对象")
  const id = (parsed as { id?: unknown }).id
  if (typeof id !== "string" || id.trim() === "")
    throw new Error("模型 JSON 需要非空的 id")
  return { ...(parsed as Record<string, unknown>), id: id.trim() }
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

/** 数字输入转成可选字段：空串或非法值不写入，避免把可选字段写成 0。 */
const optionalNumber = (
  key: "contextWindow" | "maxTokens",
  value: string
): Record<string, number> => {
  const text = value.trim()
  if (text === "") return {}
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed <= 0) return {}
  return { [key]: Math.trunc(parsed) }
}

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

/**
 * 卡片上参与搜索的文本：provider id、显示名、baseUrl，以及每个模型的 id 与名字。
 * api 协议、密钥等其余字段不参与匹配。
 */
const providerSearchText = (entry: ProviderEntry): string =>
  [
    entry.id,
    entry.provider.name ?? "",
    entry.provider.baseUrl,
    ...entry.provider.models.flatMap((model) => [model.id, model.name ?? ""]),
  ]
    .join("\n")
    .toLowerCase()

export const PiPage = () => {
  const queryClient = useQueryClient()
  const query = usePiModels()
  const isDesktop = useIsDesktop()
  const { tab: activeTab, selectTab } = usePiTab()
  const setActiveTab = selectTab
  /** 抽屉里的 Playground 目标：从模型菜单点开时带入 provider 与 model。 */
  const [playgroundTarget, setPlaygroundTarget] = useState<{
    provider: string
    model: string
  } | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProviderEntry | null>(null)
  /** 新增模型的表单草稿；null 表示弹层关闭。 */
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null)
  /** 待查看详情的 provider：弹层显示它的原始配置。 */
  const [detailTarget, setDetailTarget] = useState<ProviderEntry | null>(null)
  /** 待确认删除的模型：provider 与 model 标识。 */
  const [deleteModelTarget, setDeleteModelTarget] = useState<{
    providerId: string
    modelId: string
  } | null>(null)
  /** 已发出但还没拿到回执的测速目标，键为 `provider/model`。 */
  const [pendingTargets, setPendingTargets] = useState<string[]>([])
  /** Provider 列表的搜索关键词：匹配 provider id、显示名、baseUrl 与模型 id/名字。 */
  const [providerKeyword, setProviderKeyword] = useState("")
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
  /**
   * 删除单个模型：把该 provider 的 models 过滤后整体保存。
   * 少于两个模型时不动：服务端 models 至少 1 个；删中默认模型会被告知先换默认模型。
   */
  const removeModel = useMutation({
    mutationFn: async (target: { providerId: string; modelId: string }) => {
      const entry = query.data?.providers.find(
        (item) => item.id === target.providerId
      )
      if (!entry || !query.data) throw new Error("请先刷新配置后重试")
      // 用 unwrap 抛出服务端文案：删除默认模型等情况需要原话告知用户。
      return unwrap(
        await updatePiProvider(entry.id, {
          providerId: entry.id,
          signature: query.data.signature,
          provider: {
            ...entry.provider,
            name: entry.provider.name ?? entry.id,
            models: entry.provider.models.filter(
              (model) => model.id !== target.modelId
            ),
          },
        })
      )
    },
    onSuccess: async () => {
      toast.success("模型已删除")
      setDeleteModelTarget(null)
      await invalidate()
    },
    onError: (error) => toast.error(error.message || "删除模型失败"),
  })
  /** 追加一个模型：手动添加与复制走同一条保存路径。 */
  const addModel = useMutation({
    mutationFn: async (draft: ModelDraft) => {
      const entry = query.data?.providers.find(
        (item) => item.id === draft.providerId
      )
      if (!entry || !query.data) throw new Error("请先刷新配置后重试")
      const fromJson =
        draft.json.trim() === "" ? null : parseModelJson(draft.json)
      const id = fromJson ? String(fromJson.id) : draft.id.trim()
      if (id === "") throw new Error("模型 id 不能为空")
      if (entry.provider.models.some((model) => model.id === id))
        throw new Error("该 provider 已有同名模型 id")
      const next = (fromJson ?? {
        id,
        ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
        ...optionalNumber("contextWindow", draft.contextWindow),
        ...optionalNumber("maxTokens", draft.maxTokens),
      }) as (typeof entry.provider.models)[number]
      return unwrap(
        await updatePiProvider(entry.id, {
          providerId: entry.id,
          signature: query.data.signature,
          provider: {
            ...entry.provider,
            name: entry.provider.name ?? entry.id,
            models: [...entry.provider.models, next],
          },
        })
      )
    },
    onSuccess: async () => {
      toast.success("模型已添加")
      setModelDraft(null)
      await invalidate()
    },
    onError: (error) => toast.error(error.message || "添加模型失败"),
  })

  /** 复制模型配置为 JSON：方便在另一个 provider 里直接粘贴添加。 */
  const copyModelJson = async (
    model: ProviderEntry["provider"]["models"][number]
  ): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(model, null, 2))
      toast.success("模型 JSON 已复制")
    } catch {
      toast.error("复制失败：浏览器拒绝了剪贴板访问")
    }
  }

  /** 复制一个新的 provider：id 与显示名加后缀，密钥不能跟着走。 */
  const copyProvider = useMutation({
    mutationFn: async (entry: ProviderEntry) => {
      if (!query.data) throw new Error("请先刷新配置后重试")
      return unwrap(
        await addPiProvider({
          providerId: `${entry.id}-copy`,
          signature: query.data.signature,
          provider: {
            ...entry.provider,
            name: `${entry.provider.name ?? entry.id} (. copy)`,
          },
        })
      )
    },
    onSuccess: async () => {
      toast.success("已复制为新 Provider，请补充 API Key")
      await invalidate()
    },
    onError: (error) => toast.error(error.message || "复制 Provider 失败"),
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
  /** 搜索只过滤列表显示，不改变「全部测速」的目标集合。 */
  const keyword = providerKeyword.trim().toLowerCase()
  const visibleProviders = (query.data?.providers ?? []).filter(
    (entry) => keyword === "" || providerSearchText(entry).includes(keyword)
  )
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
          </div>
        ) : null}
      </header>
      {activeTab === "history" ? (
        <BenchmarkHistoryTab />
      ) : activeTab === "groups" ? (
        <GroupsTab />
      ) : activeTab === "assistant" ? (
        <SettingsCard />
      ) : activeTab === "settings" ? (
        <SettingsTab />
      ) : activeTab === "probe" || activeTab === "chat" ? (
        <LabTab key={activeTab} mode={activeTab} />
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
            <Input
              className="h-8 w-56"
              placeholder="搜索 Provider / URL / 模型"
              aria-label="搜索 Provider、URL 或模型"
              value={providerKeyword}
              onChange={(event) => setProviderKeyword(event.target.value)}
            />
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
            <Button size="sm" onClick={() => startEdit()}>
              <Plus />
              添加 Provider
            </Button>
          </div>

          {visibleProviders.length === 0 &&
          (query.data?.providers.length ?? 0) > 0 ? (
            <p className="text-sm text-muted-foreground">
              没有匹配的 Provider。
            </p>
          ) : null}
          {/* 瀑布流：卡片各按内容定高，短卡片不再被同行最高卡片拉高留白 */}
          <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">
            {visibleProviders.map((entry) => (
              <Card key={entry.id} className="mb-3 break-inside-avoid">
                <CardHeader>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="break-all">
                        <HighlightText
                          text={entry.id}
                          keyword={providerKeyword}
                        />
                      </CardTitle>
                      <CardDescription className="mt-1 break-all">
                        <HighlightText
                          text={entry.provider.baseUrl}
                          keyword={providerKeyword}
                        />
                      </CardDescription>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
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
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem
                            className="min-h-8 text-sm"
                            onClick={() => setDetailTarget(entry)}
                          >
                            <Eye />
                            查看详情
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-8 text-sm"
                            disabled={busyBenchmarkKeys.size > 0}
                            onClick={() =>
                              void runBenchmarks(
                                entry.provider.models.map((model) => ({
                                  providerId: entry.id,
                                  modelId: model.id,
                                }))
                              )
                            }
                          >
                            <Gauge />
                            整组测速
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-8 text-sm"
                            onClick={() => startEdit(entry)}
                          >
                            <Pencil />
                            编辑
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-8 text-sm"
                            onClick={() => copyProvider.mutate(entry)}
                            disabled={copyProvider.isPending}
                          >
                            <Copy />
                            复制为新 Provider
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-8 text-sm"
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
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 break-all">
                            <Badge
                              variant="outline"
                              className="h-6 px-2 text-xs"
                            >
                              <HighlightText
                                text={model.name ?? model.id}
                                keyword={providerKeyword}
                              />
                            </Badge>
                            <span>
                              {model.contextWindow ?? "-"} context /{" "}
                              {model.maxTokens ?? "-"} 输出
                            </span>
                          </span>
                          {/* 测速与菜单合成一组：左侧点击测速，右侧展开菜单 */}
                          <div className="flex">
                            <Button
                              size="sm"
                              variant="outline"
                              className={
                                status?.failed
                                  ? "rounded-r-none text-destructive"
                                  : "rounded-r-none"
                              }
                              disabled={busyBenchmarkKeys.has(key)}
                              onClick={() =>
                                void runBenchmarks([
                                  { providerId: entry.id, modelId: model.id },
                                ])
                              }
                            >
                              <Gauge />
                              {status ? status.text : "首字"}
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="rounded-l-none border-l-0 px-1.5"
                                    aria-label={`「${model.id}」的更多操作`}
                                  >
                                    <ChevronDown />
                                  </Button>
                                }
                              />
                              <DropdownMenuContent
                                align="end"
                                className="w-auto min-w-44"
                              >
                                <DropdownMenuItem
                                  className="min-h-8 text-sm"
                                  onClick={() =>
                                    setPlaygroundTarget({
                                      provider: entry.id,
                                      model: model.id,
                                    })
                                  }
                                >
                                  <MessageSquare />
                                  打开 Playground
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="min-h-8 text-sm"
                                  onClick={() => void copyModelJson(model)}
                                >
                                  <Copy />
                                  复制模型信息
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="min-h-8 text-sm"
                                  variant="destructive"
                                  disabled={entry.provider.models.length <= 1}
                                  onClick={() =>
                                    setDeleteModelTarget({
                                      providerId: entry.id,
                                      modelId: model.id,
                                    })
                                  }
                                >
                                  <Trash2 />
                                  删除模型
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1"
                    onClick={() =>
                      setModelDraft({
                        providerId: entry.id,
                        id: "",
                        name: "",
                        contextWindow: "",
                        maxTokens: "",
                        json: "",
                      })
                    }
                  >
                    <Plus />
                    添加模型
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog
        open={detailTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDetailTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Provider 详情：{detailTarget?.id}</DialogTitle>
            <DialogDescription>
              以下为 models.json 中的原始配置；密钥不回显。
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60dvh] overflow-auto rounded border p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {detailTarget ? JSON.stringify(detailTarget.provider, null, 2) : ""}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailTarget(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={modelDraft !== null}
        onOpenChange={(open) => {
          if (!open && !addModel.isPending) setModelDraft(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加模型</DialogTitle>
            <DialogDescription>
              模型会追加到「{modelDraft?.providerId}」的 models 列表；id
              必须唯一。
            </DialogDescription>
          </DialogHeader>
          {modelDraft ? (
            <div className="grid gap-3">
              <Field label="模型 JSON（粘贴后以它为准）">
                <Textarea
                  className="min-h-32 font-mono text-xs"
                  value={modelDraft.json}
                  onChange={(event) =>
                    setModelDraft({
                      ...modelDraft,
                      json: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="模型 id（必填）">
                <Input
                  value={modelDraft.id}
                  onChange={(event) =>
                    setModelDraft({ ...modelDraft, id: event.target.value })
                  }
                />
              </Field>
              <Field label="显示名称（可选）">
                <Input
                  value={modelDraft.name}
                  onChange={(event) =>
                    setModelDraft({ ...modelDraft, name: event.target.value })
                  }
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="context window（可选）">
                  <Input
                    inputMode="numeric"
                    value={modelDraft.contextWindow}
                    onChange={(event) =>
                      setModelDraft({
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
                      setModelDraft({
                        ...modelDraft,
                        maxTokens: event.target.value,
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModelDraft(null)}
              disabled={addModel.isPending}
            >
              取消
            </Button>
            <Button
              onClick={() => modelDraft && addModel.mutate(modelDraft)}
              disabled={
                addModel.isPending || (modelDraft?.id.trim() ?? "") === ""
              }
            >
              {addModel.isPending ? "保存中…" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog
        open={deleteModelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removeModel.isPending) setDeleteModelTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除模型？</DialogTitle>
            <DialogDescription>
              将从 provider「{deleteModelTarget?.providerId}」删除模型「
              {deleteModelTarget?.modelId}」。此操作会创建备份；若它是默认模型，
              须先在设置里更换默认模型。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteModelTarget(null)}
              disabled={removeModel.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteModelTarget && removeModel.mutate(deleteModelTarget)
              }
              disabled={removeModel.isPending}
            >
              {removeModel.isPending ? "删除中…" : "删除模型"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Playground 抽屉：就地试模型，不离开模型列表 */}
      <Sheet
        open={playgroundTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPlaygroundTarget(null)
        }}
      >
        <SheetContent
          side="right"
          className="data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
        >
          <SheetTitle className="sr-only">
            Playground：{playgroundTarget?.provider}/{playgroundTarget?.model}
          </SheetTitle>
          {playgroundTarget ? (
            <LabTab
              key={`${playgroundTarget.provider}/${playgroundTarget.model}`}
              mode="chat"
              initialProvider={playgroundTarget.provider}
              initialModel={playgroundTarget.model}
              showHistory={false}
              layout="stack"
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

const Field = (props: { label: string; children: React.ReactNode }) => (
  <Label className="grid gap-1 text-xs">
    {props.label}
    {props.children}
  </Label>
)
