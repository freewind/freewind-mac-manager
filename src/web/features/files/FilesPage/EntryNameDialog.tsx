import { Button } from "@web/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@web/components/ui/field"
import { Input } from "@web/components/ui/input"
import { useState } from "react"

type EntryNameDialogProps = {
  open: boolean
  title: string
  description: string
  confirmText: string
  initialValue?: string
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}

/** 新建（目录 / 文件）与重命名共用的命名弹窗。 */
export const EntryNameDialog = ({
  open,
  title,
  description,
  confirmText,
  initialValue = "",
  onOpenChange,
  onSubmit,
}: EntryNameDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {open ? (
        <EntryNameForm
          initialValue={initialValue}
          confirmText={confirmText}
          onClose={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      ) : null}
    </DialogContent>
  </Dialog>
)

type EntryNameFormProps = {
  initialValue: string
  confirmText: string
  onClose: () => void
  onSubmit: (name: string) => void
}

/** 表单独立成组件：每次打开都从 initialValue 重新起算，不残留上次输入。 */
const EntryNameForm = ({
  initialValue,
  confirmText,
  onClose,
  onSubmit,
}: EntryNameFormProps) => {
  const [name, setName] = useState(initialValue)
  const trimmed = name.trim()

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed.length === 0) return
        onSubmit(trimmed)
        onClose()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="files-entry-name">名称</FieldLabel>
          <Input
            id="files-entry-name"
            value={name}
            autoFocus
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={trimmed.length === 0}>
          {confirmText}
        </Button>
      </DialogFooter>
    </form>
  )
}
