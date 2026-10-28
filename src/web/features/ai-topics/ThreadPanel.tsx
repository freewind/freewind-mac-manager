import type { AiTopicThread } from "@shared/api-contract"
import { describeError } from "@shared/format"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Button } from "@web/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { cn } from "cn"
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  useArchiveAiTopicThread,
  useCreateAiTopicThread,
  useDeleteAiTopicThread,
  useRenameAiTopicThread,
} from "./queries"

type ThreadPanelProps = {
  topicId: string
  threads: AiTopicThread[]
  activeThreadId: string | null
  /** 话题正在执行：此时禁用写操作，避免与 Agent 同时改线程结构。 */
  running: boolean
  onSelect: (threadId: string) => void
  className?: string
}

type PendingDelete = { thread: AiTopicThread }

/**
 * 线程列表：Agent 与用户都能增删改线程，这里负责用户的那些操作。
 * 删除一律走确认对话框，明确说明会删掉多少条消息。
 */
export const ThreadPanel = (props: ThreadPanelProps) => {
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState("")
  const [renaming, setRenaming] = useState<AiTopicThread | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  useHistoryOverlay(createOpen, () => setCreateOpen(false))
  useHistoryOverlay(renaming !== null, () => setRenaming(null))
  useHistoryOverlay(pendingDelete !== null, () => setPendingDelete(null))

  const createThread = useCreateAiTopicThread()
  const renameThread = useRenameAiTopicThread()
  const archiveThread = useArchiveAiTopicThread()
  const deleteThread = useDeleteAiTopicThread()

  const active = props.threads.filter((thread) => thread.archivedAt === null)
  const archived = props.threads.filter((thread) => thread.archivedAt !== null)

  const submitCreate = () => {
    const title = createTitle.trim()
    if (!title) return
    createThread.mutate(
      { topicId: props.topicId, title },
      {
        onSuccess: (result) => {
          setCreateOpen(false)
          setCreateTitle("")
          props.onSelect(result.thread.id)
        },
        onError: (error) =>
          toast.error(`新建线程失败：${describeError(error)}`),
      }
    )
  }

  const submitRename = () => {
    if (!renaming) return
    const title = renameTitle.trim()
    if (!title) return
    renameThread.mutate(
      { topicId: props.topicId, threadId: renaming.id, title },
      {
        onSuccess: () => {
          setRenaming(null)
          toast.success("已重命名线程")
        },
        onError: (error) => toast.error(`重命名失败：${describeError(error)}`),
      }
    )
  }

  const toggleArchive = (thread: AiTopicThread) => {
    const next = thread.archivedAt === null
    archiveThread.mutate(
      { topicId: props.topicId, threadId: thread.id, archived: next },
      {
        onSuccess: () => toast.success(next ? "已归档线程" : "已恢复线程"),
        onError: (error) => toast.error(`操作失败：${describeError(error)}`),
      }
    )
  }

  const renderThread = (thread: AiTopicThread) => (
    <li key={thread.id}>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md",
          thread.id === props.activeThreadId
            ? "bg-sidebar-accent"
            : "hover:bg-muted"
        )}
      >
        <button
          type="button"
          onClick={() => props.onSelect(thread.id)}
          aria-label={
            thread.unreadCount > 0
              ? `${thread.title}，${thread.unreadCount} 条未读`
              : undefined
          }
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm"
        >
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          {thread.unreadCount > 0 ? (
            <span
              className="size-2 shrink-0 rounded-full bg-primary"
              aria-hidden="true"
            />
          ) : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`管理线程 ${thread.title}`}
                disabled={props.running}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setRenameTitle(thread.title)
                setRenaming(thread)
              }}
            >
              <Pencil aria-hidden="true" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleArchive(thread)}>
              {thread.archivedAt === null ? (
                <>
                  <Archive aria-hidden="true" />
                  归档
                </>
              ) : (
                <>
                  <ArchiveRestore aria-hidden="true" />
                  恢复
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setPendingDelete({ thread })}
            >
              <Trash2 aria-hidden="true" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )

  return (
    <div className={cn("flex min-h-0 flex-col", props.className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">线程</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={props.running}
          onClick={() => setCreateOpen(true)}
        >
          <Plus aria-hidden="true" />
          新建线程
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {active.length === 0 ? (
          <Empty className="border-0 p-6">
            <EmptyHeader>
              <EmptyTitle>还没有可用的线程</EmptyTitle>
              <EmptyDescription>新建一个线程后就能提问。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1">{active.map(renderThread)}</ul>
        )}

        {archived.length > 0 ? (
          <Collapsible className="mt-3">
            <CollapsibleTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start"
                >
                  <ChevronRight aria-hidden="true" />
                  已归档（{archived.length}）
                </Button>
              }
            />
            <CollapsibleContent>
              <ul className="mt-1 flex flex-col gap-1">
                {archived.map(renderThread)}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建线程</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-thread-title">线程标题</Label>
            <Input
              id="ai-thread-title"
              value={createTitle}
              autoFocus
              placeholder="这个线程要解决的问题"
              onChange={(event) => setCreateTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitCreate()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!createTitle.trim() || createThread.isPending}
              onClick={submitCreate}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名线程</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-thread-rename">线程标题</Label>
            <Input
              id="ai-thread-rename"
              value={renameTitle}
              autoFocus
              onChange={(event) => setRenameTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRename()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              disabled={!renameTitle.trim() || renameThread.isPending}
              onClick={submitRename}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除线程「{pendingDelete?.thread.title}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该线程的 {pendingDelete?.thread.messageCount ?? 0}{" "}
              条消息会一起删除，无法恢复。Agent 之后也不会再把回答写到这里。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteThread.isPending}
              onClick={() => {
                if (!pendingDelete) return
                deleteThread.mutate(
                  {
                    topicId: props.topicId,
                    threadId: pendingDelete.thread.id,
                  },
                  {
                    onSuccess: () => {
                      setPendingDelete(null)
                      toast.success("已删除线程")
                    },
                    onError: (error) =>
                      toast.error(`删除失败：${describeError(error)}`),
                  }
                )
              }}
            >
              删除线程
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
