import type { AiCallSession } from "@shared/api-contract"
import { useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@web/components/PageHeader"
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
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import { Skeleton } from "@web/components/ui/skeleton"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { cn } from "cn"
import { History, Phone, Settings } from "lucide-react"
import { useCallback, useState } from "react"
import { CallSettingsDialog } from "./CallSettingsDialog"
import { CallStage } from "./CallStage"
import {
  aiCallKeys,
  useAiCallSessionQuery,
  useAiCallSessionsQuery,
  useCreateAiCallSession,
  useFinishAiCallSession,
} from "./queries"

/** 会话标题两侧的时间格式：手机上一行放得下就够了。 */
const formatTime = (value: number): string =>
  new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

/**
 * AI 通话页。
 *
 * 手机优先单列：上方是当前通话，历史收进浮层。通话记录全部保存在服务端，
 * 换设备、刷新、隔天再来都能点开同一次通话继续看。
 */
export const AiCallPage = () => {
  const queryClient = useQueryClient()
  const sessionsQuery = useAiCallSessionsQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useHistoryOverlay(historyOpen, () => setHistoryOpen(false))

  const createSession = useCreateAiCallSession()
  const finishSession = useFinishAiCallSession()

  const sessions = sessionsQuery.data?.sessions ?? []
  // 没有显式选择时停在最近一次通话：进来就能接着上次的话题说。
  const activeId = selectedId ?? sessions[0]?.id ?? null
  const detailQuery = useAiCallSessionQuery(activeId, busy)

  const refresh = useCallback(() => {
    if (!activeId) return
    void queryClient.invalidateQueries({ queryKey: aiCallKeys.list() })
    void queryClient.invalidateQueries({
      queryKey: aiCallKeys.detail(activeId),
    })
  }, [activeId, queryClient])

  const startNew = (): void => {
    createSession.mutate(undefined, {
      onSuccess: (detail) => {
        setSelectedId(detail.session.id)
        setHistoryOpen(false)
      },
    })
  }

  const hangUp = (): void => {
    if (!activeId) return
    finishSession.mutate(activeId)
  }

  const renderSessionRow = (session: AiCallSession) => (
    <button
      key={session.id}
      type="button"
      onClick={() => {
        setSelectedId(session.id)
        setHistoryOpen(false)
      }}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left",
        session.id === activeId ? "bg-accent" : "hover:bg-accent/60"
      )}
    >
      <span className="truncate text-sm font-medium">{session.title}</span>
      <span className="text-xs text-muted-foreground">
        {formatTime(session.createdAt)}
        {session.messageCount > 0 ? ` · ${session.messageCount} 句` : null}
      </span>
    </button>
  )

  const header = (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
      <PageHeader title="AI 通话" loading={sessionsQuery.isPending}>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-label="通话设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setHistoryOpen(true)}
          >
            <History aria-hidden />
            历史
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={createSession.isPending}
            onClick={startNew}
          >
            <Phone aria-hidden />
            新通话
          </Button>
        </div>
      </PageHeader>
    </div>
  )

  if (sessionsQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    )
  }

  if (!activeId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>还没有通话</EmptyTitle>
            <EmptyDescription>
              开始一次通话，说的话会一直留在历史里
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={startNew} disabled={createSession.isPending}>
            <Phone aria-hidden />
            开始通话
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <CallStage
        sessionId={activeId}
        messages={detailQuery.data?.messages ?? []}
        onRefresh={refresh}
        onBusyChange={setBusy}
        onHangUp={hangUp}
      />
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-80">
          <SheetHeader>
            <SheetTitle>历史通话</SheetTitle>
            <SheetDescription>共 {sessions.length} 次</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-1 overflow-y-auto px-4 pb-4">
            {sessions.map(renderSessionRow)}
          </div>
        </SheetContent>
      </Sheet>
      <CallSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
