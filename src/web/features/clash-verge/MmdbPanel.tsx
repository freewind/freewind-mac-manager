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
import { type ReactNode, useState } from "react"
import { bytesText, GeoIntro, HeaderHelp } from "./geo-shared"
import { useClashVergeAsnQuery, useClashVergeCountryQuery } from "./queries"

type MmdbQuery = ReturnType<typeof useClashVergeCountryQuery>

/** 顶部简介：两份文件的目的不同，各写一段。 */
const INTROS: Record<"country" | "asn", ReactNode> = {
  country: (
    <>
      <p>
        Country.mmdb 是 IP 网段 → 国家的对照表，来自 MaxMind 的 GeoLite2-Country
        库。每一行是一个国家与它名下的一部分网段。
      </p>
      <p>
        怎么用：模板里没写 geodata-mode 时，内核默认用它做 GEOIP 判定； 配置里的
        GEOIP,CN,DIRECT 查的就是这张表。和 geoip.dat 目的相同、来源不同， 同一个
        IP 在两份数据里偶尔会判成不同国家，规则效果因此可能不一样。
      </p>
      <p>
        也可以用来看：某个 IP 在这里属于哪个国家。与网页查询结果不一致时，
        多半是两边用的库不同。
      </p>
      <p>
        由 Clash Verge 下载到本机，在 Clash Verge 里点一次「更新 GEO
        数据」即可更新。
      </p>
    </>
  ),
  asn: (
    <>
      <p>
        ASN.mmdb 是 IP 网段 → 自治系统（ASN）与运营组织的对照表，例如
        1.48.0.0/18 属于 AS4134 Chinanet（中国电信）。
      </p>
      <p>
        怎么用：可以按运营商或 IP 归属分流（例如 IP-ASN,4134,DIRECT 走直连）；
        也可以拿来查某个 IP 属于哪家运营商、哪家云厂商，从而判断一个节点是家宽
        还是机房 IP。
      </p>
      <p>
        数据来自 MaxMind 的 GeoLite2-ASN 免费库，由 Clash Verge
        下载到本机，点一次「更新 GEO 数据」即可更新。
      </p>
    </>
  ),
}

/** 两个页面只有分组的含义不同，其余展示完全一致。 */
const LABELS = {
  country: {
    aria: "Country.mmdb",
    key: "国家码",
    keyHelp: "Country.mmdb 里的 ISO 国家码；取不到国家时归到「未知」",
    label: "国家",
    labelHelp: "数据库里该国家的英文名，与内核判断无关，只是方便认",
    title: "Country.mmdb",
    loading: "正在遍历 Country.mmdb…",
    failed: "读取 Country.mmdb 失败",
    unit: "个国家",
  },
  asn: {
    aria: "ASN.mmdb",
    key: "ASN",
    keyHelp: "ASN 编号，如 AS4134；内核的 src/dst IP 归属会落到这里",
    label: "组织",
    labelHelp: "该 ASN 的注册组织名，数据库没写时为空",
    title: "ASN.mmdb",
    loading: "正在遍历 ASN.mmdb（八万多个 ASN，首次较慢）…",
    failed: "读取 ASN.mmdb 失败",
    unit: "个 ASN",
  },
} as const

/**
 * mmdb 数据面板（只读）：按国家或 ASN 聚合的网段表。
 * 文件是 MaxMind DB 格式，内核的 GEOIP 判定在 geodata-mode 关闭时用的就是
 * Country.mmdb。全库有两三百万条网段，服务端按网段数取前 500 个分组，
 * 每组带前 30 条网段。
 */
const MmdbView = (props: { kind: "country" | "asn"; query: MmdbQuery }) => {
  const labels = LABELS[props.kind]
  const data = props.query.data
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE)

  const needle = keyword.trim().toLowerCase()
  const filtered =
    data === undefined
      ? []
      : needle === ""
        ? data.groups
        : data.groups.filter(
            (item) =>
              item.key.toLowerCase().includes(needle) ||
              item.label.toLowerCase().includes(needle)
          )

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  return (
    <section className="space-y-3" aria-label={labels.aria}>
      <GeoIntro>{INTROS[props.kind]}</GeoIntro>
      {props.query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{labels.failed}</AlertTitle>
          <AlertDescription>
            {describeError(props.query.error)}
          </AlertDescription>
        </Alert>
      ) : null}
      {data === undefined ? (
        <p className="text-sm text-muted-foreground">{labels.loading}</p>
      ) : (
        <>
          <p className="text-xs break-all text-muted-foreground">
            {`${data.path} · ${bytesText(data.size)} · 更新于 ${formatTimestamp(data.modified)}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {`${data.meta.databaseType} · 构建于 ${formatTimestamp(data.meta.buildTime)} · 检索树 ${data.meta.nodeCount} 个节点 · IPv${data.meta.ipVersion} · ${data.meta.languages.length} 种语言`}
          </p>
          <p className="text-sm">
            {`共 ${data.totalNetworks} 条网段、${data.totalGroups} ${labels.unit}；下表按网段数取前 ${data.groups.length} 个`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="max-w-sm">
              <InputGroupInput
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value)
                  setPage(1)
                }}
                placeholder={`按${labels.key}或${labels.label}过滤`}
                aria-label={`按${labels.key}或${labels.label}过滤`}
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
            <p className="text-sm text-muted-foreground">
              {`没有匹配的${labels.key}`}
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[80px]">
                      <HeaderHelp label={labels.key}>
                        {labels.keyHelp}
                      </HeaderHelp>
                    </TableHead>
                    <TableHead className="min-w-[60px]">
                      <HeaderHelp label={labels.label}>
                        {labels.labelHelp}
                      </HeaderHelp>
                    </TableHead>
                    <TableHead className="min-w-[60px]">
                      <HeaderHelp label="网段数">
                        该分组在数据库里的网段条数。页面只带前 30 条用于展示
                      </HeaderHelp>
                    </TableHead>
                    <TableHead className="w-full min-w-[60px]">
                      <HeaderHelp label="网段">
                        前若干条 CIDR。同一分组在库里是分散的多段地址，
                        这里按库内顺序列出
                      </HeaderHelp>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((group) => (
                    <TableRow key={group.key}>
                      <TableCell className="min-w-[80px] px-2 py-1 align-top text-left font-mono text-xs">
                        {group.key}
                      </TableCell>
                      <TableCell className="min-w-[60px] px-2 py-1 align-top text-left text-xs">
                        {group.label === "" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          group.label
                        )}
                      </TableCell>
                      <TableCell className="min-w-[60px] px-2 py-1 align-top text-left text-muted-foreground tabular-nums">
                        {group.count}
                      </TableCell>
                      <TableCell className="w-full min-w-[60px] px-2 py-1 align-top text-left">
                        <span className="flex flex-wrap gap-1">
                          {group.preview.map((cidr) => (
                            <span
                              key={cidr}
                              className="inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 font-mono text-xs break-all"
                            >
                              {cidr}
                            </span>
                          ))}
                          {group.count > group.preview.length ? (
                            <span className="inline-flex items-center rounded-md border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground">
                              {`还有 ${group.count - group.preview.length} 条`}
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
              {`共 ${filtered.length} ${labels.unit}`}
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

/** Country.mmdb 页面。 */
export const CountryPanel = () => (
  <MmdbView kind="country" query={useClashVergeCountryQuery()} />
)

/** ASN.mmdb 页面。 */
export const AsnPanel = () => (
  <MmdbView kind="asn" query={useClashVergeAsnQuery()} />
)
