import {
  createAiCallSession,
  fetchAiCallSession,
  finishAiCallSession,
  listAiCallSessions,
} from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

/** 执行期间的重新读取间隔：回答由服务端执行，本地只是订阅者。 */
export const CALL_REFRESH_INTERVAL_MS = 2000

/** 通话域的查询键：列表与详情。 */
export const aiCallKeys = {
  all: ["ai-call"] as const,
  list: () => [...aiCallKeys.all, "list"] as const,
  detail: (sessionId: string) =>
    [...aiCallKeys.all, "detail", sessionId] as const,
}

export const useAiCallSessionsQuery = () =>
  useQuery({
    queryKey: aiCallKeys.list(),
    queryFn: listAiCallSessions,
    retry: false,
  })

/**
 * 通话详情（会话 + 消息）。
 *
 * 执行期间轮询：本地正在提问时轮询，服务端报 running 时也继续轮询。
 * 后者覆盖断线——浏览器断开后服务端执行仍在继续，重新连上还能看到结果。
 */
export const useAiCallSessionQuery = (sessionId: string | null, busy = false) =>
  useQuery({
    queryKey: aiCallKeys.detail(sessionId ?? ""),
    queryFn: () => fetchAiCallSession(sessionId as string),
    enabled: Boolean(sessionId),
    retry: false,
    refetchInterval: (query) => {
      if (busy) return CALL_REFRESH_INTERVAL_MS
      return query.state.data?.session.status === "running"
        ? CALL_REFRESH_INTERVAL_MS
        : false
    },
  })

const useInvalidateCall = () => {
  const queryClient = useQueryClient()
  return {
    list: () => queryClient.invalidateQueries({ queryKey: aiCallKeys.list() }),
    detail: (sessionId: string) =>
      queryClient.invalidateQueries({
        queryKey: aiCallKeys.detail(sessionId),
      }),
  }
}

export const useCreateAiCallSession = () => {
  const invalidate = useInvalidateCall()
  return useMutation({
    mutationFn: (title?: string) => createAiCallSession(title),
    onSuccess: (detail) => {
      void invalidate.list()
      void invalidate.detail(detail.session.id)
    },
  })
}

export const useFinishAiCallSession = () => {
  const invalidate = useInvalidateCall()
  return useMutation({
    mutationFn: (sessionId: string) => finishAiCallSession(sessionId),
    onSuccess: (detail) => {
      void invalidate.list()
      void invalidate.detail(detail.session.id)
    },
  })
}
