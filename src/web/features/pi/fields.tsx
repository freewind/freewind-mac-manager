import { Label } from "@web/components/ui/label"
import type { ReactNode } from "react"

/** Pi 页弹窗表单的统一字段排版：小号标签在上，控件在下。 */
export const Field = (props: { label: string; children: ReactNode }) => (
  <Label className="grid gap-1 text-xs">
    {props.label}
    {props.children}
  </Label>
)
