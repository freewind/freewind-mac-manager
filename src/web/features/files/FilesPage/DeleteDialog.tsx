import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"

type DeleteDialogProps = {
  open: boolean
  names: string[]
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/** 删除前确认；列出将要删除的名字，避免误删。 */
export const DeleteDialog = ({
  open,
  names,
  onOpenChange,
  onConfirm,
}: DeleteDialogProps) => (
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
        <AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          onClick={() => {
            onConfirm()
            onOpenChange(false)
          }}
        >
          删除
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)
