import {
  type AiAssistantStreamEvent,
  stopAiCallExecution,
  streamAiCallMessage,
} from "@shared/client-api"
import { useCallback, useRef, useState } from "react"
import { useSpeechOutput } from "./use-speech-output"

/**
 * 一次通话的编排：把「听到的话」交给服务端，把「回答」按句念出来，
 * 并且随时能被打断。
 *
 * 状态不自己维护：念没在念由 TTS 说了算，有没有在途请求由 busy 说了算，
 * 两者拼出界面要显示的阶段。多存一份只会跟真实情况打架。
 */
export type CallPhase = "listening" | "thinking" | "speaking"

export type CallController = {
  phase: CallPhase
  /** 正在生成的回答：边听边看的那份文字。 */
  liveText: string
  /** 是否已有在途请求。 */
  busy: boolean
  error: string | null
  /** 提交一句话。空文本会被忽略。 */
  send: (text: string) => void
  /** 打断：立刻停声并中止服务端回答。 */
  interrupt: () => void
  /** 清掉文字与错误（切换到别的通话时用）。 */
  reset: () => void
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
  /** 本次请求是否由打断结束：打断不是故障，不能报成错误。 */
  const interruptedRef = useRef<boolean | null>(null)

  const speech = useSpeechOutput({
    onSettled: () => {
      // 队列念完才刷新：最后一句的内容这时才真正落库。
      refreshRef.current()
    },
  })

  const interrupt = useCallback(() => {
    interruptedRef.current = true
    speech.cancel()
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
    if (sessionId) {
      // 必须通知服务端停：不停的话执行会自己跑完，下一次提问会被 409 挡住。
      void stopAiCallExecution(sessionId).catch(() => {
        // 已经结束（409）或网络失败都不影响本地停声，不必打扰用户。
      })
    }
  }, [sessionId, speech])

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
          if (interruptedRef.current) return
          setError(cause instanceof Error ? cause.message : "请求失败，请重试")
        } finally {
          controllerRef.current = null
          setBusy(false)
          refreshRef.current()
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

  return { phase, liveText, busy, error, send, interrupt, reset }
}
