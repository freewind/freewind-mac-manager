import { Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "cn"
import type { ReactNode } from "react"

type PageHeaderProps = {
  /** 页面标题文本。 */
  title: string
  /** 页面主查询首屏加载中：标题旁显示加载指示，读取完成后消失。 */
  loading?: boolean
  /** 标题字号等样式；个别页面现状与默认不同时按现状传入。 */
  titleClassName?: string
  /** 标题右侧的其它内容与操作区。 */
  children?: ReactNode
}

/**
 * 页面顶部标题区。
 *
 * 首屏主查询读取期间在标题旁显示加载指示，让用户先看到页面已经在读数据；局部刷新
 * 与轮询不要传 loading，避免标题反复闪动。只用官方图标与公开属性做组合，不改组件
 * 源码；旋转动效尊重系统的减弱动效设置。
 */
export const PageHeader = ({
  title,
  loading = false,
  titleClassName,
  children,
}: PageHeaderProps) => (
  <>
    <div className="flex min-w-0 items-center gap-2">
      <h1 className={cn("text-sm font-medium", titleClassName)}>{title}</h1>
      {loading ? (
        <span
          role="status"
          aria-label={`${title} 加载中`}
          className="flex shrink-0 items-center"
        >
          <HugeiconsIcon
            icon={Loading03Icon}
            className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden
          />
        </span>
      ) : null}
    </div>
    {children}
  </>
)
