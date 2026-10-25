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
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { useClashVergeProfilesQuery } from "./queries"

/** 一条自定义分组规则：正则在节点名里匹配，捕获项取分组拼出新组名。 */
type GroupRule = { id: string; pattern: string; capture: string }

/** 单条规则命中某个节点后的结果。 */
type RuleMatch = { node: string; groups: string[]; target: string }

/** 预览列最多列出几条：这里只用于核对规则，不铺满整张表。 */
const PREVIEW_LIMIT = 10

/** 把捕获项里的 $1、$2 换成实际捕获组，其余字符原样保留。 */
const applyCapture = (capture: string, groups: string[]): string =>
  capture.replace(
    /\$(\d+)/g,
    (_, index: string) => groups[Number(index) - 1] ?? ""
  )

/** 在节点名上跑一条规则：正则非法或为空时返回空结果，不让界面崩。 */
const matchRule = (rule: GroupRule, nodeNames: string[]): RuleMatch[] => {
  const pattern = rule.pattern.trim()
  if (pattern === "") return []
  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch {
    return []
  }
  const matches: RuleMatch[] = []
  for (const node of nodeNames) {
    const result = regex.exec(node)
    if (!result) continue
    const groups = result.slice(1).map((value) => value ?? "")
    matches.push({ node, groups, target: applyCapture(rule.capture, groups) })
  }
  return matches
}

/**
 * 预览单元格：去重后最多列 PREVIEW_LIMIT 条，超出只报总数。
 * tags 用于节点名，与订阅表保持同一种标签样式；组名用纯文本。
 */
const PreviewList = (props: {
  items: string[]
  empty: string
  tags?: boolean
}) => {
  const items = [...new Set(props.items)]
  if (items.length === 0) {
    return <span className="text-muted-foreground">{props.empty}</span>
  }
  const overflow = items.length > PREVIEW_LIMIT
  return (
    <span
      className={
        props.tags ? "flex flex-wrap items-center gap-1" : "block space-y-0.5"
      }
    >
      {items.slice(0, PREVIEW_LIMIT).map((item) =>
        props.tags ? (
          <span
            key={item}
            className="inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 text-xs break-all"
          >
            {item}
          </span>
        ) : (
          <span key={item} className="block break-all">
            {item}
          </span>
        )
      )}
      {overflow ? (
        <span
          className={
            props.tags ? "text-muted-foreground" : "block text-muted-foreground"
          }
        >
          {`…共 ${items.length} 条`}
        </span>
      ) : null}
    </span>
  )
}

/**
 * 合并订阅：勾选要合并的订阅，再写自定义分组规则。
 *
 * 规则表第三列显示正则命中的节点名，第四列显示按捕获项拼出的目标组名，
 * 用于边写边核对；预览只读已勾选订阅的节点名，不写任何文件。
 * 合并写入还没定稿，按钮只回显范围。
 */
export const MergeProfilesPanel = () => {
  const query = useClashVergeProfilesQuery()
  const profiles = useMemo(() => query.data?.profiles ?? [], [query.data])
  const [selected, setSelected] = useState<string[]>([])
  const [rules, setRules] = useState<GroupRule[]>([])

  const chosen = useMemo(
    () => profiles.filter((profile) => selected.includes(profile.uid)),
    [profiles, selected]
  )
  const nodeNames = useMemo(
    () => chosen.flatMap((profile) => profile.nodes.map((node) => node.name)),
    [chosen]
  )
  const previews = useMemo(
    () => rules.map((rule) => matchRule(rule, nodeNames)),
    [rules, nodeNames]
  )
  const nodeTotal = chosen.reduce(
    (total, profile) => total + profile.nodes.length,
    0
  )

  const toggle = (uid: string, checked: boolean) => {
    setSelected((current) =>
      checked
        ? [...current.filter((item) => item !== uid), uid]
        : current.filter((item) => item !== uid)
    )
  }

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
              <TableHead className="min-w-[60px]">
                <span className="sr-only">选择</span>
              </TableHead>
              <TableHead className="min-w-[60px]">订阅</TableHead>
              <TableHead className="min-w-[60px]">节点数</TableHead>
              <TableHead className="w-full min-w-[60px]">节点</TableHead>
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
                <TableCell className="text-left text-muted-foreground tabular-nums">
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
            正则在节点名里匹配，捕获项用 $1、$2
            取分组；右侧实时显示命中的节点与目标组名
          </p>
          {chosen.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              先在上面勾选订阅，预览才有可匹配的节点
            </p>
          ) : null}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[120px]">正则</TableHead>
              <TableHead className="min-w-[100px]">捕获项</TableHead>
              <TableHead className="w-full min-w-[60px]">匹配节点</TableHead>
              <TableHead className="min-w-[60px]">目标组名</TableHead>
              <TableHead className="min-w-[60px]">
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground whitespace-normal"
                >
                  还没有规则
                </TableCell>
              </TableRow>
            ) : (
              rules.map((rule, index) => {
                const matches = previews[index] ?? []
                return (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <Input
                        value={rule.pattern}
                        aria-label={`第 ${index + 1} 条规则的正则`}
                        placeholder="例如 ^(.+?)\|"
                        onChange={(event) =>
                          updateRule(rule.id, { pattern: event.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={rule.capture}
                        aria-label={`第 ${index + 1} 条规则的捕获项`}
                        placeholder="例如 $1"
                        onChange={(event) =>
                          updateRule(rule.id, { capture: event.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell className="w-full align-top text-xs whitespace-normal">
                      <PreviewList
                        tags
                        items={matches.map((match) => match.node)}
                        empty={
                          rule.pattern.trim() === ""
                            ? "等待填写正则"
                            : "没有匹配的节点"
                        }
                      />
                    </TableCell>
                    <TableCell className="align-top text-xs whitespace-normal">
                      <PreviewList
                        items={[
                          ...new Set(
                            matches
                              .map((match) => match.target)
                              .filter((target) => target !== "")
                          ),
                        ]}
                        empty={
                          rule.capture.trim() === ""
                            ? "等待填写捕获项"
                            : "没有可用的组名"
                        }
                      />
                    </TableCell>
                    <TableCell className="w-full">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`删除第 ${index + 1} 条分组规则`}
                        onClick={() => removeRule(rule.id)}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>

        <Button variant="outline" size="sm" onClick={addRule}>
          添加分组规则
        </Button>
      </div>
    </section>
  )
}
