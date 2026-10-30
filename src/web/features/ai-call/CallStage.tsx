import type { AiCallMessage } from "@shared/api-contract"
import { Bot, LoaderCircle, TriangleAlert } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { TranscriptList } from "./TranscriptList"
import { useCall } from "./use-call"

/**
 * 通话区：一个输入框，说完就发。
 *
 * 文字不再由网页录音识别，而是用户用手机自带的语音输入法打进输入框：
 * 输入法组合期间（下划线）不发送，松手落定（compositionend）立刻发送。
 * 用户一开始输入就停掉正在念的回答——他在说话，就不该继续念。
 */

const STATUS_LABELS = {
  listening: "随时可以输入",
  thinking: "正在想",
  speaking: "正在说",
} as const

export const CallStage = (props: {
  sessionId: string
  messages: AiCallMessage[]
  onRefresh: () => void
}) => {
  const call = useCall({
    sessionId: props.sessionId,
    onRefresh: props.onRefresh,
  })
  const [text, setText] = useState("")
  /** 输入法是否在组合中：这期间有下划线，不能发。 */
  const composingRef = useRef<boolean | null>(null)

  const { send, abortStream, cancelSpeech, unlockSpeech } = call

  const submit = useCallback(
    (value: string) => {
      const prompt = value.trim()
      if (!prompt) return
      setText("")
      // 发新问题前让旧执行收尾；正在念的声音由模型用 speak 决定是否打断。
      abortStream()
      // 在用户手势里解锁发声，等模型说话时已经离开手势栈了。
      unlockSpeech()
      send(prompt)
    },
    [abortStream, send, unlockSpeech]
  )

  const statusLabel =
    call.phase === "speaking" ? "正在说" : STATUS_LABELS[call.phase]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span
          className={
            call.phase === "speaking"
              ? "size-2 shrink-0 rounded-full bg-emerald-500"
              : call.phase === "thinking"
                ? "size-2 shrink-0 rounded-full bg-amber-500"
                : "size-2 shrink-0 rounded-full bg-muted-foreground/50"
          }
          aria-hidden
        />
        <span className="text-sm" role="status">
          {statusLabel}
        </span>
        {call.phase === "thinking" ? (
          <LoaderCircle
            className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden
          />
        ) : null}
      </div>

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

      <div className="flex shrink-0 items-end gap-2 border-t px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <textarea
          value={text}
          rows={1}
          placeholder="用语音输入法说，松手就发"
          aria-label="输入要说的话"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onChange={(event) => {
            // 用户一动笔就停声：他要说话了，回答不该继续念。
            cancelSpeech()
            setText(event.target.value)
          }}
          onCompositionStart={() => {
            composingRef.current = true
            cancelSpeech()
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false
            const value = event.currentTarget.value
            setText(value)
            // 语音输入法松手落定就是一句完整的话，直接发。
            submit(value)
          }}
          onKeyDown={(event) => {
            cancelSpeech()
            if (event.key !== "Enter" || event.shiftKey) return
            // 输入法组合中的回车是选词，不是发送。
            if (composingRef.current === true) return
            event.preventDefault()
            submit(event.currentTarget.value)
          }}
        />
        <button
          type="button"
          onClick={() => submit(text)}
          disabled={text.trim() === ""}
          aria-label="发送"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          <Bot aria-hidden />
        </button>
      </div>
    </div>
  )
}
