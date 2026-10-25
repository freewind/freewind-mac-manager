import { describeError } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { useState } from "react"
import { toast } from "sonner"
import { useClashVergeProfilesQuery } from "./queries"

/**
 * 合并订阅：本轮只做选择界面（勾选订阅、看各自节点数量）。
 * 合并结果要写到哪里、怎么和全局 Merge 叠加还没定，按钮先只回显范围，
 * 不写任何文件，避免造出半个可用状态。
 */
export const MergeProfilesPanel = () => {
  const query = useClashVergeProfilesQuery()
  const profiles = query.data?.profiles ?? []
  const [selected, setSelected] = useState<string[]>([])

  const toggle = (uid: string, checked: boolean) => {
    setSelected((current) =>
      checked
        ? [...current.filter((item) => item !== uid), uid]
        : current.filter((item) => item !== uid)
    )
  }

  const chosen = profiles.filter((profile) => selected.includes(profile.uid))
  const nodeTotal = chosen.reduce(
    (total, profile) => total + profile.nodes.length,
    0
  )

  const merge = () => {
    toast.message(
      `合并写入还没实现：已选 ${chosen.length} 个订阅、${nodeTotal} 个节点`
    )
  }

  return (
    <section className="space-y-3" aria-label="合并订阅">
      <div>
        <h2 className="text-sm font-medium">合并订阅</h2>
        <p className="text-xs text-muted-foreground">
          勾选要合并的订阅，合并后这些订阅的节点会写进同一份配置
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">正在读取订阅清单…</p>
      ) : null}

      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>读取订阅清单失败</AlertTitle>
          <AlertDescription>{describeError(query.error)}</AlertDescription>
        </Alert>
      ) : null}

      {!query.isLoading && profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有可合并的订阅</p>
      ) : null}

      {profiles.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <span className="sr-only">选择</span>
              </TableHead>
              <TableHead>订阅</TableHead>
              <TableHead className="w-full">节点</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.map((profile) => (
              <TableRow key={profile.uid || profile.url}>
                <TableCell>
                  <Checkbox
                    aria-label={`选择订阅：${profile.name}`}
                    checked={selected.includes(profile.uid)}
                    onCheckedChange={(checked) => toggle(profile.uid, checked)}
                  />
                </TableCell>
                <TableCell className="text-left">{profile.name}</TableCell>
                <TableCell className="w-full text-left whitespace-normal text-muted-foreground">
                  {profile.nodes.length === 0
                    ? "（没有节点）"
                    : `${profile.nodes.length} 个：${profile.nodes
                        .map((node) => node.name)
                        .join("、")}`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={chosen.length < 2} onClick={merge}>
          合并订阅
        </Button>
        <span className="text-xs text-muted-foreground">
          {chosen.length < 2
            ? "至少选 2 个订阅"
            : `已选 ${chosen.length} 个订阅、${nodeTotal} 个节点`}
        </span>
      </div>
    </section>
  )
}
