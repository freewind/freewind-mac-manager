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
import { Sheet, SheetContent, SheetTitle } from "@web/components/ui/sheet"
import { SettingsCard } from "@web/features/ai-assistant/SettingsCard"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { Bot, Plus, RefreshCw } from "lucide-react"
import { useState } from "react"
import { BenchmarkHistoryTab } from "./BenchmarkHistoryTab"
import { buildLatestBenchmarkIndex } from "./benchmark-status"
import { LabTab } from "./LabTab"
import { ModelDraftDialog } from "./ModelDraftDialog"
import { PlaygroundTab, type PlaygroundTarget } from "./PlaygroundTab"
import { ProviderDraftDialog } from "./ProviderDraftDialog"
import {
  emptyDraft,
  type ModelDraft,
  type ProviderDraft,
} from "./provider-drafts"
import {
  BenchmarkAllButton,
  ProviderCardView,
  ProviderTableView,
  type ProviderViewActions,
  type ProviderViewData,
  ViewToggleButton,
} from "./provider-views"
import { usePiBenchmarks, usePiModels } from "./queries"
import { SettingsTab } from "./SettingsTab"
import type { DeleteModelTarget, ProviderEntry } from "./types"
import { usePiBenchmarkRuns } from "./use-pi-benchmark-runs"
import { usePiProviderActions } from "./use-pi-provider-actions"
import { PI_TABS, type PiTab, usePiTab } from "./use-pi-tab"

/** 分区在界面上的名字；顺序与 PI_TABS 一致。 */
const PI_TAB_LABELS: Record<PiTab, string> = {
  models: "模型",
  history: "测速历史",
  settings: "设置",
  probe: "能力探测",
  chat: "Playground",
  assistant: "AI助手",
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
  const query = usePiModels()
  const isDesktop = useIsDesktop()
  const { tab: activeTab, selectTab: setActiveTab } = usePiTab()
  /** 抽屉里的 Playground 目标：从模型菜单或历史列表点开时带入 provider 与 model。 */
  const [playgroundTarget, setPlaygroundTarget] =
    useState<PlaygroundTarget | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProviderEntry | null>(null)
  /** 新增模型的表单草稿；null 表示弹层关闭。 */
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null)
  /** 待确认删除的模型：provider 与 model 标识。 */
  const [deleteModelTarget, setDeleteModelTarget] =
    useState<DeleteModelTarget | null>(null)
  /** 列表展示方式：卡片瀑布流或紧凑行。 */
  const [view, setView] = useState<"card" | "row">("card")
  /** Provider 列表的搜索关键词：匹配 provider id、显示名、baseUrl 与模型 id/名字。 */
  const [providerKeyword, setProviderKeyword] = useState("")
  const history = usePiBenchmarks(activeTab === "models")

  const runs = usePiBenchmarkRuns({
    benchmarkRecords: history.data?.benchmarks ?? [],
  })

  const actions = usePiProviderActions({
    query,
    draft,
    editingId,
    onProviderFormClosed: () => {
      setDraft(null)
      setEditingId(null)
    },
    onProviderDeleted: () => setDeleteTarget(null),
    onModelFormClosed: () => setModelDraft(null),
    onModelDeleted: () => setDeleteModelTarget(null),
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

  /** 添加模型弹窗的空草稿；编辑模型的草稿由模型菜单构造。 */
  const startAddModel = (providerId: string): void =>
    setModelDraft({
      providerId,
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

  /** 全部 Provider 下的全部模型，作为「全部测速」的目标集合。 */
  const allBenchmarkTargets = (query.data?.providers ?? []).flatMap((entry) =>
    entry.provider.models.map((model) => ({
      providerId: entry.id,
      modelId: model.id,
    }))
  )
  /** 搜索只过滤列表显示，不改变「全部测速」的目标集合。 */
  const keyword = providerKeyword.trim().toLowerCase()
  const visibleProviders = (query.data?.providers ?? []).filter(
    (entry) => keyword === "" || providerSearchText(entry).includes(keyword)
  )
  const latestBenchmark = buildLatestBenchmarkIndex(
    history.data?.benchmarks ?? []
  )

  const viewData: ProviderViewData = {
    busyBenchmarkKeys: runs.busyBenchmarkKeys,
    latestBenchmark,
    pendingTargets: runs.pendingTargets,
    now: runs.now,
  }
  const viewActions: ProviderViewActions = {
    startEdit: (entry) => startEdit(entry),
    deleteProvider: setDeleteTarget,
    copyProvider: (entry) => actions.copyProvider.mutate(entry),
    copyProviderPending: actions.copyProvider.isPending,
    runBenchmarks: runs.runBenchmarks,
    editModel: setModelDraft,
    addModelTo: startAddModel,
    openPlayground: setPlaygroundTarget,
    copyModelJson: actions.copyModelJson,
    deleteModel: setDeleteModelTarget,
    copyApiKey: actions.copyApiKey,
  }

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
            <ViewToggleButton
              className="ml-auto"
              view={view}
              onToggle={() => setView(view === "card" ? "row" : "card")}
            />
            <BenchmarkAllButton
              count={allBenchmarkTargets.length}
              busy={runs.busyBenchmarkKeys.size > 0}
              onConfirm={() => void runs.runBenchmarks(allBenchmarkTargets)}
            />
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
            <ProviderCardView
              providers={visibleProviders}
              keyword={providerKeyword}
              data={viewData}
              actions={viewActions}
            />
          ) : (
            <ProviderTableView
              providers={visibleProviders}
              keyword={providerKeyword}
              data={viewData}
              actions={viewActions}
            />
          )}
        </div>
      )}

      <ModelDraftDialog
        modelDraft={modelDraft}
        addModel={actions.addModel}
        onChange={setModelDraft}
        onDismiss={() => setModelDraft(null)}
        onCancel={() => setModelDraft(null)}
      />

      <ProviderDraftDialog
        draft={draft}
        editingId={editingId}
        hasSavedKey={Boolean(
          editingId &&
            query.data?.providers.find((entry) => entry.id === editingId)
              ?.hasApiKey
        )}
        canSave={Boolean(query.data)}
        save={actions.save}
        onChange={setDraft}
        onDismiss={() => {
          setDraft(null)
          setEditingId(null)
        }}
        onCancel={() => setDraft(null)}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !actions.remove.isPending) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 Provider？</DialogTitle>
            <DialogDescription>
              将从 Pi 的 models.json 删除「{deleteTarget?.id}
              」。默认 Provider 不能删除，须先更改默认设置。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={actions.remove.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteTarget && actions.remove.mutate(deleteTarget)
              }
              disabled={actions.remove.isPending}
            >
              {actions.remove.isPending ? "删除中…" : "删除 Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteModelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !actions.removeModel.isPending)
            setDeleteModelTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除模型？</DialogTitle>
            <DialogDescription>
              将从 provider「{deleteModelTarget?.providerId}」删除模型「
              {deleteModelTarget?.modelId}」。若它是默认模型，
              须先在设置里更换默认模型。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteModelTarget(null)}
              disabled={actions.removeModel.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteModelTarget &&
                actions.removeModel.mutate(deleteModelTarget)
              }
              disabled={actions.removeModel.isPending}
            >
              {actions.removeModel.isPending ? "删除中…" : "删除模型"}
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
