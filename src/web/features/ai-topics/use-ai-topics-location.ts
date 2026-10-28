import { useSyncExternalStore } from "react"

/**
 * 话题页的位置状态放在 URL 里：刷新、分享链接与浏览器返回都能回到原来的
 * 话题与线程；不放进全局 store，避免返回时状态与地址不一致。
 */
export type AiTopicsLocation = {
  topicId: string | null
  threadId: string | null
}

const read = (): AiTopicsLocation => {
  if (typeof window === "undefined") return { topicId: null, threadId: null }
  const params = new URL(window.location.href).searchParams
  return {
    topicId: params.get("topic") || null,
    threadId: params.get("thread") || null,
  }
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

const snapshot = (): string => {
  const { topicId, threadId } = read()
  return `${topicId ?? ""}|${threadId ?? ""}`
}

const navigate = (next: AiTopicsLocation): void => {
  const url = new URL(window.location.href)
  if (next.topicId) url.searchParams.set("topic", next.topicId)
  else url.searchParams.delete("topic")
  if (next.threadId) url.searchParams.set("thread", next.threadId)
  else url.searchParams.delete("thread")
  // 保留已有历史标记：App 的返回按钮靠它判断这是应用内导航。
  window.history.pushState(
    { ...window.history.state, macManagerFeature: true },
    "",
    url
  )
  window.dispatchEvent(
    new PopStateEvent("popstate", { state: window.history.state })
  )
}

export const useAiTopicsLocation = () => {
  const key = useSyncExternalStore(subscribe, snapshot, () => "|")
  const [rawTopic, rawThread] = key.split("|")
  const current: AiTopicsLocation = {
    topicId: rawTopic || null,
    threadId: rawThread || null,
  }

  return {
    ...current,
    /** 切话题时清掉线程：旧线程不属于新话题。 */
    selectTopic: (topicId: string) => navigate({ topicId, threadId: null }),
    selectThread: (threadId: string) =>
      navigate({ topicId: current.topicId, threadId }),
  }
}
