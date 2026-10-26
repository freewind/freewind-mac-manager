import { describeError, formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@web/components/ui/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { X } from "lucide-react"
import { useState } from "react"
import { bytesText, GeoPageNav, HeaderHelp, PAGE_SIZE } from "./geo-shared"
import { useClashVergeGeositeQuery } from "./queries"

/** protobuf 里的类型：页面显示中文，免得看不懂 plain / rootdomain。 */
const DOMAIN_TYPE_LABEL: Record<string, string> = {
  plain: "域名",
  rootdomain: "根域",
  full: "全匹配",
  regex: "正则",
}

/** 属性标注显示成 @ads 这种形式，与上游写法一致。 */
const attributeText = (attributes: string[]): string =>
  attributes.map((attribute) => `@${attribute}`).join(" ")

/**
 * geosite 数据库面板（只读）：每个分类一行，域名直接列成标签。
 * 数据来自本机 geosite.dat，与 Clash Verge 内核使用同一份文件。
 * 单个分类动辄上万条，服务端只给前 30 条，剩余用「还有 N 条」标出。
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

  // 默认按条目数从多到少：条目多的分类往往是常用的那几个。
  // 复制一份再排，不改动查询缓存里的原数组。
  const sorted = [...filtered].sort((left, right) => right.count - left.count)

  // 搜索把结果变短时页码可能越界，按当前总页数夹一下，不再额外存一份状态。
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = sorted.slice(
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
            <InputGroup className="max-w-sm">
              <InputGroupInput
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value)
                  setPage(1)
                }}
                placeholder="按分类名过滤，如 ads、cn、netflix"
                aria-label="按分类名过滤"
              />
              {keyword === "" ? null : (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="清除搜索"
                    onClick={() => {
                      setKeyword("")
                      setPage(1)
                    }}
                  >
                    <X aria-hidden="true" />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
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
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[60px]">
                      <HeaderHelp label="分类">
                        geosite.dat 里的分类名，内容来自上游 v2fly
                        清单；分类会随数据更新增删
                      </HeaderHelp>
                    </TableHead>
                    <TableHead className="min-w-[60px]">
                      <HeaderHelp label="个数">
                        该分类的域名条目数。页面只带前 30
                        条用于展示，多出的用「还有 N 条」标出
                      </HeaderHelp>
                    </TableHead>
                    <TableHead className="w-full min-w-[60px]">
                      <HeaderHelp label="域名">
                        每条包含类型（域名 / 根域 / 全匹配 /
                        正则）、值与属性。属性是上游标注，只有少数条目有，例如
                        TIKTOK 全部带 @!cn
                      </HeaderHelp>
                    </TableHead>
                  </TableRow>
                </TableHeader>
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
                              key={`${domain.type}-${domain.value}`}
                              className="inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs break-all"
                            >
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {DOMAIN_TYPE_LABEL[domain.type] ?? domain.type}
                              </span>
                              {domain.value}
                              {domain.attributes.length > 0 ? (
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {attributeText(domain.attributes)}
                                </span>
                              ) : null}
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
          <GeoPageNav
            page={currentPage}
            totalPages={totalPages}
            summary={`第 ${currentPage} / ${totalPages} 页 · 共 ${sorted.length} 个分类`}
            onChange={setPage}
          />
        </>
      )}
    </section>
  )
}
