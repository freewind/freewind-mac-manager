import type { AiCallMessage } from "@shared/api-contract"
import { Button } from "@web/components/ui/button"
import { cn } from "cn"
import { LoaderCircle, Mic, PhoneOff, TriangleAlert } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { TranscriptList } from "./TranscriptList"
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

  const { send, interrupt, reset } = call
  const recognizer = useSpeechRecognition()

  const input = useSpeechInput({
    // 用户开口就打断：不管 AI 是在念还是在想，都该让位给他。
    onSpeechStart: () => {
      interrupt()
    },
    onUtterance: (samples) => {
      setRecognizing(true)
      void recognizer
        .recognize(samples)
        .then((text) => {
          if (text) send(text)
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
    await start()
    setLive(true)
  }, [reset, start])

  const hangUp = useCallback(() => {
    stop()
    interrupt()
    setLive(false)
    props.onHangUp()
  }, [interrupt, props, stop])

  const banner = recognizer.error ?? input.error
  const busy = call.phase === "thinking" || recognizing
  const phaseLabel = recognizer.warming
    ? `首次加载语音模型 ${Math.round(recognizer.progress * 100)}%`
    : recognizing
      ? "正在识别"
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
