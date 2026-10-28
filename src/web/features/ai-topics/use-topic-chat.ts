import {
  ApiRequestError,
  stopAiTopicExecution,
  streamAiTopicMessage,
} from "@shared/client-api"
import { useCallback, useRef, useState } from "react"

/** 线程工具的执行提示：让用户知道 Agent 现在在做什么，而不是空等。 */
const TOOL_LABELS: Record<string, string> = {
  create_thread: "正在新建线程",
  reply_thread: "正在写入线程",
  rename_thread: "正在重命名线程",
  archive_thread: "正在归档线程",
  list_threads: "正在查看线程",
}

/** 执行期间的重新读取间隔：回答可能写进别的线程，只刷新当前线程会看不到。 */
export const TOPIC_REFRESH_INTERVAL_MS = 2500

export type TopicChatState = {
  running: boolean
  /** 当前步骤（工具执行或回答中），没有则为 null。 */
  activity: string | null
  error: Error | null
  errorStatus: number | null
}

/**
 * 话题对话的发送与执行状态。
 *
 * 不在本地拼聊天消息：用户消息与回答都由服务端落库，界面只负责在合适的
 * 时机重新读取。这样刷新、切换线程与断线重连看到的内容始终一致，也不会
 * 因为流式文本与落库消息同时存在而重复展示。
 */
export const useTopicChat = (options: {
  topicId: string | null
  threadId: string | null
  /** 重新读取话题与消息；执行中会周期性调用。 */
  onRefresh: () => void
}) => {
  const { topicId, threadId, onRefresh } = options
  const [state, setState] = useState<TopicChatState>({
    running: false,
    activity: null,
    error: null,
    errorStatus: null,
  })
  const controllerRef = useRef<AbortController | null>(null)
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim()
      // 一次只跑一个：话题只有一个 Agent，并发只会让回答互相覆盖。
      if (!prompt || !topicId || !threadId || controllerRef.current) return
      const controller = new AbortController()
      controllerRef.current = controller
      setState({
        running: true,
        activity: "正在提交",
        error: null,
        errorStatus: null,
      })
      let sawDone = false
      try {
        await streamAiTopicMessage({
          topicId,
          threadId,
          prompt,
          signal: controller.signal,
          onExecutionId: () => {
            // 服务端在开始执行前已落库用户消息，此时重新读取不会读到旧数据。
            refreshRef.current()
          },
          onEvent: (event) => {
            if (event.type === "tool") {
              if (event.status === "running") {
                setState((prev) => ({
                  ...prev,
                  activity: TOOL_LABELS[event.name] ?? "正在执行",
                }))
              } else {
                // 工具结束往往意味着回答已经写进某个线程。
                setState((prev) => ({ ...prev, activity: "正在回答" }))
                refreshRef.current()
              }
              return
            }
            if (event.type === "delta") {
              setState((prev) =>
                prev.activity ? prev : { ...prev, activity: "正在回答" }
              )
              return
            }
            if (event.type === "error") {
              setState((prev) => ({ ...prev, error: new Error(event.message) }))
              return
            }
            if (event.type === "done") {
              sawDone = true
              refreshRef.current()
            }
          },
        })
        if (!sawDone) {
          setState((prev) => ({
            ...prev,
            error: new Error("连接中断，结果未知，请重新读取核实"),
          }))
          refreshRef.current()
        }
      } catch (error) {
        const aborted =
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        setState((prev) => ({
          ...prev,
          error: new Error(
            aborted
              ? "已中止，结果未知，请重新读取核实"
              : error instanceof Error && error.message
                ? error.message
                : "网络请求失败，结果未知，请重新读取核实"
          ),
          errorStatus:
            error instanceof ApiRequestError ? error.status : prev.errorStatus,
        }))
        refreshRef.current()
      } finally {
        controllerRef.current = null
        setState((prev) => ({ ...prev, running: false, activity: null }))
      }
    },
    [topicId, threadId]
  )

  /** 断线只解除订阅，停止必须显式告诉服务端；停止后重新读取真实状态。 */
  const stop = useCallback(() => {
    if (!topicId) return
    controllerRef.current?.abort()
    void stopAiTopicExecution(topicId)
      .catch(() => {
        // 停止请求失败不改变本地已中止的事实，结果以重新读取为准。
      })
      .finally(() => refreshRef.current())
  }, [topicId])

  return { ...state, send, stop }
}
