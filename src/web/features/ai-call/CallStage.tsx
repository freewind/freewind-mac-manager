import type { AiCallMessage } from "@shared/api-contract"
import { transcribeAiCallAudio } from "@shared/client-api"
import { LoaderCircle, Mic, TriangleAlert } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { TranscriptList } from "./TranscriptList"
import { useCall } from "./use-call"
import { type PushToTalk, toPcm16, usePushToTalk } from "./use-push-to-talk"

/**
 * 通话区：按住底部整块区域说话，松手就发。
 *
 * 连续说话不阻塞：每松手一次就排进队列，识别一段接一段地跑，
 * 等队列空了再把这次的所有文字合成一句发给 Agent。
 * 这样「说一句、停一下、再补一句」不会被拆成两次提问。
 */

const STATUS_LABELS = {
  listening: "按住说话",
  thinking: "正在想",
  speaking: "正在说",
} as const

/** 太短的录音多半是误触：低于这个时长不送服务端（这段不含前后补偿）。 */
const MIN_SECONDS = 0.5
/** 向上滑出这个距离就算撤销：与微信语音的手感一致。 */
const CANCEL_DISTANCE = 60
/** 队列空了以后再等这么久才发送：给紧接着的下一句留合并机会。 */
const MERGE_WINDOW_MS = 800

export const CallStage = (props: {
  sessionId: string
  messages: AiCallMessage[]
  onRefresh: () => void
}) => {
  const call = useCall({
    sessionId: props.sessionId,
    onRefresh: props.onRefresh,
  })
  const talk: PushToTalk = usePushToTalk()
  const [recognizing, setRecognizing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** 手指是否已滑出取消区：松手时这段录音直接丢掉。 */
  const [canceling, setCanceling] = useState(false)
  const cancelingRef = useRef<boolean | null>(null)
  const startYRef = useRef<number | null>(null)

  const { send, abortStream, cancelSpeech, unlockSpeech } = call
  const { press, release } = talk

  /** 待识别的录音片段：处理一段时后面的排着。 */
  const queueRef = useRef<Float32Array[] | null>(null)
  /** 本次提问已经识别出来的文字，攒齐后一次发出去。 */
  const partsRef = useRef<string[] | null>(null)
  const drainingRef = useRef<boolean | null>(null)
  const mergeTimerRef = useRef<number | null>(null)

  const flushToAgent = useCallback(async () => {
    const parts = partsRef.current ?? []
    partsRef.current = []
    const text = parts.join("")
    if (!text.trim()) return
    // 等旧执行真正停下再发，否则停止请求会把新回答一起杀掉。
    await abortStream()
    send(text)
  }, [abortStream, send])

  /** 串行识别队列里剩下的片段；队列空后留一个合并窗口再发送。 */
  const drain = useCallback(async () => {
    if (drainingRef.current === true) return
    drainingRef.current = true
    try {
      for (;;) {
        const samples = queueRef.current?.shift()
        if (!samples) break
        setRecognizing(true)
        try {
          const text = await transcribeAiCallAudio(toPcm16(samples))
          if (text.trim()) {
            if (partsRef.current === null) partsRef.current = []
            partsRef.current.push(text.trim())
            setNotice(null)
          } else {
            setNotice("没听清，再说一次")
          }
        } catch (cause) {
          setNotice(
            cause instanceof Error ? cause.message : "识别失败，请再说一次"
          )
        } finally {
          setRecognizing(false)
        }
      }
    } finally {
      drainingRef.current = false
    }
    if (mergeTimerRef.current !== null)
      window.clearTimeout(mergeTimerRef.current)
    mergeTimerRef.current = window.setTimeout(() => {
      mergeTimerRef.current = null
      void flushToAgent()
    }, MERGE_WINDOW_MS)
  }, [flushToAgent])

  const finish = useCallback(async () => {
    const samples = await release()
    if (!samples) return
    if (samples.length / 16_000 < MIN_SECONDS) return
    if (queueRef.current === null) queueRef.current = []
    queueRef.current.push(samples)
    // 正在说话就先排队：识别在上一条上花时间，也不能让这次的话丢掉。
    if (mergeTimerRef.current !== null) {
      window.clearTimeout(mergeTimerRef.current)
      mergeTimerRef.current = null
    }
    void drain()
  }, [drain, release])

  const statusLabel = recognizing ? "正在识别" : STATUS_LABELS[call.phase]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span
          className={
            call.phase === "speaking"
              ? "size-2 shrink-0 rounded-full bg-emerald-500"
              : call.phase === "thinking" || recognizing
                ? "size-2 shrink-0 rounded-full bg-amber-500"
                : "size-2 shrink-0 rounded-full bg-muted-foreground/50"
          }
          aria-hidden
        />
        <span className="text-sm" role="status">
          {statusLabel}
        </span>
        {call.phase === "thinking" || recognizing ? (
          <LoaderCircle
            className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden
          />
        ) : null}
      </div>

      {(talk.error ?? notice ?? call.error) ? (
        <div className="flex items-start gap-2 border-b px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{talk.error ?? notice ?? call.error}</span>
        </div>
      ) : null}

      <TranscriptList
        messages={props.messages}
        liveText={call.liveText}
        className="flex-1 px-3 py-4"
      />

      {/* 整条底部都是按住区：手指落哪儿都能说，不必对准那个圆。 */}
      <button
        type="button"
        aria-label="按住说话"
        aria-pressed={talk.holding}
        className="flex shrink-0 touch-none select-none flex-col items-center gap-2 border-t px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          startYRef.current = event.clientY
          cancelingRef.current = false
          setCanceling(false)
          // 要在手势里做：解锁朗读、停掉正在念的回答。
          unlockSpeech()
          cancelSpeech()
          setNotice(null)
          void press()
        }}
        onPointerMove={(event) => {
          if (startYRef.current === null) return
          const upward = startYRef.current - event.clientY
          const next = upward > CANCEL_DISTANCE
          if (next === cancelingRef.current) return
          cancelingRef.current = next
          setCanceling(next)
        }}
        onPointerUp={() => {
          const cancelled = cancelingRef.current === true
          startYRef.current = null
          cancelingRef.current = false
          setCanceling(false)
          if (cancelled) {
            // 撤销：这段录音直接丢掉，既不识别也不发送。
            void release()
            return
          }
          void finish()
        }}
        onPointerCancel={() => {
          startYRef.current = null
          cancelingRef.current = false
          setCanceling(false)
          void release()
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span
          className={`flex size-20 items-center justify-center rounded-full transition-transform ${
            canceling
              ? "scale-95 bg-muted text-muted-foreground"
              : talk.holding
                ? "scale-95 bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground"
          }`}
        >
          <Mic className="size-7" aria-hidden />
        </span>
        <span className="text-xs text-muted-foreground">
          {canceling ? "松开取消" : talk.holding ? "松手发送" : "按住说话"}
        </span>
      </button>
    </div>
  )
}
