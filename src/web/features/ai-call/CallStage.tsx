import type { AiCallMessage } from "@shared/api-contract"
import { Button } from "@web/components/ui/button"
import { cn } from "cn"
import { LoaderCircle, Mic, PhoneOff, TriangleAlert } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { TranscriptList } from "./TranscriptList"
import { cleanTranscript, isRepeatedSegment } from "./transcript"
import { useCall } from "./use-call"
import { useSpeechInput } from "./use-speech-input"
import { useSpeechRecognition } from "./use-speech-recognition"

/**
 * 通话区：一个按钮开始、一直说到挂断，期间不用再按任何东西。
 *
 * 打断的关键在这里：本地一检测到用户开口就立刻停声并中止服务端回答，
 * 不等网络往返。等服务端说「你打断了」再停，用户已经听完半句了。
 */

const PHASE_LABELS = {
  listening: "在听你说",
  thinking: "正在想",
  speaking: "正在说",
} as const

/** 说完最后两字后等这么久，确认真的不说了就发送。 */
const QUIET_MS = 3_000

export const CallStage = (props: {
  sessionId: string
  messages: AiCallMessage[]
  onRefresh: () => void
  onBusyChange: (busy: boolean) => void
  onHangUp: () => void
}) => {
  const call = useCall({
    sessionId: props.sessionId,
    onRefresh: props.onRefresh,
  })
  const [recognizing, setRecognizing] = useState(false)
  const [live, setLive] = useState(false)
  /** 刚发出去的那句话：让用户先确认听到的是什么。 */
  const [heard, setHeard] = useState<string | null>(null)
  /** 已识别、还在等用户说完的片段：界面要能看到，不能黑箱等待。 */
  const [pendingText, setPendingText] = useState("")

  /** 已识别但还没发送的片段：用户可能还在想下一句。 */
  const pendingRef = useRef<string[]>([])
  const quietTimer = useRef<number | null>(null)
  /** 上一条已经发给服务端的文本：用来挡住同一句被发两次。 */
  const lastSentRef = useRef<string | null>(null)
  const lastSentAtRef = useRef<number | null>(null)
  /** 识别是否在处理中：结果没回来就不能把半句发出去。 */
  const recognizingRef = useRef(false)

  const { send, abortStream, cancelSpeech, unlockSpeech, reset } = call
  const recognizer = useSpeechRecognition()

  const clearTimers = useCallback(() => {
    if (quietTimer.current !== null) window.clearTimeout(quietTimer.current)
    quietTimer.current = null
  }, [])

  const flush = useCallback(() => {
    clearTimers()
    // 识别还在路上：等它回来再决定，否则会把半句先发出去。
    if (recognizingRef.current) {
      quietTimer.current = window.setTimeout(flush, 400)
      return
    }
    const segments = pendingRef.current
    pendingRef.current = []
    setPendingText("")
    // 发前再清理一次：分段拼接后可能出现新的句首口水词。
    const text = cleanTranscript(segments.join(""))
    if (!text) return
    // 同一句被切成两段、或识别重复输出时，上一条已经发过就不再发。
    // 只在半分钟内、且不是「好」「对」这类短回答时才拦：短句连说两次很正常。
    const duplicated =
      text === lastSentRef.current ||
      isRepeatedSegment(lastSentRef.current ?? "", text)
    if (
      text.length >= 4 &&
      duplicated &&
      Date.now() - (lastSentAtRef.current ?? 0) < 30_000
    ) {
      return
    }
    lastSentRef.current = text
    lastSentAtRef.current = Date.now()
    // 只中止旧请求，不停语音：要不要打断正在念的内容交给模型用 speak 决定。
    abortStream()
    setHeard(text)
    send(text)
  }, [abortStream, clearTimers, send])

  /**
   * 收下一段识别文本，但不立即发送。
   *
   * 计时不在里重置：识别要 1-2 秒，从文本到达开始算等于把停顿余量
   * 吃掉一半，用户稍作停顿就会被当成说完。计时放在 onUtterance，
   * 以「说完这句」为起点；这里只负责把片段拼起来。
   */
  const pushSegment = useCallback((segment: string) => {
    const next = cleanTranscript(segment)
    if (!next) return
    const previous = pendingRef.current.at(-1) ?? ""
    // 同一句被切成两段时去掉重复的那段。
    if (isRepeatedSegment(previous, next)) return
    pendingRef.current = [...pendingRef.current, next]
    setPendingText(pendingRef.current.join(""))
  }, [])

  /** 识别串行队列：两段音频几乎同时到达时，保证文本按说话顺序拼。 */
  const recognizeChain = useRef<Promise<unknown>>(Promise.resolve())
  const recognize = recognizer.recognize

  const input = useSpeechInput({
    // 开口不再立刻打断：咳一下、环境噪声都会被当成插话，
    // 把正在说的回答切掉却什么也没换来。等识别出内容再让位。
    onSpeechStart: () => setHeard(null),
    onUtterance: (samples) => {
      // 计时从「这句说完」开始：识别路上花的时间不占用停顿余量。
      if (quietTimer.current !== null) window.clearTimeout(quietTimer.current)
      quietTimer.current = window.setTimeout(flush, QUIET_MS)
      recognizeChain.current = recognizeChain.current
        .then(async () => {
          setRecognizing(true)
          recognizingRef.current = true
          const result = await recognize(samples)
          if (result.text) {
            pushSegment(result.text)
            return
          }
          // 没识别出内容就当没说：不提示、不打断，也不影响正在念的回答。
        })
        .catch(() => {
          // 具体原因已经由 recognizer 写进 error，这里不重复报。
        })
        .finally(() => {
          recognizingRef.current = false
          setRecognizing(false)
        })
    },
  })

  const { start, stop } = input
  const reportBusy = props.onBusyChange
  useEffect(() => {
    reportBusy(call.busy)
  }, [reportBusy, call.busy])

  const beginCall = useCallback(async () => {
    reset()
    clearTimers()
    pendingRef.current = []
    lastSentRef.current = null
    lastSentAtRef.current = null
    setPendingText("")
    // 先在手势里把发声解锁：等到模型说话时已经不在手势里了。
    unlockSpeech()
    await start()
    setLive(true)
  }, [clearTimers, reset, start, unlockSpeech])

  const hangUp = useCallback(() => {
    // 挂断时把没发出去的片段丢掉：已经挂了还发一句会很奇怪。
    clearTimers()
    pendingRef.current = []
    setPendingText("")
    stop()
    abortStream()
    cancelSpeech()
    setLive(false)
    props.onHangUp()
  }, [abortStream, cancelSpeech, clearTimers, props, stop])

  // 组件卸载时不能留着定时器：否则会在已经离开的页面上发消息。
  useEffect(() => clearTimers, [clearTimers])

  const banner = recognizer.error ?? input.error
  const busy = call.phase === "thinking" || recognizing
  const waiting = pendingText.length > 0
  const phaseLabel = recognizing
    ? "正在识别"
    : waiting
      ? "等你说完…"
      : PHASE_LABELS[call.phase]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            call.phase === "speaking"
              ? "bg-emerald-500"
              : call.phase === "thinking"
                ? "bg-amber-500"
                : "bg-muted-foreground/50"
          )}
          aria-hidden
        />
        <span className="text-sm" role="status">
          {live ? phaseLabel : "未开始"}
        </span>
        {busy ? (
          <LoaderCircle
            className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden
          />
        ) : null}
      </div>

      {banner ? (
        <div className="flex items-start gap-2 border-b px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{banner}</span>
        </div>
      ) : null}

      {pendingText ? (
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          待发送：{pendingText}
        </div>
      ) : null}

      {heard ? (
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          听到：{heard}
        </div>
      ) : null}

      {call.error ? (
        <div className="flex items-start gap-2 border-b px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{call.error}</span>
        </div>
      ) : null}

      <TranscriptList
        messages={props.messages}
        liveText={call.liveText}
        className="flex-1 px-3 py-4"
      />

      <div className="flex shrink-0 items-center justify-center gap-3 border-t px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {live ? (
          <Button
            size="lg"
            variant="destructive"
            className="h-14 gap-2 rounded-full px-6"
            onClick={hangUp}
          >
            <PhoneOff aria-hidden />
            挂断
          </Button>
        ) : (
          <Button
            size="lg"
            className="h-14 gap-2 rounded-full px-6"
            onClick={() => void beginCall()}
          >
            <Mic aria-hidden />
            开始通话
          </Button>
        )}
      </div>
    </div>
  )
}
