import {
  Add01Icon,
  Delete02Icon,
  Edit01Icon,
  RefreshIcon,
  Robot01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ApiRequestError,
  addPiProvider,
  deletePiBenchmarks,
  deletePiProvider,
  fetchTaskByRequestId,
  newRequestId,
  startPiBenchmark,
  updatePiProvider,
} from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select"
import { Textarea } from "@web/components/ui/textarea"
import {
  forgetPendingRequest,
  rememberPendingRequest,
} from "@web/features/tasks/pending-requests"
import { useState } from "react"
import { toast } from "sonner"
import { GroupsTab } from "./GroupsTab"
import { LabTab } from "./LabTab"
import { piKeys, usePiBenchmarks, usePiModels } from "./queries"
import { SettingsTab } from "./SettingsTab"

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

export const PiPage = () => {
  const queryClient = useQueryClient()
  const query = usePiModels()
  const [activeTab, setActiveTab] = useState<
    "models" | "groups" | "settings" | "probe" | "chat"
  >(() =>
    new URL(window.location.href).searchParams.get("piRun") ? "chat" : "models"
  )
  const [labSelection, setLabSelection] = useState<{
    provider: string
    model: string
  } | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProviderEntry | null>(null)
  const [benchmarkProvider, setBenchmarkProvider] = useState("")
  const [benchmarkModel, setBenchmarkModel] = useState("")
  const [benchmarkThinking, setBenchmarkThinking] = useState<
    "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  >("medium")
  const [activeBenchmark, setActiveBenchmark] = useState<{
    requestId: string
    taskId: string | null
  } | null>(null)
  const history = usePiBenchmarks(activeTab === "models")
  const activeTask = useQuery({
    queryKey: [
      ...piKeys.all,
      "benchmark-task",
      activeBenchmark?.requestId ?? "",
    ],
    queryFn: () => fetchTaskByRequestId(activeBenchmark?.requestId ?? ""),
    enabled: activeBenchmark !== null,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "running" || query.state.data === null
        ? 1000
        : false,
  })
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
  const benchmark = useMutation({
    mutationFn: async () => {
      if (!benchmarkProvider || !benchmarkModel)
        throw new Error("请选择 Provider 和模型")
      const requestId = newRequestId()
      rememberPendingRequest({
        requestId,
        kind: "pi_benchmark",
        target: `Pi ${benchmarkProvider}/${benchmarkModel}`,
        startedAt: Date.now(),
        taskId: null,
      })
      return {
        requestId,
        result: await startPiBenchmark(
          {
            providerId: benchmarkProvider,
            modelId: benchmarkModel,
            thinkingLevel: benchmarkThinking,
          },
          requestId
        ),
      }
    },
    onSuccess: async ({ requestId, result }) => {
      if (result.kind === "completed") {
        forgetPendingRequest({ requestId })
        setActiveBenchmark(null)
        if (result.body.status === "done") toast.success("Pi 模型测速完成")
        else toast.error(result.body.message)
      } else {
        setActiveBenchmark({ requestId, taskId: result.body.taskId })
        rememberPendingRequest({
          requestId,
          kind: "pi_benchmark",
          target: `Pi ${benchmarkProvider}/${benchmarkModel}`,
          startedAt: result.body.startedAt * 1000,
          taskId: result.body.taskId,
        })
      }
      await queryClient.invalidateQueries({ queryKey: piKeys.benchmarks() })
    },
    onError: async (error) => {
      if (
        error instanceof ApiRequestError &&
        error.resultUnknown &&
        error.requestId
      ) {
        setActiveBenchmark({ requestId: error.requestId, taskId: null })
        toast.error("测速响应未知，正在通过请求标识核实任务")
      } else {
        toast.error(error.message || "测速未完成")
      }
      await queryClient.invalidateQueries({ queryKey: piKeys.benchmarks() })
    },
  })
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

  const benchmarkRunning =
    activeBenchmark !== null &&
    (!activeTask.data || activeTask.data.status === "running")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <HugeiconsIcon icon={Robot01Icon} className="size-4" />
        <h1 className="text-sm font-medium">Pi 模型管理</h1>
        <span className="text-xs text-muted-foreground">
          密钥仅写入、不回显；模型参数由 Pi 上游格式校验
        </span>
        <div className="flex gap-1 rounded-md bg-muted p-1">
          <Button
            size="sm"
            className="min-h-11"
            variant={activeTab === "models" ? "default" : "ghost"}
            onClick={() => setActiveTab("models")}
          >
            模型
          </Button>
          <Button
            size="sm"
            className="min-h-11"
            variant={activeTab === "groups" ? "default" : "ghost"}
            onClick={() => setActiveTab("groups")}
          >
            分组
          </Button>
          <Button
            size="sm"
            className="min-h-11"
            variant={activeTab === "settings" ? "default" : "ghost"}
            onClick={() => setActiveTab("settings")}
          >
            设置
          </Button>
          <Button
            className="min-h-11"
            variant={activeTab === "probe" ? "default" : "ghost"}
            onClick={() => setActiveTab("probe")}
          >
            能力探测
          </Button>
          <Button
            className="min-h-11"
            variant={activeTab === "chat" ? "default" : "ghost"}
            onClick={() => setActiveTab("chat")}
          >
            Playground
          </Button>
        </div>
        {activeTab === "models" ? (
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <HugeiconsIcon icon={RefreshIcon} />
              刷新
            </Button>
            <Button size="sm" onClick={() => startEdit()}>
              <HugeiconsIcon icon={Add01Icon} />
              添加 Provider
            </Button>
          </div>
        ) : null}
      </header>
      {activeTab === "groups" ? (
        <GroupsTab />
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
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>模型测速</CardTitle>
              <CardDescription>
                点击后产生真实请求；本次输出取配置上限与 4096 的较小值。正文 TPS
                仅在上游提供推理 token 拆分时计算。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Label className="grid gap-1 text-xs">
                Provider
                <Select
                  value={benchmarkProvider}
                  onValueChange={(value) => {
                    setBenchmarkProvider(value ?? "")
                    setBenchmarkModel("")
                  }}
                >
                  <SelectTrigger aria-label="测速 Provider">
                    <SelectValue placeholder="选择 Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {query.data?.providers.map((entry) => (
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
                  value={benchmarkModel}
                  onValueChange={(value) => setBenchmarkModel(value ?? "")}
                >
                  <SelectTrigger aria-label="测速模型">
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {query.data?.providers
                      .find((entry) => entry.id === benchmarkProvider)
                      ?.provider.models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name ?? model.id} · max{" "}
                          {model.maxTokens ?? "未声明"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1 text-xs">
                Thinking
                <Select
                  value={benchmarkThinking}
                  onValueChange={(value) => {
                    if (value)
                      setBenchmarkThinking(value as typeof benchmarkThinking)
                  }}
                >
                  <SelectTrigger aria-label="测速 Thinking">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "off",
                      "minimal",
                      "low",
                      "medium",
                      "high",
                      "xhigh",
                      "max",
                    ].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
              <Button
                className="min-h-11"
                onClick={() => benchmark.mutate()}
                disabled={
                  benchmark.isPending ||
                  benchmarkRunning ||
                  !benchmarkProvider ||
                  !benchmarkModel
                }
              >
                {benchmark.isPending || benchmarkRunning
                  ? "测速中…"
                  : "开始一次测速"}
              </Button>
              {activeBenchmark ? (
                <p role="status">
                  {activeTask.data?.status ?? "核实中"}；可在任务历史查看结果。
                </p>
              ) : null}
            </CardContent>
          </Card>
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
                    首事件 {item.metrics.firstEventMs ?? "—"} ms · 首正文{" "}
                    {item.metrics.firstTextMs ?? "—"} ms · 总时长{" "}
                    {item.metrics.durationMs ?? "—"} ms
                  </p>
                  <p>
                    输入 {item.metrics.inputTokens ?? "—"} · 输出{" "}
                    {item.metrics.outputTokens ?? "—"} · 文本输出{" "}
                    {item.metrics.textOutputTokens ?? "—"} · 缓存读{" "}
                    {item.metrics.cacheReadTokens ?? "—"} · 缓存写{" "}
                    {item.metrics.cacheWriteTokens ?? "—"}
                  </p>
                  <p>
                    正文 tokens/s：{item.metrics.outputTokensPerSecond ?? "—"} ·
                    停止原因：{item.stopReason ?? "—"} ·{" "}
                    {item.error ?? "无错误"}
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
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {entry.hasApiKey ? "密钥已配置" : "无内置密钥"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs">
                    API：{entry.provider.api} · 模型：{entry.modelCount}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(entry)}
                    >
                      <HugeiconsIcon icon={Edit01Icon} />
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteTarget(entry)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} />
                      删除
                    </Button>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {entry.provider.models.map((model) => (
                      <p key={model.id} className="break-all">
                        {model.name ?? model.id} ·{" "}
                        {model.contextWindow ?? "未声明"} context /{" "}
                        {model.maxTokens ?? "未声明"} 输出
                        <Button
                          className="ml-2 min-h-11"
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
                      </p>
                    ))}
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
                <label className="flex min-h-11 items-center gap-2 text-xs">
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
