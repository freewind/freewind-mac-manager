import type { PiLabInput } from "@shared/api-contract/schemas/pi-lab"
import {
  ApiRequestError,
  cancelPiLab,
  clearPiLab,
  fetchPiLab,
  fetchPiLabRuns,
  newRequestId,
  startPiLab,
} from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { HighlightText } from "@web/components/HighlightText"
import { Button } from "@web/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@web/components/ui/combobox"
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import { Textarea } from "@web/components/ui/textarea"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { usePiModels } from "./queries"

/**
 * 服务端按 70 秒没有新进度就把 running 判为 unknown（server/pi/lab.ts），
 * 客户端用同一判据停止轮询，页面则按「结果未知」如实展示。
 */
const PI_LAB_STALE_LIMIT_MS = 70_000
const PI_LAB_STALE_LIMIT_SECONDS = PI_LAB_STALE_LIMIT_MS / 1000

/** thinking 档位从弱到强；模型能力里缺省的档位按支持处理。 */
const THINKING_ORDER = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const

/** 折叠摘要用的中文档位名；遇到未知取值就原样显示，不掩盖实际输入。 */
const THINKING_LABELS: Record<string, string> = {
  off: "关闭",
  minimal: "最小",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最大",
}

export const LabTab = ({
  mode,
  initialProvider = "",
  initialModel = "",
  showHistory = true,
  layout = "split",
}: {
  mode: "chat" | "probe"
  initialProvider?: string
  initialModel?: string
  /** 近期请求列表：抽屉里就地试用时不带历史，其它入口保持显示。 */
  showHistory?: boolean
  /** split：桌面左右并列；stack：单列堆叠，给栅格容器的抽屉用。 */
  layout?: "split" | "stack"
}) => {
  const models = usePiModels()
  const client = useQueryClient()
  const [providerId, setProvider] = useState(initialProvider)
  const [modelId, setModel] = useState(initialModel)
  /** 输入框文本：null 表示跟随选中值；展开时清空才能搜索，收起回到 null。 */
  const [providerInput, setProviderInput] = useState<string | null>(null)
  const [modelInput, setModelInput] = useState<string | null>(null)
  const [sessionId, setSession] = useState<string>(() => crypto.randomUUID())
  const [prompt, setPrompt] = useState("请简短回答：1 + 1 等于多少？")
  const [systemPrompt, setSystem] = useState("你是一个简洁的对话助手。")
  const isDesktop = useIsDesktop()
  // 抽屉宽度比分区页窄：容器宽度不够时硬分两列，表单会被压成半宽、右侧留空。
  const stack = layout === "stack"
  // 手机上参数与结果二选一：发送后直接看结果，可随时返回参数
  const [mobileView, setMobileView] = useState<"form" | "result">("form")
  // 高级参数默认收起：chat 与 probe 共用同一个开关，避免两处状态不同步
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [thinking, setThinking] =
    useState<NonNullable<PiLabInput["thinking"]>>("off")
  const [maxTokens, setMaxTokens] = useState(512)
  const [tokens, setTokens] = useState("128,512")
  const [levels, setLevels] = useState("off,high")
  const [id, setId] = useState<string | null>(() => {
    const params = new URL(window.location.href).searchParams
    return params.get("piRun")
  })
  const history = useQuery({
    queryKey: ["pi", "lab"],
    queryFn: fetchPiLabRuns,
    enabled: showHistory,
    retry: false,
  })
  const run = useQuery({
    queryKey: ["pi", "lab", id],
    queryFn: ({ signal }) => fetchPiLab(id ?? "", signal),
    enabled: id !== null,
    retry: false,
    // 失败就停：继续 500ms 重试只会让页面永远停在「正在检测」，却什么也查不到。
    refetchInterval: (query) => {
      if (query.state.error) return false
      const data = query.state.data
      if (!data) return 500
      if (data.status !== "running") return false
      // 与服务端的陈旧判据对齐：到点后服务端会返回 unknown，这里先停住
      return Date.now() - data.updatedAt > PI_LAB_STALE_LIMIT_MS ? false : 500
    },
  })
  const busy = id !== null && (!run.data || run.data.status === "running")

  // 切页或关闭组件时取消仍在进行的读取，不留下悬挂的「正在检测」
  useEffect(
    () => () => {
      if (id !== null) {
        void client.cancelQueries({ queryKey: ["pi", "lab", id] })
      }
    },
    [client, id]
  )

  // 进度里的「距上次更新 / 剩余」随每次轮询的重渲染刷新，不用本地定时器
  const staleMs = run.data ? Date.now() - run.data.updatedAt : 0
  const runTimedOut = busy && staleMs > PI_LAB_STALE_LIMIT_MS
  const completed = run.data?.samples.length ?? 0
  const totalSamples = mode === "probe" ? 4 : 1
  const remainSeconds = Math.max(
    0,
    Math.ceil((PI_LAB_STALE_LIMIT_MS - staleMs) / 1000)
  )
  const send = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!providerId || !modelId) throw new Error("请填写 Provider 和模型 ID")
      const requestId = newRequestId()
      setId(requestId)
      const url = new URL(window.location.href)
      url.searchParams.set("piRun", requestId)
      window.history.replaceState(window.history.state, "", url)
      const candidates = levels.split(",").map((value) => value.trim())
      if (
        candidates.some(
          (value) => !(THINKING_ORDER as readonly string[]).includes(value)
        )
      )
        throw new Error("thinking 档位无效")
      return startPiLab(
        {
          mode,
          providerId,
          modelId,
          sessionId,
          prompt,
          systemPrompt,
          thinking: effectiveThinking,
          maxTokens,
          tokenCandidates: tokens.split(",").map(Number),
          thinkingCandidates: candidates as NonNullable<
            PiLabInput["thinkingCandidates"]
          >,
        },
        requestId
      )
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["pi", "lab"] })
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiRequestError && error.resultUnknown
          ? "响应未知；通过已登记请求核实，不重新发送"
          : error.message
      )
      if (!(error instanceof ApiRequestError && error.resultUnknown))
        setId(null)
    },
  })
  const cancel = useMutation({
    mutationFn: async () => {
      // 先取消本地仍在进行的读取，再让服务端停下这次运行
      await client.cancelQueries({ queryKey: ["pi", "lab", id] })
      return cancelPiLab(id ?? "")
    },
    onSuccess: () => run.refetch(),
    onError: (error) => toast.error(error.message),
  })
  const clear = useMutation({
    mutationFn: () => clearPiLab(sessionId),
    onSuccess: async () => {
      setSession(crypto.randomUUID())
      setId(null)
      const url = new URL(window.location.href)
      url.searchParams.delete("piRun")
      window.history.replaceState(window.history.state, "", url)
      await history.refetch()
    },
    onError: (error) => toast.error(error.message),
  })
  const selected = models.data?.providers.find((item) => item.id === providerId)
  const providerIds = (models.data?.providers ?? []).map((item) => item.id)
  const modelIds = (selected?.provider.models ?? []).map((item) => item.id)
  const selectedModel = selected?.provider.models.find(
    (item) => item.id === modelId
  )
  /** 模型能力里为 null 的档位不支持；未声明的档位视为支持。 */
  const supportsThinking = (level: string): boolean =>
    selectedModel?.thinkingLevelMap?.[level] !== null
  /**
   * 实际发送的档位：所选档位不被模型支持时换成第一个支持的档位。
   * 很多模型声明 off 为 null（不能关闭 thinking），默认 off 会直接被服务端拒绝。
   */
  const effectiveThinking = supportsThinking(thinking)
    ? thinking
    : (THINKING_ORDER.find(supportsThinking) ?? thinking)
  /** provider 变化就换新会话并清空模型：旧模型不属于新 provider。 */
  const selectProvider = (value: string): void => {
    if (value === providerId) return
    setProvider(value)
    setModel("")
    setModelInput(null)
    setSession(crypto.randomUUID())
  }
  /** 模型变化同样换新会话，避免把上一个模型的上下文带进来。 */
  const selectModel = (value: string): void => {
    if (value === modelId) return
    setModel(value)
    setSession(crypto.randomUUID())
  }
  /** 输入框与选中值分开：输入时只把文本同步给值，不反过来改输入框。 */
  const changeProviderInput = (value: string): void => {
    setProviderInput(value)
    selectProvider(value)
  }
  const changeModelInput = (value: string): void => {
    setModelInput(value)
    selectModel(value)
  }
  /** 参数区：桌面与结果并列的一列，手机上单独一屏。 */
  const paramsSection = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Label className="grid gap-2">
          Provider ID
          <Combobox
            items={providerIds}
            value={providerId}
            inputValue={providerInput ?? providerId}
            onOpenChange={(open) => setProviderInput(open ? "" : null)}
            onValueChange={(value) => selectProvider(value ?? "")}
            onInputValueChange={changeProviderInput}
          >
            <ComboboxInput
              aria-label="Provider ID"
              className="w-full"
              placeholder="选择 Provider"
            />
            <ComboboxContent>
              <ComboboxEmpty>
                {providerIds.length === 0
                  ? "Pi 还没有配置 Provider"
                  : "无匹配的 Provider"}
              </ComboboxEmpty>
              <ComboboxList>
                {(item) => (
                  <ComboboxItem key={item} value={item}>
                    <HighlightText text={item} keyword={providerInput ?? ""} />
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Label>
        <Label className="grid gap-2">
          模型 ID
          <Combobox
            items={modelIds}
            value={modelId}
            inputValue={modelInput ?? modelId}
            onOpenChange={(open) => setModelInput(open ? "" : null)}
            onValueChange={(value) => selectModel(value ?? "")}
            onInputValueChange={changeModelInput}
          >
            <ComboboxInput
              aria-label="模型 ID"
              className="w-full"
              placeholder={providerId === "" ? "请先选择 Provider" : "选择模型"}
            />
            <ComboboxContent>
              <ComboboxEmpty>
                {providerId === ""
                  ? "请先选择 Provider"
                  : modelIds.length === 0
                    ? "该 Provider 没有模型"
                    : "无匹配的模型"}
              </ComboboxEmpty>
              <ComboboxList>
                {(item) => (
                  <ComboboxItem key={item} value={item}>
                    <HighlightText text={item} keyword={modelInput ?? ""} />
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Label>
        {mode === "probe" ? (
          <>
            <Label className="grid gap-2">
              输出上限候选（逗号分隔，取前两项）
              <Input
                value={tokens}
                onChange={(event) => setTokens(event.target.value)}
              />
            </Label>
            <Label className="grid gap-2">
              Thinking 候选（逗号分隔，取前两项）
              <Input
                value={levels}
                onChange={(event) => setLevels(event.target.value)}
              />
            </Label>
          </>
        ) : null}
      </div>
      <Collapsible
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        className="grid gap-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <CollapsibleTrigger
            render={
              <Button variant="outline" size="sm">
                {advancedOpen ? "收起高级参数" : "展开高级参数"}
              </Button>
            }
          />
          {/* 收起时也显示当前取值：折叠只藏输入，不藏可见性 */}
          <span className="text-xs text-muted-foreground">
            思考：{THINKING_LABELS[effectiveThinking] ?? effectiveThinking} ·
            上限：{maxTokens}
          </span>
        </div>
        <CollapsibleContent className="grid gap-3 md:grid-cols-2">
          <Label className="grid gap-2">
            Thinking 档位
            <Input
              aria-label="Thinking 档位"
              value={thinking}
              onChange={(event) => {
                const value = event.target.value
                if (
                  [
                    "off",
                    "minimal",
                    "low",
                    "medium",
                    "high",
                    "xhigh",
                    "max",
                  ].includes(value)
                )
                  setThinking(value as typeof thinking)
              }}
            />
          </Label>
          <Label className="grid gap-2">
            本次输出上限（16–4096）
            <Input
              aria-label="本次输出上限"
              type="number"
              min={16}
              max={4096}
              value={maxTokens}
              onChange={(event) => setMaxTokens(Number(event.target.value))}
            />
          </Label>
        </CollapsibleContent>
      </Collapsible>
      <Label className="grid gap-2">
        系统提示词
        <Textarea
          value={systemPrompt}
          onChange={(event) => setSystem(event.target.value)}
        />
      </Label>
      <Label className="grid gap-2">
        输入
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </Label>
    </div>
  )

  /** 结果区：进度、错误、结果与近期请求。 */
  const resultSection = (
    <div className="flex min-h-0 min-w-0 flex-col gap-4">
      {busy ? (
        <div
          role="status"
          aria-label="探测进度"
          className="grid gap-1 rounded border p-3 text-sm"
        >
          {runTimedOut ? (
            <p>
              已经 {PI_LAB_STALE_LIMIT_SECONDS} 秒没有新进度，按结果未知处理：
              不再自动轮询，可中止当前请求或刷新核实。
            </p>
          ) : (
            <>
              <p>
                {mode === "chat"
                  ? "正在等待模型回复"
                  : `正在探测第 ${completed + 1} 轮`}
                {run.data
                  ? ` · 已完成 ${completed}/${totalSamples} 项`
                  : " · 已提交请求，等待首次进度"}
              </p>
              <p className="text-xs text-muted-foreground">
                距上次更新 {Math.floor(staleMs / 1000)} 秒 · 剩余{" "}
                {remainSeconds} 秒
              </p>
            </>
          )}
        </div>
      ) : null}
      {run.isError ? (
        <p role="alert">{run.error.message}；可刷新核实，勿重复发送。</p>
      ) : null}
      {run.data ? (
        <article className="grid min-w-0 gap-3 rounded border p-3">
          <p role="status">
            {run.data.status}：{run.data.message}
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">
            {run.data.text}
          </pre>
          <details>
            <summary>Thinking 输出</summary>
            <pre className="overflow-auto whitespace-pre-wrap break-all">
              {run.data.thinking || "没有可见思考内容，不代表不支持思考"}
            </pre>
          </details>
          <details>
            <summary>输入及实际发送的脱敏 payload</summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all">
              {run.data.input}\n{run.data.payload}
            </pre>
          </details>
          {run.data.samples.map((sample) => (
            <div
              key={`${sample.requestedThinking}-${sample.requestedMaxTokens}`}
              className="rounded border p-2"
            >
              <p>
                {sample.requestedThinking} / 请求 {sample.requestedMaxTokens}{" "}
                tokens：{sample.status}；停止原因 {sample.stopReason ?? "未知"}
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">
                {sample.sentParameters}
              </pre>
            </div>
          ))}
        </article>
      ) : null}
      {showHistory ? (
        <div className="grid gap-2">
          <h3>近期请求</h3>
          {history.data
            ?.filter((item) => item.mode === mode)
            .map((item) => (
              <Button
                key={item.id}
                variant="outline"
                className="justify-start overflow-hidden"
                onClick={() => {
                  setId(item.id)
                  setProvider(item.providerId)
                  setModel(item.modelId)
                  if (item.sessionId) setSession(item.sessionId)
                }}
              >
                {item.modelId} · {item.status}
              </Button>
            ))}
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-medium">
          {mode === "chat" ? "Playground" : "有界能力探测"}
        </h2>
        <p className="truncate text-xs text-muted-foreground">
          发送会产生真实 API 请求及费用；内容仅保留 24 小时
        </p>
        {mode === "probe" ? (
          <span className="truncate text-xs text-muted-foreground">
            最多 4 次请求、总输出预算 4096 tokens、总时限 60 秒
          </span>
        ) : null}
        {/* 手机：结果视图保留返回参数的入口，不用上下长滚找表单 */}
        {!isDesktop && mobileView === "result" ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setMobileView("form")}
          >
            返回参数
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        {stack ? (
          <div className="flex min-w-0 flex-col gap-4">
            {paramsSection}
            {resultSection}
          </div>
        ) : isDesktop ? (
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {paramsSection}
            {resultSection}
          </div>
        ) : mobileView === "form" ? (
          paramsSection
        ) : (
          resultSection
        )}
      </div>

      {/* 请求入口常驻底栏：结果再长也不用回头找按钮 */}
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
        <Button
          className="min-h-12"
          disabled={busy || send.isPending}
          onClick={() => {
            if (!isDesktop) setMobileView("result")
            send.mutate()
          }}
        >
          {mode === "chat" ? "发送消息" : "发起有界探测"}
        </Button>
        <Button
          variant="outline"
          disabled={!busy || cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          中止当前请求
        </Button>
        <Button
          variant="outline"
          disabled={busy || clear.isPending}
          onClick={() => clear.mutate()}
        >
          清空此会话
        </Button>
      </div>
    </div>
  )
}
