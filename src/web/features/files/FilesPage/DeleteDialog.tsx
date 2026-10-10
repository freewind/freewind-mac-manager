import { ActionButton } from "@web/components/ActionButton"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"

import { useDialogSubmit } from "@web/hooks/use-dialog-submit"

type DeleteDialogProps = {
  open: boolean
  names: string[]
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<boolean>
  busy?: boolean
}

/** 删除前确认；列出将要删除的名字，避免误删。 */
export const DeleteDialog = ({
  open,
  names,
  onOpenChange,
  onConfirm,
  busy = false,
}: DeleteDialogProps) => {
  const submission = useDialogSubmit(() => onOpenChange(false), busy)
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除 {names.length} 项</AlertDialogTitle>
          <AlertDialogDescription>
            删除后不可恢复，以下条目会从磁盘移除：
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-48 overflow-y-auto rounded-md border p-2 text-xs">
          {names.map((name) => (
            <li key={name} className="truncate py-0.5">
              {name}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submission.busy}>取消</AlertDialogCancel>
          <ActionButton
            variant="destructive"
            busy={submission.busy}
            busyLabel="删除中…"
            onClick={() => void submission.submit(onConfirm)}
          >
            删除
          </ActionButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
