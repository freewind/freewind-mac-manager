import { Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@web/components/ui/button"
import type { ComponentProps, ReactNode } from "react"

type ActionButtonProps = ComponentProps<typeof Button> & {
  /** 动作进行中：按钮不可重复点击，并显示旋转图标。 */
  busy?: boolean
  /** 进行态文案；不传则保留原内容，避免按钮宽度跳动。 */
  busyLabel?: ReactNode
}

/**
 * 发起异步动作的按钮。
 *
 * 只用官方 Button 的公开属性做组合，不改组件源码；busy 期间禁用并把状态暴露给
 * 辅助技术。旋转动效尊重系统的减弱动效设置。
 */
export const ActionButton = ({
  busy = false,
  busyLabel,
  disabled,
  children,
  ...props
}: ActionButtonProps) => (
  <Button {...props} disabled={disabled || busy} aria-busy={busy || undefined}>
    {busy ? (
      <HugeiconsIcon
        icon={Loading03Icon}
        className="animate-spin motion-reduce:animate-none"
        aria-hidden
      />
    ) : null}
    {busy && busyLabel !== undefined ? busyLabel : children}
  </Button>
)
