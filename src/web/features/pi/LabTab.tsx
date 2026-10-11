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
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import { Textarea } from "@web/components/ui/textarea"
import { useState } from "react"
import { toast } from "sonner"
import { usePiModels } from "./queries"

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
    queryFn: () => fetchPiLab(id ?? ""),
    enabled: id !== null,
    retry: false,
    refetchInterval: (query) =>
      !query.state.data || query.state.data.status === "running" ? 500 : false,
  })
  const busy = id !== null && (!run.data || run.data.status === "running")
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
    mutationFn: () => cancelPiLab(id ?? ""),
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
  return (
    <section className="grid min-w-0 gap-4 p-4">
      <h2 className="font-medium">
        {mode === "chat" ? "Playground" : "有界能力探测"}
      </h2>
      <p className="text-sm text-muted-foreground">
        发送会产生真实 API 请求及费用；不加载工具、扩展或电脑文件。内容仅保留 24
        小时。
      </p>
      {mode === "probe" ? (
        <p className="text-sm">
          最多 4 次请求、总输出预算 4096 tokens、总时限 60
          秒。仅报告实际参数和接受性，不证明理论上限或思考效果。
        </p>
      ) : null}
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
        <Label className="grid gap-2">
          Thinking 档位
          <Input
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
            type="number"
            min={16}
            max={4096}
            value={maxTokens}
            onChange={(event) => setMaxTokens(Number(event.target.value))}
          />
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
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-12"
          disabled={busy || send.isPending}
          onClick={() => send.mutate()}
        >
          {mode === "chat" ? "发送消息" : "发起有界探测"}
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          disabled={!busy || cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          中止当前请求
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          disabled={busy || clear.isPending}
          onClick={() => clear.mutate()}
        >
          清空此会话
        </Button>
      </div>
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
              className="min-h-11 justify-start overflow-hidden"
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
    </section>
  )
}
