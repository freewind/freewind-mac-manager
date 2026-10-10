import { ArrowUp01Icon, Folder01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { ActionButton } from "@web/components/ActionButton"
import { Button } from "@web/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ScrollArea } from "@web/components/ui/scroll-area"
import { Skeleton } from "@web/components/ui/skeleton"
import { buildCrumbs, dirnameOf } from "@web/features/files/domain"
import { useDirectoryQuery } from "@web/features/files/queries"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useState } from "react"
import { PathBreadcrumb } from "./PathBreadcrumb"

type MoveDialogProps = {
  open: boolean
  mode: "copy" | "move"
  rootPath: string
  startPath: string
  names: string[]
  onOpenChange: (open: boolean) => void
  onSubmit: (destPath: string) => Promise<boolean>
  busy?: boolean
}

/** 复制 / 移动的目标目录选择：只列目录，可以逐级进入或回收。 */
export const MoveDialog = ({
  open,
  mode,
  rootPath,
  startPath,
  names,
  onOpenChange,
  onSubmit,
  busy = false,
}: MoveDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{mode === "copy" ? "复制到" : "移动到"}</DialogTitle>
        <DialogDescription className="truncate">
          {names.length} 个条目：{names.join("、")}
        </DialogDescription>
      </DialogHeader>
      {open ? (
        <MovePicker
          rootPath={rootPath}
          busy={busy}
          startPath={startPath}
          mode={mode}
          onClose={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      ) : null}
    </DialogContent>
  </Dialog>
)

type MovePickerProps = {
  rootPath: string
  startPath: string
  mode: "copy" | "move"
  onClose: () => void
  onSubmit: (destPath: string) => Promise<boolean>
  busy: boolean
}

const MovePicker = ({
  rootPath,
  startPath,
  mode,
  onClose,
  onSubmit,
  busy,
}: MovePickerProps) => {
  const submission = useDialogSubmit(onClose, busy)
  const [targetPath, setTargetPath] = useState(startPath)
  const query = useDirectoryQuery(targetPath)
  const resolved = query.data?.path ?? targetPath
  const dirs = (query.data?.entries ?? []).filter(
    (entry) => entry.kind === "dir"
  )
  const crumbs = buildCrumbs(rootPath, resolved)
  const atStart = resolved === startPath

  return (
    <div className="flex flex-col gap-3">
      <PathBreadcrumb
        crumbs={crumbs}
        onNavigate={(path) => {
          if (!submission.busy) setTargetPath(path)
        }}
      />

      <ScrollArea className="h-56 rounded-md border">
        {query.isLoading ? (
          <div className="flex flex-col gap-1 p-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : dirs.length === 0 ? (
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyTitle>没有子目录</EmptyTitle>
              <EmptyDescription>可以直接把条目放到这里</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-0.5 p-1">
            {dirs.map((dir) => (
              <Button
                key={dir.path}
                size="sm"
                variant="ghost"
                className="justify-start"
                disabled={submission.busy}
                onClick={() => setTargetPath(dir.path)}
              >
                <HugeiconsIcon icon={Folder01Icon} />
                <span className="truncate">{dir.name}</span>
              </Button>
            ))}
          </div>
        )}
      </ScrollArea>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={resolved === rootPath || submission.busy}
          onClick={() => setTargetPath(dirnameOf(resolved))}
        >
          <HugeiconsIcon icon={ArrowUp01Icon} />
          上一层
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={submission.busy}
          onClick={onClose}
        >
          取消
        </Button>
        <ActionButton
          type="button"
          busy={submission.busy}
          busyLabel={mode === "copy" ? "复制中…" : "移动中…"}
          disabled={atStart || query.isLoading || query.isError}
          onClick={() => void submission.submit(() => onSubmit(resolved))}
        >
          {mode === "copy" ? "复制到这里" : "移动到这里"}
        </ActionButton>
      </DialogFooter>
    </div>
  )
}
