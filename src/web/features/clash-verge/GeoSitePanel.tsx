import { describeError, formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import { Input } from "@web/components/ui/input"
import { Table, TableBody, TableCell, TableRow } from "@web/components/ui/table"
import { useState } from "react"
import {
  useClashVergeGeositeCategoryQuery,
  useClashVergeGeositeQuery,
} from "./queries"

/** 一次最多渲染的分类数：总共一千多个，全渲染会卡。 */
const CATEGORY_ROWS_LIMIT = 300

/** protobuf 里的条目类型：显示中文，免得看不懂 plain / rootdomain。 */
const DOMAIN_TYPE_LABEL: Record<string, string> = {
  plain: "域名",
  rootdomain: "根域",
  full: "全匹配",
  regex: "正则",
}

const bytesText = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** 单个分类的条目弹窗：条目多，只显示服务端给的前 500 条。 */
const GeositeCategoryDialog = (props: {
  code: string | null
  onClose: () => void
}) => {
  const query = useClashVergeGeositeCategoryQuery(props.code)
  return (
    <Dialog
      open={props.code !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent className="w-[min(96vw,760px)] sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>{props.code ?? ""}</DialogTitle>
          <DialogDescription>
            {query.data === undefined
              ? "正在读取条目"
              : `${query.data.total} 条${query.data.truncated ? `，只显示前 ${query.data.domains.length} 条` : ""}`}
          </DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>读取分类失败</AlertTitle>
            <AlertDescription>{describeError(query.error)}</AlertDescription>
          </Alert>
        ) : query.data === undefined ? (
          <p className="text-sm text-muted-foreground">读取中…</p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            {/* 表格统一规则：类型列按内容宽度，域名列占满剩余并截断。 */}
            <Table>
              <TableBody>
                {query.data.domains.map((domain) => (
                  <TableRow key={`${domain.type}-${domain.value}`}>
                    <TableCell className="min-w-[60px] px-2 py-1 text-left text-xs text-muted-foreground">
                      {DOMAIN_TYPE_LABEL[domain.type] ?? domain.type}
                    </TableCell>
                    <TableCell className="w-full max-w-0 min-w-[60px] truncate px-2 py-1 text-left text-xs">
                      {domain.value}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * geosite 数据库面板（只读）：列出全部分类与条目数，点分类看具体域名。
 * 数据来自本机 geosite.dat，与 Clash Verge 内核使用同一份文件。
 */
export const GeoSitePanel = () => {
  const query = useClashVergeGeositeQuery()
  const data = query.data
  const [keyword, setKeyword] = useState("")
  const [code, setCode] = useState<string | null>(null)

  const needle = keyword.trim().toLowerCase()
  const filtered =
    data === undefined
      ? []
      : needle === ""
        ? data.categories
        : data.categories.filter((item) =>
            item.code.toLowerCase().includes(needle)
          )
  const rows = filtered.slice(0, CATEGORY_ROWS_LIMIT)

  return (
    <section className="space-y-3" aria-label="geosite 数据库">
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>读取 geosite 数据库失败</AlertTitle>
          <AlertDescription>{describeError(query.error)}</AlertDescription>
        </Alert>
      ) : null}
      {data === undefined ? (
        <p className="text-sm text-muted-foreground">
          正在解析 geosite 数据库…
        </p>
      ) : (
        <>
          <p className="text-xs break-all text-muted-foreground">
            {`${data.path} · ${bytesText(data.size)} · 更新于 ${formatTimestamp(data.modified)}`}
          </p>
          <p className="text-sm">
            {`共 ${data.totalCategories} 个分类、${data.totalDomains} 条域名`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按分类名过滤，如 ads、cn、netflix"
              aria-label="按分类名过滤"
              className="max-w-sm"
            />
            <span className="text-xs text-muted-foreground">
              {keyword.trim() === "" ? "" : `${filtered.length} 个匹配`}
            </span>
          </div>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">没有匹配的分类</p>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <TableBody>
                  {rows.map((category) => (
                    <TableRow key={category.code}>
                      <TableCell className="min-w-[60px] px-2 py-1 text-left">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`查看分类条目：${category.code}`}
                          onClick={() => setCode(category.code)}
                        >
                          {category.code}
                        </Button>
                      </TableCell>
                      <TableCell className="w-full min-w-[60px] px-2 py-1 text-left text-muted-foreground tabular-nums">
                        {category.count}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {filtered.length > rows.length ? (
            <p className="text-xs text-muted-foreground">
              {`只显示前 ${CATEGORY_ROWS_LIMIT} 个分类，用搜索缩小范围`}
            </p>
          ) : null}
        </>
      )}
      <GeositeCategoryDialog code={code} onClose={() => setCode(null)} />
    </section>
  )
}
