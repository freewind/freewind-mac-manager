import { FolderAddIcon } from "@hugeicons/core-free-icons"

export type EntryActionIcon = typeof FolderAddIcon

/** 工具栏与右键菜单共用的一份动作描述。 */
export type EntryAction = {
  key: string
  label: string
  icon: EntryActionIcon
  disabled?: boolean
  destructive?: boolean
  run: () => void
}
