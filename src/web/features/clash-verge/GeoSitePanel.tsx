import { describeError, formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { Input } from "@web/components/ui/input"
import { Table, TableBody, TableCell, TableRow } from "@web/components/ui/table"
import { useState } from "react"
import { useClashVergeGeositeQuery } from "./queries"

/** 分页大小：数据一次性拿到前端，只是展示时分页。 */
const PAGE_SIZE = 100

const bytesText = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * geosite 数据库面板（只读）：每个分类一行，域名直接列成标签。
 * 数据来自本机 geosite.dat，与 Clash Verge 内核使用同一份文件。
 * 单个分类动辄上万条，服务端只给前 100 条，剩余用「还有 N 条」标出。
 */
export const GeoSitePanel = () => {
  const query = useClashVergeGeositeQuery()
  const data = query.data
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(1)

  const needle = keyword.trim().toLowerCase()
  const filtered =
    data === undefined
      ? []
      : needle === ""
        ? data.categories
        : data.categories.filter((item) =>
            item.code.toLowerCase().includes(needle)
          )

  // 搜索把结果变短时页码可能越界，按当前总页数夹一下，不再额外存一份状态。
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
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
              onChange={(event) => {
                setKeyword(event.target.value)
                setPage(1)
              }}
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
              {/* 表格统一规则：分类名与个数按内容宽度，最后一列占满剩余。 */}
              <Table>
                <TableBody>
                  {pageRows.map((category) => (
                    <TableRow key={category.code}>
                      <TableCell className="min-w-[60px] px-2 py-1 align-top text-left">
                        {category.code}
                      </TableCell>
                      <TableCell className="min-w-[60px] px-2 py-1 align-top text-left text-muted-foreground tabular-nums">
                        {category.count}
                      </TableCell>
                      <TableCell className="w-full min-w-[60px] px-2 py-1 align-top text-left">
                        <span className="flex flex-wrap gap-1">
                          {category.preview.map((domain) => (
                            <span
                              key={domain}
                              className="inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 text-xs break-all"
                            >
                              {domain}
                            </span>
                          ))}
                          {category.count > category.preview.length ? (
                            <span className="inline-flex items-center rounded-md border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground">
                              {`还有 ${category.count - category.preview.length} 条`}
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {`第 ${currentPage} / ${totalPages} 页 · 共 ${filtered.length} 个分类`}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage === totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
