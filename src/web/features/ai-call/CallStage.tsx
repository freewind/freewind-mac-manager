import type { AiCallMessage } from "@shared/api-contract"
import { Button } from "@web/components/ui/button"
import { cn } from "cn"
import { LoaderCircle, Mic, PhoneOff, TriangleAlert } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { TranscriptList } from "./TranscriptList"
import { cleanTranscript, isRepeatedSegment } from "./transcript"
import { useCall } from "./use-call"
import { useSpeechInput } from "./use-speech-input"
import {
  type RecognitionResult,
  useSpeechRecognition,
} from "./use-speech-recognition"

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

/** 说完最后一句后等这么久，确认真的不说了再发送。 */
const QUIET_MS = 3_000
/** 连续说话时的总上限：再久也不能一直不发。 */
const MAX_WAIT_MS = 10_000

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
  /** 上一段音频没识别出内容：把音频情况告诉用户，而不是静默丢掉。 */
  const [unheard, setUnheard] = useState<RecognitionResult | null>(null)
  /** 刚发出去的那句话：让用户先确认听到的是什么。 */
  const [heard, setHeard] = useState<string | null>(null)
  /** 已识别、还在等用户说完的片段：界面要能看到，不能黑箱等待。 */
  const [pendingText, setPendingText] = useState("")

  /** 已识别但还没发送的片段：用户可能还在想下一句。 */
  const pendingRef = useRef<string[]>([])
  const quietTimer = useRef<number | null>(null)
  const capTimer = useRef<number | null>(null)

  const { send, interrupt, reset } = call
  const recognizer = useSpeechRecognition()

  const clearTimers = useCallback(() => {
    if (quietTimer.current !== null) window.clearTimeout(quietTimer.current)
    if (capTimer.current !== null) window.clearTimeout(capTimer.current)
    quietTimer.current = null
    capTimer.current = null
  }, [])

  const flush = useCallback(() => {
    clearTimers()
    const segments = pendingRef.current
    pendingRef.current = []
    setPendingText("")
    // 发前再清理一次：分段拼接后可能出现新的句首口水词。
    const text = cleanTranscript(segments.join(""))
    if (!text) return
    setHeard(text)
    send(text)
  }, [clearTimers, send])

  /**
   * 收下一段识别文本，但不立即发送。
   *
   * 说话中途停顿、换气都会被切成多段；每段都回复会打断节奏。
   * 这里改成：每多一段就重新计 3 秒，连续说话时最多等 10 秒。
   */
  const pushSegment = useCallback(
    (segment: string) => {
      const next = cleanTranscript(segment)
      if (!next) return
      const previous = pendingRef.current.at(-1) ?? ""
      // 同一句被切成两段时去掉重复的那段。
      if (isRepeatedSegment(previous, next)) return
      pendingRef.current = [...pendingRef.current, next]
      setPendingText(pendingRef.current.join(""))
      if (quietTimer.current !== null) window.clearTimeout(quietTimer.current)
      quietTimer.current = window.setTimeout(flush, QUIET_MS)
      if (capTimer.current === null) {
        capTimer.current = window.setTimeout(flush, MAX_WAIT_MS)
      }
    },
    [flush]
  )

  /** 识别串行队列：两段音频几乎同时到达时，保证文本按说话顺序拼。 */
  const recognizeChain = useRef<Promise<unknown>>(Promise.resolve())
  const recognize = recognizer.recognize

  const input = useSpeechInput({
    // 用户开口就打断：不管 AI 是在念还是在想，都该让位给他。
    onSpeechStart: () => {
      interrupt()
      setHeard(null)
    },
    onUtterance: (samples) => {
      recognizeChain.current = recognizeChain.current
        .then(async () => {
          setRecognizing(true)
          const result = await recognize(samples)
          if (result.text) {
            setUnheard(null)
            pushSegment(result.text)
            return
          }
          setHeard(null)
          setUnheard(result)
        })
        .catch(() => {
          // 具体原因已经由 recognizer 写进 error，这里不重复报。
        })
        .finally(() => setRecognizing(false))
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
    setPendingText("")
    await start()
    setLive(true)
  }, [clearTimers, reset, start])

  const hangUp = useCallback(() => {
    // 挂断时把没发出去的片段丢掉：已经挂了还发一句会很奇怪。
    clearTimers()
    pendingRef.current = []
    setPendingText("")
    stop()
    interrupt()
    setLive(false)
    props.onHangUp()
  }, [clearTimers, interrupt, props, stop])

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

      {unheard ? (
        <div className="flex items-start gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {unheard.peak < 0.02
              ? `麦克风几乎没收到声音（峰值 ${unheard.peak.toFixed(3)}），请靠近麦克风再说一次。`
              : `没听清，请再说一次（音频 ${unheard.seconds.toFixed(1)} 秒）。`}
          </span>
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
