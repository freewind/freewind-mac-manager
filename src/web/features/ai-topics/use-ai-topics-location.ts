import { useNavigate, useSearch } from "@tanstack/react-router"

/**
 * 话题页的位置状态放在 URL 里：刷新、分享链接与浏览器返回都能回到原来的
 * 话题与线程；不放进全局 store，避免返回时状态与地址不一致。
 */
export type AiTopicsLocation = {
  topicId: string | null
  threadId: string | null
}

export const useAiTopicsLocation = (): AiTopicsLocation & {
  selectTopic: (topicId: string) => void
  selectThread: (threadId: string) => void
} => {
  const search = useSearch({ strict: false }) as Record<
    string,
    string | undefined
  >
  const navigate = useNavigate()
  const current: AiTopicsLocation = {
    // 与原实现一致：空串也按未选中处理，避免手工构造的空参数进入查询。
    topicId: search.topic || null,
    threadId: search.thread || null,
  }

  return {
    ...current,
    /** 切话题时清掉线程：旧线程不属于新话题。 */
    selectTopic: (topicId: string): void => {
      void navigate({
        to: ".",
        search: (prev: Record<string, string | undefined>) => ({
          ...prev,
          topic: topicId,
          thread: undefined,
        }),
      })
    },
    selectThread: (threadId: string): void => {
      void navigate({
        to: ".",
        search: (prev: Record<string, string | undefined>) => ({
          ...prev,
          thread: threadId,
        }),
      })
    },
  }
}
