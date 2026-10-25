import { describeError, formatTimestamp } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
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
import {
  useClashMergeConfigQuery,
  useClashVergeProfilesQuery,
  useSaveClashMergeConfig,
} from "./queries"

/** 一条自定义分组规则：正则在节点名里匹配，目标组名直接填写。 */
type GroupRule = {
  id: string
  pattern: string
  target: string
  fixed?: boolean
}

/** 兜底规则：固定目标组名「其他」，不可删除，聚合其余规则没命中的节点。 */
const FALLBACK_RULE: GroupRule = {
  id: "fallback",
  pattern: "",
  target: "其他",
  fixed: true,
}

/** 在节点名上跑一条规则：正则非法或为空时返回空结果，不让界面崩。 */
const matchNodes = (pattern: string, nodeNames: string[]): string[] => {
  const trimmed = pattern.trim()
  if (trimmed === "") return []
  let regex: RegExp
  try {
    regex = new RegExp(trimmed)
  } catch {
    return []
  }
  return nodeNames.filter((node) => regex.exec(node) !== null)
}

/** 节点标签：与订阅表同一种样式；没有节点时留空，不占位。 */
const NodeTags = (props: { nodes: string[] }) => {
  if (props.nodes.length === 0) return null
  return (
    <span className="flex flex-wrap items-center gap-1">
      {props.nodes.map((node) => (
        <span
          key={node}
          className="inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 text-xs break-all"
        >
          {node}
        </span>
      ))}
    </span>
  )
}

/**
 * 合并订阅：勾选要合并的订阅，再写自定义分组规则。
 *
 * 规则表第二列显示正则命中的节点，第三列直接填目标组名，方便边写边核对；
 * 末尾固定一条兜底规则，把其余没被任何规则命中的节点归到「其他」。
 * 预览只读已勾选订阅的节点名，不写任何文件；合并写入还没定稿，按钮只回显范围。
 */
export const MergeProfilesPanel = () => {
  const query = useClashVergeProfilesQuery()
  const configQuery = useClashMergeConfigQuery()
  const saveConfig = useSaveClashMergeConfig()
  const profiles = useMemo(() => query.data?.profiles ?? [], [query.data])
  /** 只记住本地勾选；选中的订阅不保存，每次进来重新勾。 */
  const [editedSelected, setEditedSelected] = useState<string[]>([])
  const [editedRules, setEditedRules] = useState<GroupRule[] | null>(null)
  const selected = editedSelected
  const rules = useMemo<GroupRule[]>(
    () =>
      editedRules ?? [
        FALLBACK_RULE,
        ...(configQuery.data?.rules ?? []).map((rule, index) => ({
          ...rule,
          id: `saved-${index}`,
        })),
      ],
    [editedRules, configQuery.data]
  )

  const chosen = useMemo(
    () => profiles.filter((profile) => selected.includes(profile.uid)),
    [profiles, selected]
  )
  const nodeNames = useMemo(
    () => [
      ...new Set(
        chosen.flatMap((profile) => profile.nodes.map((node) => node.name))
      ),
    ],
    [chosen]
  )
  const previews = useMemo(
    () => rules.map((rule) => matchNodes(rule.pattern, nodeNames)),
    [rules, nodeNames]
  )
  /** 还没被任何规则命中的节点：兜底规则兜的就是它们。 */
  const unmatchedNodes = useMemo(() => {
    const matched = new Set(previews.flat())
    return nodeNames.filter((name) => !matched.has(name))
  }, [nodeNames, previews])
  const nodeTotal = chosen.reduce(
    (total, profile) => total + profile.nodes.length,
    0
  )

  const toggle = (uid: string, checked: boolean) => {
    setEditedSelected(
      checked
        ? [...selected.filter((item) => item !== uid), uid]
        : selected.filter((item) => item !== uid)
    )
  }

  const addRule = () => {
    // 兜底行固定在表头下方第一行，新规则追加到末尾。
    const fixed = rules.filter((rule) => rule.fixed)
    const normal = rules.filter((rule) => !rule.fixed)
    setEditedRules([
      ...fixed,
      ...normal,
      { id: crypto.randomUUID(), pattern: "", target: "" },
    ])
  }

  const updateRule = (id: string, patch: Partial<GroupRule>) => {
    setEditedRules(
      rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    )
  }

  const removeRule = (id: string) => {
    setEditedRules(rules.filter((rule) => rule.id !== id))
  }

  const merge = () => {
    toast.message(
      `合并写入还没实现：已选 ${chosen.length} 个订阅、${nodeTotal} 个节点`
    )
  }

  /** 保存到服务端：只存用户填的正则与目标组名，兑底行与订阅选择都不存。 */
  const save = async () => {
    try {
      const result = await saveConfig.mutateAsync({
        rules: rules
          .filter((rule) => !rule.fixed)
          .map((rule) => ({ pattern: rule.pattern, target: rule.target })),
      })
      toast.success(result.message)
    } catch (error) {
      toast.error(describeError(error))
    }
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
                    <NodeTags nodes={profile.nodes.map((node) => node.name)} />
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
            正则在节点名里匹配，右侧列出命中的节点；目标组名直接填。最后一行固定兜底，其余节点归到「其他」
          </p>
          <p className="text-xs text-muted-foreground">
            {configQuery.data?.updatedAt
              ? `上次保存：${formatTimestamp(configQuery.data.updatedAt)}`
              : "尚未保存到服务端"}
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
              <TableHead className="w-full min-w-[60px]">匹配节点</TableHead>
              <TableHead className="min-w-[120px]">目标组名</TableHead>
              <TableHead className="min-w-[60px]">
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule, index) => {
              if (rule.fixed) {
                return (
                  <TableRow key={rule.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      其余未匹配的节点
                    </TableCell>
                    <TableCell className="align-top text-xs whitespace-normal">
                      <NodeTags nodes={unmatchedNodes} />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={rule.target}
                        disabled
                        aria-label="兜底分组的目标组名"
                      />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                )
              }
              const matches = previews[index] ?? []
              return (
                <TableRow key={rule.id}>
                  <TableCell>
                    <Input
                      value={rule.pattern}
                      aria-label={`第 ${index + 1} 条规则的正则`}
                      placeholder="例如 香港"
                      onChange={(event) =>
                        updateRule(rule.id, { pattern: event.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell className="align-top text-xs whitespace-normal">
                    <NodeTags nodes={matches} />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={rule.target}
                      aria-label={`第 ${index + 1} 条规则的目标组名`}
                      placeholder="例如 香港"
                      onChange={(event) =>
                        updateRule(rule.id, { target: event.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
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
            })}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={addRule}>
            添加分组规则
          </Button>
          <ActionButton
            size="sm"
            busy={saveConfig.isPending}
            busyLabel="保存中…"
            onClick={() => void save()}
          >
            保存分组设置
          </ActionButton>
          {configQuery.isError ? (
            <span className="text-xs text-destructive">
              {`读取已保存设置失败：${describeError(configQuery.error)}`}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  )
}
