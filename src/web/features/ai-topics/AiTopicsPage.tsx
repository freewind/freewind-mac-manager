import { useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@web/components/PageHeader"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import { Skeleton } from "@web/components/ui/skeleton"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { Bot, ChevronDown, MessagesSquare, Settings2 } from "lucide-react"
import { useCallback, useState } from "react"
import {
  aiTopicKeys,
  useAiTopicMessagesQuery,
  useAiTopicQuery,
  useAiTopicSettings,
  useAiTopicsQuery,
  useCreateAiTopic,
} from "./queries"
import { ThreadChat } from "./ThreadChat"
import { ThreadPanel } from "./ThreadPanel"
import { TopicList } from "./TopicList"
import { TopicSettingsDialog } from "./TopicSettingsDialog"
import { useAiTopicsLocation } from "./use-ai-topics-location"

/**
 * AI 话题页。
 *
 * 手机默认单列：先看话题，进入后直接停在第一个线程，其余线程与话题从顶部
 * 切换；桌面同时展示话题、线程与对话三栏。两种布局共享同一份数据与动作。
 */
export const AiTopicsPage = () => {
  const isDesktop = useIsDesktop()
  const queryClient = useQueryClient()
  const location = useAiTopicsLocation()
  const topicsQuery = useAiTopicsQuery()
  // 执行期间才轮询：话题只有一个 Agent，回答可能写进另一个线程。
  const [chatRunning, setChatRunning] = useState(false)
  const detailQuery = useAiTopicQuery(location.topicId, chatRunning)
  const settings = useAiTopicSettings(true)
  const createTopic = useCreateAiTopic()

  const [settingsOpen, setSettingsOpen] = useState(false)

  const [topicSheet, setTopicSheet] = useState(false)
  const [threadSheet, setThreadSheet] = useState(false)
  useHistoryOverlay(topicSheet, () => setTopicSheet(false))
  useHistoryOverlay(threadSheet, () => setThreadSheet(false))

  const topicId = location.topicId
  const threads = detailQuery.data?.threads ?? []
  // 没有显式选中线程时停在第一个可用线程：进入话题就能开口，少一次点击。
  const activeThread =
    threads.find((thread) => thread.id === location.threadId) ??
    threads.find((thread) => thread.archivedAt === null) ??
    null
  const effectiveThreadId = activeThread?.id ?? null
  const messagesQuery = useAiTopicMessagesQuery(
    location.topicId,
    effectiveThreadId,
    chatRunning || detailQuery.data?.topic.status === "running"
  )

  const refresh = useCallback(() => {
    if (!topicId) return
    void queryClient.invalidateQueries({ queryKey: aiTopicKeys.list() })
    void queryClient.invalidateQueries({
      queryKey: aiTopicKeys.detail(topicId),
    })
    void queryClient.invalidateQueries({
      queryKey: [...aiTopicKeys.all, "messages", topicId],
    })
  }, [queryClient, topicId])

  const configured = Boolean(
    settings.data?.settings.providerId && settings.data?.settings.modelId
  )
  const running = chatRunning || detailQuery.data?.topic.status === "running"

  const renderTopicList = () => (
    <TopicList
      topics={topicsQuery.data?.topics ?? []}
      activeTopicId={topicId}
      pending={topicsQuery.isPending}
      creating={createTopic.isPending}
      onSelect={(nextTopicId) => {
        setTopicSheet(false)
        location.selectTopic(nextTopicId)
      }}
      onCreate={(title) =>
        createTopic.mutate(title, {
          onSuccess: (detail) => {
            setTopicSheet(false)
            location.selectTopic(detail.topic.id)
          },
        })
      }
    />
  )

  const renderThreadPanel = () =>
    topicId ? (
      <ThreadPanel
        topicId={topicId}
        threads={threads}
        activeThreadId={effectiveThreadId}
        running={running}
        onSelect={(threadId) => {
          setThreadSheet(false)
          location.selectThread(threadId)
        }}
      />
    ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Bot className="size-4" />
        <PageHeader title="AI 话题" loading={topicsQuery.isPending} />
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 aria-hidden="true" />
            话题设置
          </Button>
          {isDesktop ? null : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTopicSheet(true)}
              >
                <MessagesSquare aria-hidden="true" />
                <span className="max-w-28 truncate">
                  {detailQuery.data?.topic.title ?? "选择话题"}
                </span>
                <ChevronDown aria-hidden="true" />
              </Button>
              {activeThread ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setThreadSheet(true)}
                >
                  <span className="max-w-28 truncate">
                    {activeThread.title}
                  </span>
                  <ChevronDown aria-hidden="true" />
                </Button>
              ) : null}
            </>
          )}
        </div>
      </header>

      {topicsQuery.isError ? (
        <div className="p-4">
          <Alert variant="destructive" role="alert">
            <AlertTitle>读取话题失败</AlertTitle>
            <AlertDescription>
              无法确认话题列表，请稍后重新打开本页核实。
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {settings.isError ? (
        <div className="p-4">
          <Alert variant="destructive" role="alert">
            <AlertTitle>读取助手设置失败</AlertTitle>
            <AlertDescription>
              无法确认 AI 配置，请稍后重新打开本页核实。
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {settings.isSuccess && !configured ? (
        <div className="p-4">
          <Alert role="status">
            <AlertTitle>还没有选择 AI 模型</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>话题用自己的模型，先选中一个模型再对话。</span>
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => setSettingsOpen(true)}
              >
                去设置模型
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {settings.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-8 w-1/4" />
        </div>
      ) : configured ? (
        isDesktop ? (
          <div className="flex min-h-0 flex-1">
            <div className="flex w-60 shrink-0 flex-col border-r">
              {renderTopicList()}
            </div>
            <div className="flex w-60 shrink-0 flex-col border-r">
              {renderThreadPanel() ?? (
                <p className="p-4 text-sm text-muted-foreground">
                  先选择或新建一个话题。
                </p>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {topicId ? (
                <ThreadChat
                  topicId={topicId}
                  thread={activeThread}
                  messages={messagesQuery.data?.messages ?? []}
                  pending={messagesQuery.isPending}
                  onRefresh={refresh}
                  onRunningChange={setChatRunning}
                  className="flex-1"
                />
              ) : (
                <Empty className="flex-1 border-0">
                  <EmptyHeader>
                    <EmptyTitle>选择或新建一个话题</EmptyTitle>
                    <EmptyDescription>
                      一个话题对应一个 AI 对话，话题下用线程分开不同问题。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </div>
        ) : topicId ? (
          <ThreadChat
            topicId={topicId}
            thread={activeThread}
            messages={messagesQuery.data?.messages ?? []}
            pending={messagesQuery.isPending}
            onRefresh={refresh}
            onRunningChange={setChatRunning}
            className="flex-1"
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {renderTopicList()}
          </div>
        )
      ) : null}

      <TopicSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <Sheet open={topicSheet} onOpenChange={setTopicSheet}>
        <SheetContent side="left" className="w-72 gap-0 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>话题</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            {renderTopicList()}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={threadSheet} onOpenChange={setThreadSheet}>
        <SheetContent side="right" className="w-72 gap-0 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>线程</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            {renderThreadPanel()}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
