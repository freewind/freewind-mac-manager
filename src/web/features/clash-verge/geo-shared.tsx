import { Button } from "@web/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@web/components/ui/popover"
import { CircleHelp } from "lucide-react"
import type { ReactNode } from "react"

/**
 * GEO 数据几个页面共用的展示件：分页、字节数、表头问号。
 * 四个页面（geosite / geoip / Country / ASN）的浏览方式一致，
 * 只把内容不同，这些骨架放在一处。
 */

/** 分页大小：数据一次性拿到前端，只是展示时分页。 */
export const PAGE_SIZE = 100

/**
 * 要显示的页码：当前页前后各 1 个，加上第一页与最后一页；
 * 中间不连续的地方用 "gap" 表示省略号。
 */
export const pageItems = (
  current: number,
  total: number
): (number | string)[] => {
  const wanted = new Set<number>([1, total, current - 1, current, current + 1])
  const pages = [...wanted]
    .filter((page) => page >= 1 && page <= total)
    .sort((left, right) => left - right)
  const items: (number | string)[] = []
  let previous = 0
  for (const page of pages) {
    // 省略号以左边那一页命名，兼作 React key。
    if (previous !== 0 && page - previous > 1) items.push(`gap-${previous}`)
    items.push(page)
    previous = page
  }
  return items
}

/** 文件大小：1 MB 以下用 KB，读起来比一长串字节直观。 */
export const bytesText = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * 页面顶部的简介：这份数据是什么、拿来干什么、从哪来、怎么更新。
 * 四个 GEO 页共用同一个版式，内容各写各的。
 */
export const GeoIntro = (props: { children: ReactNode }) => (
  <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
    {props.children}
  </div>
)

/** 表头说明：标题旁一个问号，点开看这一列是什么。 */
export const HeaderHelp = (props: { label: string; children: ReactNode }) => (
  <span className="flex items-center gap-1">
    {props.label}
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`说明：${props.label}`}
          >
            <CircleHelp aria-hidden="true" />
          </Button>
        }
      />
      <PopoverContent className="w-[min(92vw,360px)] text-xs">
        {props.children}
      </PopoverContent>
    </Popover>
  </span>
)

/** 底部分页条：左边是总量说明，右边是页码与上一页 / 下一页。 */
export const GeoPageNav = (props: {
  page: number
  totalPages: number
  summary: string
  onChange: (page: number) => void
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <span className="text-xs text-muted-foreground">{props.summary}</span>
    <div className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={props.page === 1}
        onClick={() => props.onChange(props.page - 1)}
      >
        上一页
      </Button>
      {pageItems(props.page, props.totalPages).map((item) =>
        typeof item === "string" ? (
          <span
            key={item}
            aria-hidden="true"
            className="px-1 text-xs text-muted-foreground"
          >
            …
          </span>
        ) : (
          <Button
            key={item}
            size="sm"
            variant={item === props.page ? "default" : "outline"}
            aria-label={`第 ${item} 页`}
            aria-current={item === props.page ? "page" : undefined}
            onClick={() => props.onChange(item)}
          >
            {item}
          </Button>
        )
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={props.page === props.totalPages}
        onClick={() => props.onChange(props.page + 1)}
      >
        下一页
      </Button>
    </div>
  </div>
)
