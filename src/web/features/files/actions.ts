import type { LucideIcon } from "lucide-react"

/** 动作图标用 lucide 组件本身，不是图标数据。 */
export type EntryActionIcon = LucideIcon

/** 工具栏与右键菜单共用的一份动作描述。 */
export type EntryAction = {
  key: string
  label: string
  icon: EntryActionIcon
  disabled?: boolean
  destructive?: boolean
  run: () => void
}
