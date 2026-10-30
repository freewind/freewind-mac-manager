import type { AiCallMessage } from "@shared/api-contract"
import { transcribeAiCallAudio } from "@shared/client-api"
import { LoaderCircle, Mic, TriangleAlert } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { TranscriptList } from "./TranscriptList"
import { useCall } from "./use-call"
import { type PushToTalk, toPcm16, usePushToTalk } from "./use-push-to-talk"

/**
 * 通话区：按住说话，松手就发。
 *
 * 交互照微信语音来：手指按住开始录音，松手结束并把音频交给服务端识别，
 * 拿到的文字直接发给 Agent，回答一边显示一边朗读。再次按下时立刻停声——
 * 用户要说话了，回答不该继续念。
 */

const STATUS_LABELS = {
  listening: "按住说话",
  thinking: "正在想",
  speaking: "正在说",
} as const

/** 太短的录音多半是误触：低于这个时长不送服务端，省一次请求。 */
const MIN_SECONDS = 0.25

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
  /** 识别中不允许再按：连按会连着发两次，后一次会把前一次的中止掉。 */
  const recognizingRef = useRef<boolean | null>(null)

  const { send, abortStream, cancelSpeech, unlockSpeech } = call
  const { press, release } = talk

  /** 松手：识别这段音频，拿到文字就发出去。 */
  const finish = useCallback(async () => {
    const samples = await release()
    if (!samples) return
    if (samples.length / 16_000 < MIN_SECONDS) return
    setRecognizing(true)
    recognizingRef.current = true
    setNotice(null)
    try {
      const text = await transcribeAiCallAudio(toPcm16(samples))
      if (!text.trim()) {
        setNotice("没听清，再说一次")
        return
      }
      // 等旧执行真正停下再发：否则 stop 会把刚要开始的回答一起杀掉。
      await abortStream()
      send(text)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "识别失败，请再说一次")
    } finally {
      recognizingRef.current = false
      setRecognizing(false)
    }
  }, [abortStream, release, send])

  const phase = recognizing ? "thinking" : call.phase
  const statusLabel = recognizing ? "正在识别" : STATUS_LABELS[call.phase]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span
          className={
            call.phase === "speaking"
              ? "size-2 shrink-0 rounded-full bg-emerald-500"
              : phase === "thinking"
                ? "size-2 shrink-0 rounded-full bg-amber-500"
                : "size-2 shrink-0 rounded-full bg-muted-foreground/50"
          }
          aria-hidden
        />
        <span className="text-sm" role="status">
          {statusLabel}
        </span>
        {phase === "thinking" ? (
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

      <div className="flex shrink-0 flex-col items-center gap-2 border-t px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          aria-label="按住说话"
          aria-pressed={talk.holding}
          className={`flex size-20 touch-none select-none items-center justify-center rounded-full transition-transform ${
            talk.holding
              ? "scale-95 bg-destructive text-destructive-foreground"
              : "bg-primary text-primary-foreground"
          }`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            if (recognizingRef.current === true) return
            // 要在手势里做：解锁朗读、停掉正在念的回答。
            unlockSpeech()
            cancelSpeech()
            setNotice(null)
            void press()
          }}
          onPointerUp={() => void finish()}
          onPointerCancel={() => {
            void release()
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <Mic className="size-7" aria-hidden />
        </button>
        <span className="text-xs text-muted-foreground">
          {talk.holding ? "松手发送" : "按住说话"}
        </span>
      </div>
    </div>
  )
}
