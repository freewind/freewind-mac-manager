import type { AiTopic } from "@shared/api-contract"
import { Button } from "@web/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import { Skeleton } from "@web/components/ui/skeleton"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { cn } from "cn"
import { LoaderCircle, MessageSquarePlus, Plus } from "lucide-react"
import { useState } from "react"

type TopicListProps = {
  topics: AiTopic[]
  activeTopicId: string | null
  pending: boolean
  onSelect: (topicId: string) => void
  onCreate: (title: string) => void
  creating: boolean
  className?: string
}

/**
 * 话题列表：手机与桌面共用同一份实现，只由外部布局决定宽度与位置。
 * 话题本身就是入口，选中后进入它的线程与对话。
 */
export const TopicList = (props: TopicListProps) => {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  useHistoryOverlay(open, () => setOpen(false))

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    props.onCreate(trimmed)
    setTitle("")
    setOpen(false)
  }

  return (
    <div className={cn("flex min-h-0 flex-col", props.className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">话题</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => setOpen(true)}
        >
          <Plus aria-hidden="true" />
          新建话题
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {props.pending ? (
          <div className="flex flex-col gap-2 p-1">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : props.topics.length === 0 ? (
          <Empty className="border-0 p-6">
            <EmptyHeader>
              <EmptyTitle>还没有话题</EmptyTitle>
              <EmptyDescription>
                新建一个话题，就有一个专属的 AI 对话。
              </EmptyDescription>
            </EmptyHeader>
            <Button size="sm" onClick={() => setOpen(true)}>
              <MessageSquarePlus aria-hidden="true" />
              新建话题
            </Button>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {props.topics.map((topic) => (
              <li key={topic.id}>
                <button
                  type="button"
                  onClick={() => props.onSelect(topic.id)}
                  aria-label={
                    topic.unreadCount > 0
                      ? `${topic.title}，${topic.unreadCount} 条未读`
                      : undefined
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                    topic.id === props.activeTopicId
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{topic.title}</span>
                  {topic.status === "running" ? (
                    <LoaderCircle
                      className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
                      aria-label="正在执行"
                    />
                  ) : null}
                  {topic.unreadCount > 0 ? (
                    <span
                      className="size-2 shrink-0 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {topic.threadCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建话题</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-topic-title">话题名称</Label>
            <Input
              id="ai-topic-title"
              value={title}
              autoFocus
              placeholder="例如：理解这个项目"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={!title.trim() || props.creating} onClick={submit}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
