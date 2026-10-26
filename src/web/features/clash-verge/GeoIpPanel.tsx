import { describeError, formatTimestamp } from "@shared/format"
import {
  TABLE_PAGE_SIZE,
  TablePagination,
} from "@web/components/TablePagination"
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
import { bytesText, GeoIntro, HeaderHelp } from "./geo-shared"
import { useClashVergeGeoipQuery } from "./queries"

/**
 * geoip.dat 面板（只读）：每个国家一行，列出前几条网段。
 * 与 geosite.dat 同一份来源（Clash Verge 下载维护），内核的 GEOIP 规则
 * 在 geodata-mode 打开时用的就是它。
 * 全库有 100 多万条网段，服务端只给前 30 条，其余用「还有 N 条」标出。
 */
export const GeoIpPanel = () => {
  const query = useClashVergeGeoipQuery()
  const data = query.data
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE)

  const needle = keyword.trim().toLowerCase()
  const filtered =
    data === undefined
      ? []
      : needle === ""
        ? data.categories
        : data.categories.filter((item) =>
            item.code.toLowerCase().includes(needle)
          )

  // 默认按网段数从多到少：网段最多的国家往往就是常看的。
  // 复制一份再排，不改动查询缓存里的原数组。
  const sorted = [...filtered].sort((left, right) => right.count - left.count)

  // 搜索把结果变短时页码可能越界，按当前总页数夹一下，不再额外存一份状态。
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = sorted.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  return (
    <section className="space-y-3" aria-label="geoip 数据库">
      <GeoIntro>
        <p>
          geoip.dat 是 IP 网段对照表：每一条记录一段 IP 属于哪个国家或区域，
          例如 1.0.1.0/24 属于 CN。
        </p>
        <p>
          怎么用：配置里写 GEOIP,CN,DIRECT 时，内核拿目标 IP 与这张表比对， 命中
          CN 就走直连。嗅探不到域名的连接（纯 IP 访问）靠它才不会误走代理。
        </p>
        <p>
          它只在模板里写了 geodata-mode: true 时才被内核使用；没开时走
          Country.mmdb。两份数据来源不同，同一个 IP 偶尔会判成不同国家。
        </p>
        <p>
          数据由 MetaCubeX 汇总发布，Clash Verge 下载到本机； 在 Clash Verge
          里点一次「更新 GEO 数据」即可更新。
        </p>
      </GeoIntro>
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>读取 geoip 数据库失败</AlertTitle>
          <AlertDescription>{describeError(query.error)}</AlertDescription>
        </Alert>
      ) : null}
      {data === undefined ? (
        <p className="text-sm text-muted-foreground">正在解析 geoip 数据库…</p>
      ) : (
        <>
          <p className="text-xs break-all text-muted-foreground">
            {`${data.path} · ${bytesText(data.size)} · 更新于 ${formatTimestamp(data.modified)}`}
          </p>
          <p className="text-sm">
            {`共 ${data.totalCategories} 个国家/区域、${data.totalCidrs} 条网段`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="max-w-sm">
              <InputGroupInput
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value)
                  setPage(1)
                }}
                placeholder="按国家码过滤，如 cn、us、jp"
                aria-label="按国家码过滤"
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
            <p className="text-sm text-muted-foreground">没有匹配的国家码</p>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              {/* 表格统一规则：前两列按内容宽度，最后一列占满剩余。 */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[60px]">
                      <HeaderHelp label="国家码">
                        geoip.dat 里的分类名，一般是 ISO 国家码；另有 private
                        这类自定义分类
                      </HeaderHelp>
                    </TableHead>
                    <TableHead className="min-w-[60px]">
                      <HeaderHelp label="网段数">
                        该分类的 CIDR 条目数。页面只带前 30
                        条用于展示，多出的用「还有 N 条」标出
                      </HeaderHelp>
                    </TableHead>
                    <TableHead className="w-full min-w-[60px]">
                      <HeaderHelp label="网段">
                        前若干条 CIDR。内核的 GEOIP 判定就是拿目标 IP
                        与这些网段比对
                      </HeaderHelp>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((category) => (
                    <TableRow key={category.code}>
                      <TableCell className="min-w-[60px] px-2 py-1 align-top text-left font-mono text-xs">
                        {category.code}
                      </TableCell>
                      <TableCell className="min-w-[60px] px-2 py-1 align-top text-left text-muted-foreground tabular-nums">
                        {category.count}
                      </TableCell>
                      <TableCell className="w-full min-w-[60px] px-2 py-1 align-top text-left">
                        <span className="flex flex-wrap gap-1">
                          {category.preview.map((cidr) => (
                            <span
                              key={cidr}
                              className="inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 font-mono text-xs break-all"
                            >
                              {cidr}
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
              {`共 ${sorted.length} 个国家/区域`}
            </span>
            <TablePagination
              page={currentPage}
              pageCount={totalPages}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setPageSize(next)
                setPage(1)
              }}
            />
          </div>
        </>
      )}
    </section>
  )
}
