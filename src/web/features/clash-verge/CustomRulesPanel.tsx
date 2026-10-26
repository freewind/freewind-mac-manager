import type { CustomRule } from "@shared/api-contract"
import { customRuleTargetRank } from "@shared/clash-merge-defaults"
import { describeError } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Input } from "@web/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@web/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@web/components/ui/tabs"
import { CircleHelp, Plus } from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import { useClashMergeConfigQuery, useSaveClashMergeConfig } from "./queries"

/** 一行自定义规则：类型 + 值 + 出口，id 只用于 React key。 */
type CustomRow = CustomRule & { id: string }

/** 可选的规则类型：只开常用的三种。 */
const CUSTOM_RULE_TYPES: CustomRule["type"][] = [
  "DOMAIN-SUFFIX",
  "DOMAIN",
  "DOMAIN-KEYWORD",
]

/** 内置出口别名：其余选项是本次合并生成的分组名。 */
const CUSTOM_TARGET_ALIASES: Record<string, string> = {
  proxy: "走代理",
  direct: "直连",
  reject: "拒绝",
}

/** 四个分区：顺序就是写进配置的顺序。 */
const BUCKETS = [
  { key: "reject", label: "拒绝" },
  { key: "direct", label: "直连" },
  { key: "group", label: "特定组" },
  { key: "proxy", label: "走代理" },
] as const

type Bucket = (typeof BUCKETS)[number]["key"]

/** 出口决定它落在哪个分区：顺序与 customRuleTargetRank 一致。 */
const BUCKET_BY_RANK: Bucket[] = ["reject", "direct", "group", "proxy"]
const bucketOf = (target: string): Bucket =>
  BUCKET_BY_RANK[customRuleTargetRank(target)]

/** 三种规则类型的含义，放在类型列的问号里。 */
const RULE_TYPE_NOTES = [
  { type: "DOMAIN", meaning: "只匹配这个域名本身，不含子域名" },
  { type: "DOMAIN-SUFFIX", meaning: "匹配这个域名及其所有子域名" },
  { type: "DOMAIN-KEYWORD", meaning: "域名里包含这个词就命中" },
]

/**
 * 单行规则：每个分区都可能上千行，输入时只重渲染被改的那一行，
 * 否则每敲一个字符都要重渲染整表，手机直接卡住。
 */
const CustomRuleRow = memo(
  (props: {
    rule: CustomRow
    index: number
    targetOptions: string[]
    onChange: (id: string, patch: Partial<CustomRule>) => void
    onRemove: (id: string) => void
  }) => (
    <TableRow>
      <TableCell className="text-left">
        <Select
          value={props.rule.type}
          onValueChange={(next) =>
            props.onChange(props.rule.id, {
              type: next as CustomRule["type"],
            })
          }
        >
          <SelectTrigger aria-label={`第 ${props.index + 1} 条规则的类型`}>
            <SelectValue>{props.rule.type}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CUSTOM_RULE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-left">
        <Input
          value={props.rule.value}
          placeholder="example.com"
          aria-label={`第 ${props.index + 1} 条规则的值`}
          onChange={(event) =>
            props.onChange(props.rule.id, { value: event.target.value })
          }
        />
      </TableCell>
      <TableCell className="text-left">
        <Select
          value={props.rule.target}
          onValueChange={(next) =>
            props.onChange(props.rule.id, { target: next ?? props.rule.target })
          }
        >
          <SelectTrigger aria-label={`第 ${props.index + 1} 条规则的出口`}>
            <SelectValue>
              {CUSTOM_TARGET_ALIASES[props.rule.target] ?? props.rule.target}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CUSTOM_TARGET_ALIASES).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
            {props.targetOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-left">
        <Button
          variant="outline"
          size="sm"
          aria-label={`删除第 ${props.index + 1} 条规则`}
          onClick={() => props.onRemove(props.rule.id)}
        >
          删除
        </Button>
      </TableCell>
    </TableRow>
  )
)

/**
 * 自定义域名规则：命中就走指定出口，排在模板里的固定分流规则之前。
 *
 * 按出口分四个分区展示（拒绝 → 直连 → 特定组 → 走代理），合并时也按这个顺序
 * 写进配置：先挡掉广告，再让该直连的别绕路，最后才是走代理与指定地区组。
 */
