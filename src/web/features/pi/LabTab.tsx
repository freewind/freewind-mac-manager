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
import { Button } from "@web/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
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
}: {
  mode: "chat" | "probe"
  initialProvider?: string
  initialModel?: string
}) => {
  const models = usePiModels()
  const client = useQueryClient()
  const [providerId, setProvider] = useState(initialProvider)
  const [modelId, setModel] = useState(initialModel)
  const [sessionId, setSession] = useState<string>(() => crypto.randomUUID())
  const [prompt, setPrompt] = useState("请简短回答：1 + 1 等于多少？")
  const [systemPrompt, setSystem] = useState("你是一个简洁的对话助手。")
  const isDesktop = useIsDesktop()
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
      const allowed = [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]
      if (candidates.some((value) => !allowed.includes(value)))
        throw new Error("thinking 档位无效")
      return startPiLab(
        {
          mode,
          providerId,
          modelId,
          sessionId,
          prompt,
          systemPrompt,
          thinking,
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
  /** 参数区：桌面与结果并列的一列，手机上单独一屏。 */
  const paramsSection = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Label className="grid gap-2">
          Provider ID
          <Input
            list="lab-provider"
            value={providerId}
            onChange={(event) => {
              setProvider(event.target.value)
              setModel("")
              setSession(crypto.randomUUID())
            }}
          />
        </Label>
        <datalist id="lab-provider">
          {models.data?.providers.map((item) => (
            <option key={item.id} value={item.id} />
          ))}
        </datalist>
        <Label className="grid gap-2">
          模型 ID
          <Input
            list="lab-model"
            value={modelId}
            onChange={(event) => {
              setModel(event.target.value)
              setSession(crypto.randomUUID())
            }}
          />
        </Label>
        <datalist id="lab-model">
          {selected?.provider.models.map((item) => (
            <option key={item.id} value={item.id} />
          ))}
        </datalist>
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
            思考：{THINKING_LABELS[thinking] ?? thinking} · 上限：{maxTokens}
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
        {isDesktop ? (
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
