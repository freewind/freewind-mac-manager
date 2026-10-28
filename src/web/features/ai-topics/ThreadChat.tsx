import type { AiTopicMessage, AiTopicThread } from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"
import { AgentChat } from "@web/components/agent-elements/agent-chat"
import {
  InputBar,
  type InputBarProps,
} from "@web/components/agent-elements/input-bar"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Skeleton } from "@web/components/ui/skeleton"
import type { ChatStatus, UIMessage } from "ai"
import { cn } from "cn"
import { Archive, LoaderCircle } from "lucide-react"
import { useEffect } from "react"
import { useMarkAiTopicThreadRead } from "./queries"
import { useTopicChat } from "./use-topic-chat"

/**
 * 输入框插槽必须是模块级组件：每次渲染换新身份会让输入框重挂载、丢草稿。
 * 只改公开的 placeholder，不动官方组件实现。
 */
const ThreadInputBar = (slotProps: Record<string, unknown>) => (
  <InputBar {...(slotProps as InputBarProps)} placeholder="在这个线程里提问" />
)

const toUiMessages = (messages: AiTopicMessage[]): UIMessage[] =>
  messages.map(
    (message) =>
      ({
        id: message.id,
        role: message.role === "agent" ? "assistant" : "user",
        parts: [{ type: "text", text: message.body }],
      }) as unknown as UIMessage
  )

const toChatStatus = (running: boolean, error: Error | null): ChatStatus => {
  if (running) return "streaming"
  if (error) return "error"
  return "ready"
}

type ThreadChatProps = {
  topicId: string
  thread: AiTopicThread | null
  messages: AiTopicMessage[]
  pending: boolean
  /** 重新读取话题与消息：执行期间由聊天 hook 周期调用。 */
  onRefresh: () => void
  /** 执行状态上报给页面：页面据此决定是否轮询话题与消息。 */
  onRunningChange?: (running: boolean) => void
  className?: string
}

/**
 * 单个线程的对话区。
 *
 * 界面只展示服务端已落库的消息，执行过程用顶部的活动提示表达：
 * 回答可能写进当前线程，也可能写进 Agent 新建的线程，所以刷新范围是整个话题。
 */
export const ThreadChat = (props: ThreadChatProps) => {
  const chat = useTopicChat({
    topicId: props.topicId,
    threadId: props.thread?.id ?? null,
    onRefresh: props.onRefresh,
  })
  const markRead = useMarkAiTopicThreadRead()
  const unread = props.thread?.unreadCount ?? 0
  const threadId = props.thread?.id ?? null

  // 打开线程即视为读到当前最后一条；之后到达的新消息仍会重新出现未读点。
  useEffect(() => {
    if (!threadId || unread === 0) return
    markRead.mutate({ topicId: props.topicId, threadId })
  }, [markRead.mutate, props.topicId, threadId, unread])

  // 执行状态交给页面：轮询间隔归查询层管，不在这里再写一个定时器。
  const reportRunning = props.onRunningChange
  const running = chat.running
  useEffect(() => {
    reportRunning?.(running)
  }, [reportRunning, running])

  if (!props.thread) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        选择一个线程开始对话
      </div>
    )
  }

  const archived = props.thread.archivedAt !== null

  return (
    <div className={cn("flex min-h-0 flex-col", props.className)}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {props.thread.title}
        </span>
        {running ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LoaderCircle
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {chat.activity ?? "正在回答"}
          </span>
        ) : null}
        {archived ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Archive className="size-3.5" aria-hidden="true" />
            已归档
          </span>
        ) : null}
      </div>

      {archived ? (
        <div className="p-3">
          <Alert role="status">
            <AlertTitle>线程已归档</AlertTitle>
            <AlertDescription>
              归档线程只保留历史，不能再提问；在左侧菜单里恢复后可以继续。
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {chat.error ? (
        <div className="px-3 pt-3">
          <Alert variant="destructive" role="alert">
            <AlertTitle>这次执行的结果无法确认</AlertTitle>
            <AlertDescription>{chat.error.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {props.pending ? (
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      ) : archived ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <MessageHistory messages={props.messages} />
        </div>
      ) : (
        <AgentChat
          className="min-h-0 flex-1"
          messages={toUiMessages(props.messages)}
          status={toChatStatus(running, chat.error)}
          onSend={(message) => void chat.send(message.content)}
          onStop={chat.stop}
          slots={{ InputBar: ThreadInputBar }}
          emptyStatePosition="center"
          showCopyToolbar={false}
        />
      )}
    </div>
  )
}

/** 归档线程没有输入能力，只展示历史。 */
const MessageHistory = (props: { messages: AiTopicMessage[] }) =>
  props.messages.length === 0 ? (
    <p className="text-sm text-muted-foreground">这个线程还没有消息。</p>
  ) : (
    <ul className="flex flex-col gap-3">
      {props.messages.map((message) => (
        <li key={message.id} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{message.role === "agent" ? "AI" : "我"}</span>
            <span>{formatTimestamp(message.createdAt / 1000)}</span>
          </div>
          <div className="whitespace-pre-wrap text-sm">{message.body}</div>
        </li>
      ))}
    </ul>
  )
