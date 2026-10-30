import {
  type AiAssistantStreamEvent,
  stopAiCallExecution,
  streamAiCallMessage,
} from "@shared/client-api"
import { useCallback, useRef, useState } from "react"
import { useSpeechOutput } from "./use-speech-output"

/**
 * 一次通话的编排：把「听到的话」交给服务端，把模型用 speak 说出的内容念出来。
 *
 * 模型的正文既不显示也不朗读：只有 speak 工具的内容才算「说出口的话」。
 * 要不要出声、要不要打断正在念的内容都由模型判断，前端不拿音量或静默时长
 * 去猜——猜错的代价是把用户正在听的话截断。
 *
 * 状态不自己维护：念没在念由 TTS 说了算，有没有在途请求由 busy 说了算，
 * 两者拼出界面要显示的阶段。多存一份只会跟真实情况打架。
 */
export type CallPhase = "listening" | "thinking" | "speaking"

export type CallController = {
  phase: CallPhase
  /** 模型已经说出口的内容：与语音一致，正文不进来。 */
  liveText: string
  /** 是否已有在途请求。 */
  busy: boolean
  error: string | null
  /** 提交一句话。空文本会被忽略。 */
  send: (text: string) => void
  /** 中止在途请求，但不碰正在念的内容：用户提了新问题时用。 */
  abortStream: () => void
  /** 立刻停声：模型用 speak 要求打断时用。 */
  cancelSpeech: () => void
  /** 清掉文字与错误（切换到别的通话时用）。 */
  reset: () => void
}

/** 通话里的语音输出工具名。 */
const SPEAK_TOOL = "speak"

/** speak 的参数：text 必填，interrupt 表示要不要打断正在念的内容。 */
const parseSpeak = (
  input: unknown
): { text: string; interrupt: boolean } | null => {
  if (typeof input !== "object" || input === null) return null
  const record = input as { text?: unknown; interrupt?: unknown }
  if (typeof record.text !== "string") return null
  const text = record.text.trim()
  if (!text) return null
  return { text, interrupt: record.interrupt === true }
}

export const useCall = (options: {
  sessionId: string | null
  /** 重新读取会话与消息；执行开始、工具结束、结束时都会调用。 */
  onRefresh: () => void
}): CallController => {
  const { sessionId } = options
  const refreshRef = useRef(options.onRefresh)
  refreshRef.current = options.onRefresh

  const [liveText, setLiveText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  /** 本次请求是否由中断结束：中断不是故障，不能报成错误。 */
  const interruptedRef = useRef<boolean | null>(null)

  const speech = useSpeechOutput({
    onSettled: () => {
      // 队列念完才刷新：最后一句的内容这时才真正落库。
      refreshRef.current()
    },
  })

  const cancelSpeech = useCallback(() => speech.cancel(), [speech])

  /**
   * 中止在途请求。
   *
   * 只停请求、不停语音：服务端同一会话只允许一次执行，新问题必须先让旧的
   * 收尾；但已经念到一半的话要不要打断，交给模型用 speak 决定。
   */
  const abortStream = useCallback(() => {
    interruptedRef.current = true
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
    if (sessionId) {
      // 必须通知服务端停：不停的话执行会自己跑完，下一次提问会被 409 挡住。
      void stopAiCallExecution(sessionId).catch(() => {
        // 已经结束（409）或网络失败都不影响本地，无须打扰用户。
      })
    }
  }, [sessionId])

  const send = useCallback(
    (text: string) => {
      const prompt = text.trim()
      if (!prompt || !sessionId || controllerRef.current) return
      const controller = new AbortController()
      controllerRef.current = controller
      interruptedRef.current = false
      setLiveText("")
      setError(null)
      setBusy(true)
      refreshRef.current()

      const handle = (event: AiAssistantStreamEvent): void => {
        if (event.type === "delta") {
          // 正文不显示也不念：模型的话只能通过 speak 说出来。
          return
        }
        if (event.type === "tool") {
          if (event.name === SPEAK_TOOL && event.status === "running") {
            const spoken = parseSpeak(event.input)
            if (spoken) {
              if (spoken.interrupt) speech.cancel()
              setLiveText((previous) =>
                spoken.interrupt || !previous
                  ? spoken.text
                  : `${previous}\n${spoken.text}`
              )
              // speak 交出来的是完整句子，直接念，不等断句。
              speech.enqueue(spoken.text)
              speech.flush()
            }
          }
          if (event.status !== "running") refreshRef.current()
          return
        }
        if (event.type === "error") {
          setError(event.message)
          return
        }
        if (event.type === "done") {
          // 剩下的半句也要念完，否则最后一句会消失。
          speech.flush()
          refreshRef.current()
        }
      }

      void (async () => {
        let sawDone = false
        try {
          await streamAiCallMessage({
            sessionId,
            prompt,
            signal: controller.signal,
            onExecutionId: () => {
              // 用户消息此时已落库，重新读取能立刻看到自己说的话。
              refreshRef.current()
            },
            onEvent: (event) => {
              if (event.type === "done") sawDone = true
              handle(event)
            },
          })
          if (!sawDone && !interruptedRef.current) {
            setError("连接中断，结果未知，请重新点开这次通话核实")
          }
        } catch (cause) {
          // 已经被新请求取代：既不是错误，也不能改动新的状态。
          if (controllerRef.current !== controller) return
          if (interruptedRef.current) return
          setError(cause instanceof Error ? cause.message : "请求失败，请重试")
        } finally {
          // 只有自己还是当前请求时才收尾：旧请求晚一步结束，
          // 不能把新请求的 controller 和 busy 一起清掉。
          if (controllerRef.current === controller) {
            controllerRef.current = null
            setBusy(false)
            refreshRef.current()
          }
        }
      })()
    },
    [sessionId, speech]
  )

  const reset = useCallback(() => {
    speech.cancel()
    setLiveText("")
    setError(null)
  }, [speech])

  const phase: CallPhase = speech.speaking
    ? "speaking"
    : busy
      ? "thinking"
      : "listening"

  return {
    phase,
    liveText,
    busy,
    error,
    send,
    abortStream,
    cancelSpeech,
    reset,
  }
}
