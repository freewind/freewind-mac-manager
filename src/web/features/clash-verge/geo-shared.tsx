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
