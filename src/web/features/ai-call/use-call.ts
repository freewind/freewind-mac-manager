import {
  type AiAssistantStreamEvent,
  stopAiCallExecution,
  streamAiCallMessage,
} from "@shared/client-api"
import { useCallback, useRef, useState } from "react"
import { useSpeechOutput } from "./use-speech-output"

/**
 * 一次通话的编排：把输入的文字交给服务端，把回答念出来。
 *
 * 回答就是模型正文：它同时显示在界面上并被朗读，没有第二个输出通道。
 * 用户一开始输入就停声——他在说话，回答不该继续念。
 *
 * 状态不自己维护：念没在念由 TTS 说了算，有没有在途请求由 busy 说了算，
 * 两者拼出界面要显示的阶段。多存一份只会跟真实情况打架。
 */
export type CallPhase = "listening" | "thinking" | "speaking"

export type CallController = {
  phase: CallPhase
  /** 正在生成、还没落库的回答。 */
  liveText: string
  /** 是否已有在途请求。 */
  busy: boolean
  error: string | null
  /** 提交一句话。空文本会被忽略。 */
  send: (text: string) => void
  /** 中止在途请求，但不碰正在念的内容：用户提了新问题时用。 */
  abortStream: () => Promise<void>
  /** 立刻停声：模型用 speak 要求打断时用。 */
  cancelSpeech: () => void
  /** 解锁发声：必须在用户手势里调用，否则手机浏览器会拦掉后面所有朗读。 */
  unlockSpeech: () => void
  /** 清掉文字与错误（切换到别的通话时用）。 */
  reset: () => void
}

/**
 * speak 参数已不再使用：回答直接走正文。
 */

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
  const unlockSpeech = useCallback(() => speech.unlock(), [speech])

  /**
   * 中止在途请求。
   *
   * 没有在途请求时什么都不做：尤其不能发 stop——那个请求会晚一步到达，
   * 把紧接着开始的新执行杀掉，表现为「发出去了但没有回答」。
   * 有在途请求时要等 stop 真正完成，再发新的。
   */
  const abortStream = useCallback(async () => {
    const controller = controllerRef.current
    if (!controller) return
    interruptedRef.current = true
    controller.abort()
    controllerRef.current = null
    setBusy(false)
    if (!sessionId) return
    // 必须等它结束：否则 stop 会落在新执行上，把新回答一起停掉。
    await stopAiCallExecution(sessionId).catch(() => undefined)
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
          // thinking 增量不念：那是模型的思考过程，念出来是噪音。
          if (event.kind !== "text") return
          setLiveText((previous) => previous + event.delta)
          speech.enqueue(event.delta)
          return
        }
        if (event.type === "tool") {
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
    unlockSpeech,
    reset,
  }
}
