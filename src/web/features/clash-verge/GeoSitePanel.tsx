import { describeError, formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { Input } from "@web/components/ui/input"
import { Table, TableBody, TableCell, TableRow } from "@web/components/ui/table"
import { Fragment, useState } from "react"
import {
  useClashVergeGeositeCategoryQuery,
  useClashVergeGeositeQuery,
} from "./queries"

/** 分类条目的分页大小：与服务端默认页大小一致。 */
const PAGE_SIZE = 500

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

/** 正在展开的分类与它的页码：整块放外面，展开区自己不存 state。 */
type OpenCategory = { code: string; offset: number }

/** 分类条目：直接嵌在表格行下面，按页翻。 */
const CategoryDomains = (props: {
  view: OpenCategory
  onChangeOffset: (offset: number) => void
}) => {
  const query = useClashVergeGeositeCategoryQuery(
    props.view.code,
    props.view.offset
  )
  const total = query.data?.total ?? 0
  const offset = props.view.offset
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>读取分类失败</AlertTitle>
        <AlertDescription>{describeError(query.error)}</AlertDescription>
      </Alert>
    )
  }
  if (query.data === undefined) {
    return <p className="text-xs text-muted-foreground">读取中…</p>
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {`共 ${total} 条 · 显示第 ${offset + 1}-${offset + query.data.domains.length} 条`}
      </p>
      {/* 表格统一规则：类型列按内容宽度，域名列占满剩余并截断。 */}
      <div className="max-h-[50vh] overflow-auto rounded-md border">
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {`共 ${Math.max(1, Math.ceil(total / PAGE_SIZE))} 页`}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={offset === 0}
            onClick={() =>
              props.onChangeOffset(Math.max(0, offset - PAGE_SIZE))
            }
          >
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => props.onChangeOffset(offset + PAGE_SIZE)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * geosite 数据库面板（只读）：列出全部分类与条目数，
 * 点「全部显示」把该分类的域名直接展开在表格里，不跳弹窗。
 * 数据来自本机 geosite.dat，与 Clash Verge 内核使用同一份文件。
 */
export const GeoSitePanel = () => {
  const query = useClashVergeGeositeQuery()
  const data = query.data
  const [keyword, setKeyword] = useState("")
  const [open, setOpen] = useState<OpenCategory | null>(null)

  const needle = keyword.trim().toLowerCase()
  const filtered =
    data === undefined
      ? []
      : needle === ""
        ? data.categories
        : data.categories.filter((item) =>
            item.code.toLowerCase().includes(needle)
          )

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
            <div className="max-h-[70vh] overflow-auto">
              <Table>
                <TableBody>
                  {filtered.map((category) => (
                    <Fragment key={category.code}>
                      <TableRow>
                        <TableCell className="min-w-[60px] px-2 py-1 text-left">
                          {category.code}
                        </TableCell>
                        <TableCell className="min-w-[60px] px-2 py-1 text-left text-muted-foreground tabular-nums">
                          {category.count}
                        </TableCell>
                        <TableCell className="w-full min-w-[60px] px-2 py-1 text-left">
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`${open?.code === category.code ? "收起" : "全部显示"}：${category.code}`}
                            onClick={() =>
                              setOpen((current) =>
                                current?.code === category.code
                                  ? null
                                  : { code: category.code, offset: 0 }
                              )
                            }
                          >
                            {open?.code === category.code ? "收起" : "全部显示"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open?.code === category.code ? (
                        <TableRow>
                          <TableCell colSpan={3} className="p-2">
                            <CategoryDomains
                              view={open}
                              onChangeOffset={(offset) =>
                                setOpen({ code: open.code, offset })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
