import type { PiBenchmarkResult } from "@shared/api-contract"
import {
  ApiRequestError,
  addPiProvider,
  deletePiProvider,
  fetchPiProviderApiKey,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
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
  LayoutGrid,
  List,
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
import { PlaygroundTab, type PlaygroundTarget } from "./PlaygroundTab"
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

/** 新增或修改模型的表单：粘上 JSON 时以 JSON 为准，否则用下面的字段拼。 */
type ModelDraft = {
  providerId: string
  /** 非空表示在改已有模型（值为原 id），空表示新增。 */
  editingModelId: string | null
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  /** 粘贴的模型 JSON；非空时优先于上面的字段。 */
  json: string
  reasoning: boolean
  inputText: boolean
  inputImage: boolean
  /** 各 thinking 档位的映射，留空表示不声明。 */
  thinkingLevelMapJson: string
}

/** thinkingLevelMap 必须是 JSON 对象；留空表示不声明这个字段。 */
const parseThinkingLevelMap = (
  text: string
): Record<string, string | null> | null => {
  if (text.trim() === "") return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("thinkingLevelMap 不是合法 JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("thinkingLevelMap 必须是 JSON 对象")
  return parsed as Record<string, string | null>
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
/** 失败详情：除 message 外再带错误类型、停止原因与 requestId，便于复制排查。 */
const benchmarkFailureDetail = (record: PiBenchmarkResult): string =>
  [
    record.message,
    record.error ? `错误类型：${record.error}` : null,
    record.stopReason ? `停止原因：${record.stopReason}` : null,
    `requestId：${record.requestId}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n")

const benchmarkStatusText = (
  record: PiBenchmarkResult | undefined,
  pending: boolean,
  now: number
): { text: string; failed: boolean; detail?: string } | null => {
  if (pending) return { text: "提交中…", failed: false }
  if (record === undefined) return null
  if (record.status === "running") {
    return benchmarkRunningExpired(record, now)
      ? {
          text: "结果未知",
          failed: true,
          detail: benchmarkFailureDetail(record),
        }
      : { text: "测速中…", failed: false }
  }
  if (record.status === "done") {
    const firstByteMs =
      record.metrics.firstTextMs ?? record.metrics.firstEventMs
    return { text: `首字 ${formatToSeconds(firstByteMs)}`, failed: false }
  }
  return {
    text: record.message,
    failed: true,
    detail: benchmarkFailureDetail(record),
  }
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
  /** 抽屉里的 Playground 目标：从模型菜单或历史列表点开时带入 provider 与 model。 */
  const [playgroundTarget, setPlaygroundTarget] =
    useState<PlaygroundTarget | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProviderEntry | null>(null)
  /** 新增模型的表单草稿；null 表示弹层关闭。 */
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null)
  /** 待确认删除的模型：provider 与 model 标识。 */
  const [deleteModelTarget, setDeleteModelTarget] = useState<{
    providerId: string
    modelId: string
  } | null>(null)
  /** 已发出但还没拿到回执的测速目标，键为 `provider/model`。 */
  const [pendingTargets, setPendingTargets] = useState<string[]>([])
  /** 列表展示方式：卡片瀑布流或紧凑行。 */
  const [view, setView] = useState<"card" | "row">("card")
  /** Provider 列表的搜索关键词：匹配 provider id、显示名、baseUrl 与模型 id/名字。 */
  const [providerKeyword, setProviderKeyword] = useState("")
  const history = usePiBenchmarks(activeTab === "models")
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: piKeys.all })
  const save = useMutation({
    mutationFn: async () => {
      if (!draft || !query.data) throw new Error("请先加载配置")
      const existing = editingId
        ? query.data.providers.find((item) => item.id === editingId)?.provider
        : undefined
      /** 编辑不改模型列表：模型在卡片上逐条增删，避免整段 JSON 被误改。 */
      let models = existing?.models
      if (editingId === null) {
        let parsed: unknown
        try {
          parsed = JSON.parse(draft.modelsJson)
        } catch {
          throw new Error("模型列表不是有效 JSON")
        }
        if (!Array.isArray(parsed)) throw new Error("模型列表必须是 JSON 数组")
        models = parsed as typeof models
      }
      if (models === undefined) throw new Error("请先刷新配置后重试")
      const provider = {
        ...asRecord(existing),
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
  /** 追加或修改一个模型：两种入口共用同一套保存逻辑。 */
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
      if (
        entry.provider.models.some(
          (model) => model.id === id && model.id !== draft.editingModelId
        )
      )
        throw new Error("该 provider 已有同名模型 id")
      const thinkingLevelMap = parseThinkingLevelMap(draft.thinkingLevelMapJson)
      const input = [
        ...(draft.inputText ? ["text"] : []),
        ...(draft.inputImage ? ["image"] : []),
      ]
      const next = (fromJson ?? {
        id,
        ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
        ...(draft.reasoning ? { reasoning: true } : {}),
        ...(input.length > 0 ? { input } : {}),
        ...optionalNumber("contextWindow", draft.contextWindow),
        ...optionalNumber("maxTokens", draft.maxTokens),
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      }) as (typeof entry.provider.models)[number]
      const models = draft.editingModelId
        ? entry.provider.models.map((model) =>
            model.id === draft.editingModelId ? next : model
          )
        : [...entry.provider.models, next]
      return unwrap(
        await updatePiProvider(entry.id, {
          providerId: entry.id,
          signature: query.data.signature,
          provider: {
            ...entry.provider,
            name: entry.provider.name ?? entry.id,
            models,
          },
        })
      )
    },
    onSuccess: async () => {
      toast.success("模型已保存")
      setModelDraft(null)
      await invalidate()
    },
    onError: (error) => toast.error(error.message || "添加模型失败"),
  })

  /** 复制密钥：列表只有掩码，用单条接口取明文再写剪贴板。 */
  const copyApiKey = async (providerId: string): Promise<void> => {
    try {
      const { apiKey } = await fetchPiProviderApiKey(providerId)
      if (!apiKey) {
        toast.error("该 Provider 没有保存密钥")
        return
      }
      await navigator.clipboard.writeText(apiKey)
      toast.success("密钥已复制")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制密钥失败")
    }
  }

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

  /** Provider 菜单：卡片与表格视图共用。 */
  const renderProviderMenu = (entry: ProviderEntry) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
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
  )

  /** 模型操作组：首字按钮 + 模型菜单，卡片与表格共用。 */
  const renderModelActions = (
    entry: ProviderEntry,
    model: ProviderEntry["provider"]["models"][number]
  ) => {
    const key = `${entry.id}/${model.id}`
    const status = benchmarkStatusText(
      latestBenchmark.get(key),
      pendingTargets.includes(key),
      now
    )
    const detail = status?.detail
    const benchmarkButton = (
      <Button
        size="sm"
        variant="outline"
        className={
          status?.failed ? "rounded-r-none text-destructive" : "rounded-r-none"
        }
        disabled={busyBenchmarkKeys.has(key)}
        onClick={() =>
          void runBenchmarks([{ providerId: entry.id, modelId: model.id }])
        }
      >
        <Gauge />
        {status ? status.text : "首字"}
      </Button>
    )
    return (
      <div className="flex">
        {/* 失败时悬停看完整错误，避免把长文案塞进按钮 */}
        {status?.failed && detail ? (
          <Tooltip>
            <TooltipTrigger render={benchmarkButton} />
            <TooltipContent className="max-w-md items-start">
              <span className="whitespace-pre-wrap break-all">{detail}</span>
              <button
                type="button"
                aria-label="复制错误信息"
                className="shrink-0 rounded-sm p-0.5 hover:bg-background/20"
                onClick={(event) => {
                  event.stopPropagation()
                  void navigator.clipboard
                    .writeText(detail)
                    .then(() => toast.success("已复制错误信息"))
                }}
              >
                <Copy className="size-3" />
              </button>
            </TooltipContent>
          </Tooltip>
        ) : (
          benchmarkButton
        )}
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
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            <DropdownMenuItem
              className="min-h-8 text-sm"
              onClick={() =>
                setModelDraft({
                  providerId: entry.id,
                  editingModelId: model.id,
                  id: model.id,
                  name: model.name ?? "",
                  contextWindow:
                    model.contextWindow === undefined
                      ? ""
                      : String(model.contextWindow),
                  maxTokens:
                    model.maxTokens === undefined
                      ? ""
                      : String(model.maxTokens),
                  json: "",
                  reasoning: model.reasoning === true,
                  inputText:
                    model.input === undefined || model.input.includes("text"),
                  inputImage: model.input?.includes("image") ?? false,
                  thinkingLevelMapJson: model.thinkingLevelMap
                    ? JSON.stringify(model.thinkingLevelMap, null, 2)
                    : "",
                })
              }
            >
              <Eye />
              详情
            </DropdownMenuItem>
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
    )
  }

  /** 模型一行：标签 + context/输出 + 操作组。 */
  const renderModelRow = (
    entry: ProviderEntry,
    model: ProviderEntry["provider"]["models"][number]
  ) => (
    <div key={model.id} className="flex flex-wrap items-center gap-2">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 break-all">
        <Badge variant="outline" className="h-6 px-2 text-xs">
          <HighlightText
            text={model.name ?? model.id}
            keyword={providerKeyword}
          />
        </Badge>
        <span>
          {model.contextWindow ?? "-"} context / {model.maxTokens ?? "-"} 输出
        </span>
      </span>
      {renderModelActions(entry, model)}
    </div>
  )

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
      ) : activeTab === "probe" ? (
        <LabTab key={activeTab} mode={activeTab} />
      ) : activeTab === "chat" ? (
        <PlaygroundTab onOpen={setPlaygroundTarget} />
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
              className="ml-auto"
              size="sm"
              variant="outline"
              aria-label={
                view === "card"
                  ? "当前卡片视图，切换为行视图"
                  : "当前行视图，切换为卡片视图"
              }
              onClick={() => setView(view === "card" ? "row" : "card")}
            >
              {view === "card" ? <LayoutGrid /> : <List />}
            </Button>
            <Button
              size="sm"
              variant="outline"
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
          {view === "card" ? (
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
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6"
                          onClick={() => startEdit(entry)}
                        >
                          <Eye />
                          详情
                        </Button>
                        {renderProviderMenu(entry)}
                      </div>
                    </div>
                    <p className="text-xs">
                      API：{entry.provider.api} · 模型：{entry.modelCount}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="space-y-2 text-xs text-muted-foreground">
                      {entry.provider.models.map((model) =>
                        renderModelRow(entry, model)
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      onClick={() =>
                        setModelDraft({
                          providerId: entry.id,
                          editingModelId: null,
                          id: "",
                          name: "",
                          contextWindow: "",
                          maxTokens: "",
                          json: "",
                          reasoning: false,
                          inputText: true,
                          inputImage: false,
                          thinkingLevelMapJson: "",
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
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Provider</th>
                    <th className="px-3 py-2 font-medium">URL</th>
                    <th className="px-3 py-2 font-medium">API</th>
                    <th className="px-3 py-2 font-medium">密钥</th>
                    <th className="px-3 py-2 font-medium">模型</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProviders.map((entry) => {
                    const models = entry.provider.models
                    const rows: ((typeof models)[number] | null)[] =
                      models.length > 0 ? models : [null]
                    return (
                      <>
                        {rows.map((model, index) => (
                          <tr
                            key={`${entry.id}/${model?.id ?? "none"}`}
                            className="border-b align-top last:border-b-0"
                          >
                            {index === 0 ? (
                              <>
                                <td
                                  rowSpan={rows.length + 1}
                                  className="px-3 py-2 align-top"
                                >
                                  <div className="font-medium break-all">
                                    <HighlightText
                                      text={entry.id}
                                      keyword={providerKeyword}
                                    />
                                  </div>
                                  {entry.provider.name ? (
                                    <div className="text-muted-foreground break-all">
                                      {entry.provider.name}
                                    </div>
                                  ) : null}
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6"
                                      onClick={() => startEdit(entry)}
                                    >
                                      <Eye />
                                      详情
                                    </Button>
                                    {renderProviderMenu(entry)}
                                  </div>
                                </td>
                                <td
                                  rowSpan={rows.length + 1}
                                  className="px-3 py-2 align-top text-muted-foreground"
                                >
                                  <span className="break-all">
                                    <HighlightText
                                      text={entry.provider.baseUrl}
                                      keyword={providerKeyword}
                                    />
                                  </span>
                                </td>
                                <td
                                  rowSpan={rows.length + 1}
                                  className="px-3 py-2 align-top text-muted-foreground"
                                >
                                  {entry.provider.api}
                                </td>
                                <td
                                  rowSpan={rows.length + 1}
                                  className="px-3 py-2 align-top text-muted-foreground"
                                >
                                  {entry.apiKeyPreview ? (
                                    <div className="flex items-center gap-1">
                                      <span className="font-mono">
                                        {entry.apiKeyPreview}
                                      </span>
                                      <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={`复制「${entry.id}」的密钥`}
                                        onClick={() =>
                                          void copyApiKey(entry.id)
                                        }
                                      >
                                        <Copy />
                                      </Button>
                                    </div>
                                  ) : (
                                    "未设置"
                                  )}
                                </td>
                              </>
                            ) : null}
                            <td className="px-3 py-2">
                              {model ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className="h-6 px-2 text-xs"
                                  >
                                    <HighlightText
                                      text={model.name ?? model.id}
                                      keyword={providerKeyword}
                                    />
                                  </Badge>
                                  <span className="text-muted-foreground">
                                    {model.contextWindow ?? "-"} context /{" "}
                                    {model.maxTokens ?? "-"} 输出
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">
                                  没有模型
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {model ? renderModelActions(entry, model) : null}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-b last:border-b-0">
                          <td colSpan={2} className="px-3 pb-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6"
                              onClick={() =>
                                setModelDraft({
                                  providerId: entry.id,
                                  editingModelId: null,
                                  id: "",
                                  name: "",
                                  contextWindow: "",
                                  maxTokens: "",
                                  json: "",
                                  reasoning: false,
                                  inputText: true,
                                  inputImage: false,
                                  thinkingLevelMapJson: "",
                                })
                              }
                            >
                              <Plus />
                              添加模型
                            </Button>
                          </td>
                        </tr>
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={modelDraft !== null}
        onOpenChange={(open) => {
          if (!open && !addModel.isPending) setModelDraft(null)
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
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={modelDraft.reasoning}
                  onChange={(event) =>
                    setModelDraft({
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
                      setModelDraft({
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
                      setModelDraft({
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
              <Field label="thinking 档位映射（JSON，可选）">
                <Textarea
                  className="min-h-20 font-mono text-xs"
                  placeholder='{"off": null, "high": "high"}'
                  value={modelDraft.thinkingLevelMapJson}
                  onChange={(event) =>
                    setModelDraft({
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
              onClick={() => setModelDraft(null)}
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
              {editingId === null ? (
                <Field label="模型列表 JSON（支持多个模型）">
                  <Textarea
                    className="min-h-52 font-mono text-xs"
                    value={draft.modelsJson}
                    onChange={(event) =>
                      setDraft({ ...draft, modelsJson: event.target.value })
                    }
                  />
                </Field>
              ) : null}
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
            {playgroundTarget?.provider
              ? `Playground：${playgroundTarget.provider}/${playgroundTarget.model}`
              : "Playground"}
          </SheetTitle>
          {playgroundTarget ? (
            <LabTab
              key={`${playgroundTarget.provider}/${playgroundTarget.model}/${playgroundTarget.runId ?? ""}`}
              mode="chat"
              initialProvider={playgroundTarget.provider}
              initialModel={playgroundTarget.model}
              initialRunId={playgroundTarget.runId}
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
