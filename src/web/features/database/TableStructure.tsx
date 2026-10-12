import type { DatabaseColumn, DatabaseTable } from "@shared/api-contract"
import { Badge } from "@web/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@web/components/ui/item"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { COLUMN_AFFINITY_LABELS, formatColumnDefault } from "./format"

const OPERATION_LABELS = {
  read: "读取",
  insert: "新增",
  update: "修改",
  delete: "删除",
} as const

/** 字段能力：可写 / 不可写及原因。 */
const WriteCapability = (props: { column: DatabaseColumn }) => {
  if (props.column.write.allowed) return <span>可写</span>
  return <span>{props.column.write.message}</span>
}

const ColumnFlags = (props: { column: DatabaseColumn }) => (
  <div className="flex flex-wrap gap-1">
    {props.column.primaryKeyPosition > 0 ? (
      <Badge variant="secondary">主键 {props.column.primaryKeyPosition}</Badge>
    ) : null}
    {props.column.notNull ? <Badge variant="secondary">非空</Badge> : null}
    {props.column.generated ? <Badge variant="secondary">生成列</Badge> : null}
    {props.column.hidden ? <Badge variant="secondary">隐藏列</Badge> : null}
  </div>
)

const COLUMN_HEADERS = [
  "字段",
  "声明类型",
  "亲和性",
  "标记",
  "默认值",
  "写入",
] as const

/**
 * 表头列宽基准：短标记列给最小宽度，让「字段」这类内容列承接剩余宽度。
 *「默认值」与「写入」可能是长字面量或一整句话，保持可换行，不给 nowrap。
 */
const AUX_COLUMN_HEADERS = new Set(["声明类型", "亲和性", "标记"])

/**
 * 表结构：字段、主键、约束、默认值、生成列、外键与触发器。
 * 只读表在这里把「为什么不能写」直接展示出来，不留给用户猜。
 */
export const TableStructure = (props: { table: DatabaseTable }) => {
  const isDesktop = useIsDesktop()
  const { table } = props

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">表结构</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">对象类型</dt>
            <dd>{table.kind === "view" ? "视图" : "表"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">主键</dt>
            <dd>
              {table.constraints.primaryKey.length === 0
                ? "没有主键"
                : table.constraints.primaryKey.join("，")}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">存储</dt>
            <dd>{table.withoutRowId ? "WITHOUT ROWID" : "普通 rowid 表"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">结构签名</dt>
            <dd className="truncate font-mono text-xs" title={table.signature}>
              {table.signature}
            </dd>
          </div>
        </dl>

        <div className="space-y-1">
          <p className="text-muted-foreground">操作能力</p>
          <ul className="space-y-1">
            {table.capabilities.map((capability) => (
              <li key={capability.operation} className="flex flex-wrap gap-2">
                <span>{OPERATION_LABELS[capability.operation]}</span>
                {capability.allowed ? (
                  <Badge variant="secondary">允许</Badge>
                ) : (
                  <>
                    <Badge variant="outline">禁止</Badge>
                    <span className="text-muted-foreground">
                      {capability.message}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground">
            字段（{table.columns.length}）
          </p>
          {isDesktop ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMN_HEADERS.map((header) => (
                      <TableHead
                        key={header}
                        className={
                          AUX_COLUMN_HEADERS.has(header)
                            ? "w-[1%] whitespace-nowrap"
                            : undefined
                        }
                      >
                        {header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.columns.map((column) => (
                    <TableRow key={column.name}>
                      <TableCell className="font-medium">
                        {column.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {column.declaredType === ""
                          ? "（空）"
                          : column.declaredType}
                      </TableCell>
                      <TableCell>
                        {COLUMN_AFFINITY_LABELS[column.affinity]}
                      </TableCell>
                      <TableCell>
                        <ColumnFlags column={column} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatColumnDefault(column)}
                      </TableCell>
                      <TableCell>
                        <WriteCapability column={column} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <ItemGroup>
              {table.columns.map((column) => (
                <Item key={column.name} variant="outline">
                  <ItemContent>
                    <ItemTitle className="font-mono">{column.name}</ItemTitle>
                    <ItemDescription>
                      {column.declaredType === ""
                        ? "（空类型）"
                        : column.declaredType}
                      {" · "}
                      {COLUMN_AFFINITY_LABELS[column.affinity]}
                      {" · 默认值 "}
                      {formatColumnDefault(column)}
                      {" · "}
                      <WriteCapability column={column} />
                    </ItemDescription>
                    <ColumnFlags column={column} />
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>

        <dl className="grid gap-2 sm:grid-cols-2">
          {/* 短值：标签与值并排，不白占一行 */}
          <div className="flex gap-2">
            <dt className="text-muted-foreground">唯一约束</dt>
            <dd>
              {table.constraints.unique.length === 0
                ? "无"
                : table.constraints.unique
                    .map((item) => `${item.name}（${item.columns.join("，")}）`)
                    .join("；")}
            </dd>
          </div>
          {/* 值是长 SQL 片段（含 ON DELETE/ON UPDATE），保持标签在上、值换行 */}
          <div className="space-y-1">
            <dt className="text-muted-foreground">外键</dt>
            <dd>
              {table.constraints.foreignKeys.length === 0
                ? "无"
                : table.constraints.foreignKeys
                    .map(
                      (item) =>
                        `${item.columns.join("，")} → ${item.referencedTable}(${item.referencedColumns.join("，")}) ON DELETE ${item.onDelete} / ON UPDATE ${item.onUpdate}`
                    )
                    .join("；")}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">被引用（级联影响）</dt>
            <dd>
              {table.referencedBy.length === 0
                ? "无"
                : table.referencedBy
                    .map(
                      (item) =>
                        `${item.table}(${item.columns.join("，")}) ON DELETE ${item.onDelete}`
                    )
                    .join("；")}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">触发器</dt>
            <dd>
              {table.triggers.length === 0 ? "无" : table.triggers.join("，")}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