export const CustomRulesPanel = () => {
  const configQuery = useClashMergeConfigQuery()
  const saveConfig = useSaveClashMergeConfig()
  const [edited, setEdited] = useState<CustomRow[] | null>(null)
  const [bucket, setBucket] = useState<Bucket>("reject")

  const savedRows = useMemo<CustomRow[]>(
    () =>
      (configQuery.data?.customRules ?? []).map((rule, index) => ({
        ...rule,
        id: `saved-custom-${index}`,
      })),
    [configQuery.data]
  )
  const rows = edited ?? savedRows

  /** 可选的具体分组名：来自分组规则里的目标组名，去重且不含内置别名。 */
  const targetOptions = useMemo(() => {
    const names = new Set<string>()
    for (const rule of configQuery.data?.rules ?? []) {
      const name = rule.target.trim()
      if (name !== "" && !(name in CUSTOM_TARGET_ALIASES)) names.add(name)
    }
    return [...names]
  }, [configQuery.data])

  /** 当前分区显示的行：库里的顺序保持不变。 */
  const visible = useMemo(
    () => rows.filter((rule) => bucketOf(rule.target) === bucket),
    [rows, bucket]
  )

  const counts = useMemo(() => {
    const result: Record<Bucket, number> = {
      reject: 0,
      direct: 0,
      group: 0,
      proxy: 0,
    }
    for (const rule of rows) result[bucketOf(rule.target)] += 1
    return result
  }, [rows])

  /** 只比实际写进配置的内容：值为空的行会被丢掉，不参与比较。 */
  const dirty = useMemo(() => {
    const saved = configQuery.data
    if (saved === undefined) return false
    const shape = (list: CustomRow[] | CustomRule[]): string =>
      JSON.stringify(
        list
          .filter((rule) => rule.value.trim() !== "")
          .map((rule) => ({
            type: rule.type,
            value: rule.value,
            target: rule.target,
          }))
      )
    return shape(rows) !== shape(saved.customRules)
  }, [rows, configQuery.data])

  const onChange = useCallback(
    (id: string, patch: Partial<CustomRule>) => {
      setEdited((current) =>
        (current ?? savedRows).map((rule) =>
          rule.id === id ? { ...rule, ...patch } : rule
        )
      )
    },
    [savedRows]
  )

  const onRemove = useCallback(
    (id: string) => {
      setEdited((current) =>
        (current ?? savedRows).filter((rule) => rule.id !== id)
      )
    },
    [savedRows]
  )

  /** 新规则跟着当前分区走，省得再加一次出口。 */
  const add = () => {
    const target = bucket === "group" ? (targetOptions[0] ?? "proxy") : bucket
    setEdited([
      ...rows,
      { id: crypto.randomUUID(), type: "DOMAIN-SUFFIX", value: "", target },
    ])
  }

  /** 保存只提交这一页的内容：其余字段原样带回去，不做局部更新接口。 */
  const save = async () => {
    const saved = configQuery.data
    if (saved === undefined) return
    try {
      const result = await saveConfig.mutateAsync({
        rules: saved.rules,
        includeFallback: saved.includeFallback,
        customRules: rows
          .filter((rule) => rule.value.trim() !== "")
          .map((rule) => ({
            type: rule.type,
            value: rule.value.trim(),
            target: rule.target,
          })),
        template: saved.template,
        healthCheck: saved.healthCheck,
        selectedProfiles: saved.selectedProfiles,
      })
      toast.success(result.message)
      // 清掉本地编辑，回显服务端保存后的值。
      setEdited(null)
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>自定义域名规则</CardTitle>
        <CardDescription>
          按域名后缀、完整域名或关键词匹配，命中就走指定的出口。合并时按「拒绝 →
          直连 → 特定组 → 走代理」的顺序写进配置，排在模板里的固定分流规则之前。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {configQuery.isError ? (
          <p className="text-xs text-destructive">
            {`读取已保存的规则失败：${describeError(configQuery.error)}`}
          </p>
        ) : null}

        <Tabs
          value={bucket}
          onValueChange={(next) => setBucket(next as Bucket)}
        >
          <TabsList className="w-full">
            {BUCKETS.map((item) => (
              <TabsTrigger key={item.key} value={item.key}>
                {item.label}
                <span className="text-muted-foreground tabular-nums">
                  {counts[item.key]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {BUCKETS.map((item) => (
            <TabsContent key={item.key} value={item.key} className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">
                      <span className="flex items-center gap-1">
                        类型
                        <Popover>
                          <PopoverTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="说明三种规则类型的区别"
                              >
                                <CircleHelp aria-hidden="true" />
                              </Button>
                            }
                          />
                          <PopoverContent className="w-[min(92vw,520px)] text-xs">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="min-w-[120px]">
                                    类型
                                  </TableHead>
                                  <TableHead className="min-w-[120px]">
                                    含义
                                  </TableHead>
                                  <TableHead className="w-full min-w-[120px]">
                                    例子
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {RULE_TYPE_NOTES.map((note) => (
                                  <TableRow key={note.type}>
                                    <TableCell className="align-top font-mono">
                                      {note.type}
                                    </TableCell>
                                    <TableCell className="align-top whitespace-normal">
                                      {note.meaning}
                                    </TableCell>
                                    <TableCell className="w-full align-top font-mono whitespace-normal">
                                      {`${note.type},example.com`}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </PopoverContent>
                        </Popover>
                      </span>
                    </TableHead>
                    <TableHead className="w-[min(60vw,640px)] min-w-[160px]">
                      值
                    </TableHead>
                    <TableHead className="min-w-[120px]">出口</TableHead>
                    <TableHead className="w-full min-w-[60px]">
                      <span className="sr-only">操作</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((rule, index) => (
                    <CustomRuleRow
                      key={rule.id}
                      rule={rule}
                      index={index}
                      targetOptions={targetOptions}
                      onChange={onChange}
                      onRemove={onRemove}
                    />
                  ))}
                </TableBody>
              </Table>
              {visible.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  这个分区还没有规则
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {`共 ${visible.length} 条，按这个顺序生效`}
                </p>
              )}
            </TabsContent>
          ))}
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={add}>
            <Plus aria-hidden="true" />
            添加规则
          </Button>
          <ActionButton
            variant={dirty ? "default" : "outline"}
            busy={saveConfig.isPending}
            busyLabel="保存中…"
            disabled={configQuery.data === undefined}
            onClick={() => void save()}
          >
            {dirty ? "保存规则（有改动）" : "保存规则"}
          </ActionButton>
        </div>
      </CardContent>
    </Card>
  )
}
