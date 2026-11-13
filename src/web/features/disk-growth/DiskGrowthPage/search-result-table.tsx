import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { useSearch } from "@web/features/disk-growth/queries"
import { BranchRow } from "./tree-branch"

/** 关键词命中路径的平铺结果表：行结构与目录树一致，但不再展开。 */
export const SearchResultTable = (props: {
  scanId: number | null
  baselineScanId: number | null
  keyword: string
  view: "growth" | "size"
  onNotice: (message: string | null) => void
}) => {
  const { results } = useSearch({
    scanId: props.scanId,
    baselineScanId: props.baselineScanId,
    keyword: props.keyword,
  })
  const total = results.reduce((sum, entry) => sum + entry.size, 0)
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="min-w-72">名称</TableHead>
            <TableHead className="w-[1%] text-right whitespace-nowrap">
              大小
            </TableHead>
            {props.view === "size" ? (
              <TableHead className="w-[1%] text-right whitespace-nowrap">
                占比
              </TableHead>
            ) : (
              <TableHead className="w-[1%] text-right whitespace-nowrap">
                增长
              </TableHead>
            )}
            <TableHead className="w-1/3">路径</TableHead>
            <TableHead className="w-[1%] whitespace-nowrap text-right">
              操作
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((entry) => (
            <BranchRow
              key={entry.path}
              entry={entry}
              depth={0}
              open={false}
              view={props.view}
              ratio={total > 0 ? entry.size / total : 0}
              onToggle={() => undefined}
              onNotice={props.onNotice}
            />
          ))}
          {results.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10">
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>没有匹配的路径</EmptyTitle>
                    <EmptyDescription>换个关键字试试。</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}
