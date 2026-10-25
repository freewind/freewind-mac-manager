import { describeError } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
import { Input } from "@web/components/ui/input"
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

/** 一条自定义分组规则：正则在节点名里匹配，捕获项取分组拼出新名字。 */
type GroupRule = { id: string; pattern: string; capture: string }

/**
 * 合并订阅：本轮只做选择界面（勾选订阅、看各自节点数量）。
 * 合并结果要写到哪里、怎么和全局 Merge 叠加还没定，按钮先只回显范围，
 * 不写任何文件，避免造出半个可用状态。
 *
 * 自定义分组规则只提供编辑界面：不读任何节点内容、不做预览，
 * 写成通用规则由合并逻辑使用。
 */
export const MergeProfilesPanel = () => {
  const query = useClashVergeProfilesQuery()
  const profiles = query.data?.profiles ?? []
  const [selected, setSelected] = useState<string[]>([])
  const [rules, setRules] = useState<GroupRule[]>([])

  const addRule = () => {
    setRules((current) => [
      ...current,
      { id: crypto.randomUUID(), pattern: "", capture: "" },
    ])
  }

  const updateRule = (id: string, patch: Partial<GroupRule>) => {
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    )
  }

  const removeRule = (id: string) => {
    setRules((current) => current.filter((rule) => rule.id !== id))
  }

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
              <TableHead>节点数</TableHead>
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
                <TableCell className="text-left tabular-nums text-muted-foreground">
                  {profile.nodes.length}
                </TableCell>
                <TableCell className="w-full text-left whitespace-normal text-muted-foreground">
                  {profile.nodes.length === 0 ? (
                    "（没有节点）"
                  ) : (
                    <span className="flex flex-wrap items-center gap-1">
                      {profile.nodes.map((node) => (
                        <span
                          key={`${node.name}-${node.server}`}
                          className="inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 text-xs break-all"
                        >
                          {node.name}
                        </span>
                      ))}
                    </span>
                  )}
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

      <div className="space-y-2 border-t pt-3">
        <div>
          <h3 className="text-sm font-medium">自定义分组规则</h3>
          <p className="text-xs text-muted-foreground">
            每行一条：左边填正则去匹配节点名，右边填捕获项（如 $1、$2）
          </p>
        </div>

        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有规则</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule, index) => (
              <li
                key={rule.id}
                className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
              >
                <Input
                  value={rule.pattern}
                  aria-label={`第 ${index + 1} 条规则的正则`}
                  placeholder="正则，例如 ^(.+?)\\|"
                  onChange={(event) =>
                    updateRule(rule.id, { pattern: event.target.value })
                  }
                />
                <Input
                  value={rule.capture}
                  aria-label={`第 ${index + 1} 条规则的捕获项`}
                  placeholder="捕获项，例如 $1"
                  onChange={(event) =>
                    updateRule(rule.id, { capture: event.target.value })
                  }
                />
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`删除第 ${index + 1} 条分组规则`}
                  onClick={() => removeRule(rule.id)}
                >
                  删除
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Button variant="outline" size="sm" onClick={addRule}>
          添加分组规则
        </Button>
      </div>
    </section>
  )
}
