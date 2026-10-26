import type { CustomRule } from "@shared/api-contract"
import { customRuleTargetRank } from "@shared/clash-merge-defaults"
import { describeError } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import {
  TABLE_PAGE_SIZE,
  TablePagination,
} from "@web/components/TablePagination"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@web/components/ui/combobox"
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
import { CircleHelp, Plus, X } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  useClashMergeConfigQuery,
  useClashVergeGeositeQuery,
  useSaveClashMergeConfig,
} from "./queries"

/** 一行自定义规则：类型 + 值 + 出口，id 只用于 React key。 */
type CustomRow = CustomRule & { id: string }

/** 可选的规则类型：三种域名匹配，加一个 GEOSITE 整类匹配。 */
const CUSTOM_RULE_TYPES: CustomRule["type"][] = [
  "DOMAIN-SUFFIX",
  "DOMAIN",
  "DOMAIN-KEYWORD",
  "GEOSITE",
]

/** GEOSITE 值列的下拉选项：分类名 + 条目数。 */
type GeositeChoice = { code: string; count: number }

/** 内置出口别名：其余选项是本次合并生成的分组名。 */
const CUSTOM_TARGET_ALIASES: Record<string, string> = {
  proxy: "走代理",
  direct: "直连",
  reject: "拒绝",
}

/** 四个分区：顺序就是写进配置的顺序，特定组最具体，排最前。 */
const BUCKETS = [
  { key: "group", label: "特定组" },
  { key: "reject", label: "拒绝" },
  { key: "direct", label: "直连" },
  { key: "proxy", label: "走代理" },
] as const

type Bucket = (typeof BUCKETS)[number]["key"]

/** 出口决定它落在哪个分区：顺序与 customRuleTargetRank 一致。 */
const BUCKET_BY_RANK: Bucket[] = ["group", "reject", "direct", "proxy"]
const bucketOf = (target: string): Bucket =>
  BUCKET_BY_RANK[customRuleTargetRank(target)]

const FIRST_PAGES: Record<Bucket, number> = {
  reject: 1,
  direct: 1,
  group: 1,
  proxy: 1,
}

/** 四种规则类型的含义，放在类型列的问号里。 */
const RULE_TYPE_NOTES = [
  {
    type: "DOMAIN",
    meaning: "只匹配这个域名本身，不含子域名",
    example: "DOMAIN,example.com",
  },
  {
    type: "DOMAIN-SUFFIX",
    meaning: "匹配这个域名及其所有子域名",
    example: "DOMAIN-SUFFIX,example.com",
  },
  {
    type: "DOMAIN-KEYWORD",
    meaning: "域名里包含这个词就命中",
    example: "DOMAIN-KEYWORD,ads",
  },
  {
    type: "GEOSITE",
    meaning: "按 geosite.dat 里的域名分类整类匹配，值就是分类名",
    example: "GEOSITE,cn",
  },
]

/** 一行是否命中搜索：值、类型、出口的显示名都算。 */
const matchesQuery = (rule: CustomRow, keyword: string): boolean => {
  if (keyword === "") return true
  const target = CUSTOM_TARGET_ALIASES[rule.target] ?? rule.target
  return (
    rule.value.toLowerCase().includes(keyword) ||
    rule.type.toLowerCase().includes(keyword) ||
    target.toLowerCase().includes(keyword)
  )
}

/**
 * 单行规则：每个分区都可能上千行，输入时只重渲染被改的那一行，
 * 否则每敲一个字符都要重渲染整表，手机直接卡住。
 */
const CustomRuleRow = memo(
  (props: {
    rule: CustomRow
    index: number
    targetOptions: string[]
    geositeChoices: GeositeChoice[]
    onChange: (id: string, patch: Partial<CustomRule>) => void
    onRemove: (id: string) => void
  }) => {
    /* 分类名大小写不固定（geosite.dat 里是大写），比对时统一转小写；
       匹配不到就不当选项处理，回退到文本框，至少不会是一片空白。 */
    const picked =
      props.geositeChoices.find(
        (item) => item.code.toLowerCase() === props.rule.value.toLowerCase()
      ) ?? null
    const usePicker =
      props.rule.type === "GEOSITE" &&
      props.geositeChoices.length > 0 &&
      (props.rule.value === "" || picked !== null)
    return (
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
            <SelectTrigger aria-label={`第 ${props.index} 条规则的类型`}>
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
          {usePicker ? (
            /* GEOSITE 的值是分类名，写错会让内核拒掉整份配置，改成只能从分类里选。
             分类还没读到、或值不在分类里时退回普通输入框，至少能看到并改当前值。 */
            <Combobox
              items={props.geositeChoices}
              value={picked}
              itemToStringLabel={(item) => item.code}
              itemToStringValue={(item) => item.code}
              onValueChange={(item) =>
                props.onChange(props.rule.id, {
                  value: item?.code ?? "",
                })
              }
            >
              <ComboboxInput
                placeholder="搜索 GEOSITE 分类"
                aria-label={`第 ${props.index} 条规则的 GEOSITE 分类`}
                className="w-full"
                showClear
              />
              <ComboboxContent>
                <ComboboxEmpty>没有匹配的分类</ComboboxEmpty>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item.code} value={item}>
                      {`${item.code}（${item.count}）`}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          ) : (
            <Input
              value={props.rule.value}
              placeholder="example.com"
              aria-label={`第 ${props.index} 条规则的值`}
              onChange={(event) =>
                props.onChange(props.rule.id, { value: event.target.value })
              }
            />
          )}
        </TableCell>
        <TableCell className="text-left">
          <Select
            value={props.rule.target}
            onValueChange={(next) =>
              props.onChange(props.rule.id, {
                target: next ?? props.rule.target,
              })
            }
          >
            <SelectTrigger aria-label={`第 ${props.index} 条规则的出口`}>
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
            aria-label={`删除第 ${props.index} 条规则`}
            onClick={() => props.onRemove(props.rule.id)}
          >
            删除
          </Button>
        </TableCell>
      </TableRow>
    )
  }
)

/**
 * 自定义域名规则：命中就走指定出口，排在模板里的固定分流规则之前。
 *
 * 按出口分四个分区展示（拒绝 → 直连 → 特定组 → 走代理），合并时也按这个顺序
 * 写进配置：先挡掉广告，再让该直连的别绕路，最后才是走代理与指定地区组。
 * 搜索是全局的：四个分区一起命中，命中数标在各分区标题上。
 */
export const CustomRulesPanel = () => {
  const configQuery = useClashMergeConfigQuery()
  const saveConfig = useSaveClashMergeConfig()
  const [edited, setEdited] = useState<CustomRow[] | null>(null)
  const [bucket, setBucket] = useState<Bucket>("group")
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE)
  const [query, setQuery] = useState("")
  const [pages, setPages] = useState<Record<Bucket, number>>(FIRST_PAGES)

  const savedRows = useMemo<CustomRow[]>(
    () =>
      (configQuery.data?.customRules ?? []).map((rule, index) => ({
        ...rule,
        id: `saved-custom-${index}`,
      })),
    [configQuery.data]
  )
  const rows = edited ?? savedRows

  /** GEOSITE 值列的分类选项：条目多的排前面，与 GEO 数据页同一个顺序。 */
  const geositeQuery = useClashVergeGeositeQuery()
  const geositeChoices = useMemo<GeositeChoice[]>(() => {
    const categories = geositeQuery.data?.categories ?? []
    return categories
      .map((item) => ({ code: item.code, count: item.count }))
      .sort((left, right) => right.count - left.count)
  }, [geositeQuery.data])

  /** 回调里要读最新的行，用 ref 存住，免得 onChange 随 rows 变化而换引用。 */
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  /** 本次编辑里最后一个换过分区的出口：保存后再切过去。 */
  const pendingBucket = useRef<Bucket | null>(null)

  /** 可选的具体分组名：来自分组规则里的目标组名，去重且不含内置别名。 */
  const targetOptions = useMemo(() => {
    const names = new Set<string>()
    for (const rule of configQuery.data?.rules ?? []) {
      const name = rule.target.trim()
      if (name !== "" && !(name in CUSTOM_TARGET_ALIASES)) names.add(name)
    }
    return [...names]
  }, [configQuery.data])

  const keyword = query.trim().toLowerCase()

  /** 搜索命中的行按分区归好，分区内保持库里的顺序。 */
  const grouped = useMemo(() => {
    const result: Record<Bucket, CustomRow[]> = {
      reject: [],
      direct: [],
      group: [],
      proxy: [],
    }
    for (const rule of rows) {
      if (!matchesQuery(rule, keyword)) continue
      result[bucketOf(rule.target)].push(rule)
    }
    return result
  }, [rows, keyword])

  /** 分区总条数：搜索时标题显示「命中/总数」。 */
  const totals = useMemo(() => {
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
      const row = rowsRef.current.find((item) => item.id === id)
      if (row !== undefined && patch.target !== undefined) {
        const to = bucketOf(patch.target)
        // 先记着，等保存完再切过去：改的过程中不打扰。
        if (to !== bucketOf(row.target)) pendingBucket.current = to
      }
      setEdited((editedRows) =>
        (editedRows ?? savedRows).map((item) =>
          item.id === id ? { ...item, ...patch } : item
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

  /** 换搜索词后回到第一页，否则会停在一个已经不存在的页上。 */
  const changeQuery = (next: string) => {
    setQuery(next)
    setPages(FIRST_PAGES)
  }

  /** 新规则跟着当前分区走，省得再加一次出口。 */
  const add = () => {
    const target = bucket === "group" ? (targetOptions[0] ?? "proxy") : bucket
    const nextRows = [
      ...rows,
      {
        id: crypto.randomUUID(),
        type: "DOMAIN-SUFFIX" as const,
        value: "",
        target,
      },
    ]
    setEdited(nextRows)
    // 新行加在末尾：清掉搜索并翻到它所在的页，否则看起来像没加成功。
    setQuery("")
    setPages({
      ...FIRST_PAGES,
      [bucket]: Math.max(
        1,
        Math.ceil(
          nextRows.filter((rule) => bucketOf(rule.target) === bucket).length /
            pageSize
        )
      ),
    })
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
      // 保存后行已经归到新分区，再把用户带到那个分区。
      const pending = pendingBucket.current
      pendingBucket.current = null
      setEdited(null)
      if (pending !== null) setBucket(pending)
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>自定义域名规则</CardTitle>
        <CardDescription>
          按域名后缀、完整域名或关键词匹配，命中就走指定的出口。合并时按「特定组
          → 拒绝 → 直连 → 走代理」的顺序写进配置，排在模板里的固定分流规则之前。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {configQuery.isError ? (
          <p className="text-xs text-destructive">
            {`读取已保存的规则失败：${describeError(configQuery.error)}`}
          </p>
        ) : null}

        <div className="relative max-w-sm">
          <Input
            value={query}
            placeholder="搜索域名、类型或出口"
            aria-label="搜索规则"
            className={query === "" ? undefined : "pr-8"}
            onChange={(event) => changeQuery(event.target.value)}
          />
          {query === "" ? null : (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="清除搜索"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              onClick={() => changeQuery("")}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>

        <Tabs
          value={bucket}
          onValueChange={(next) => setBucket(next as Bucket)}
        >
          <TabsList className="w-full">
            {BUCKETS.map((item) => (
              <TabsTrigger key={item.key} value={item.key}>
                {item.label}
                <span className="text-muted-foreground tabular-nums">
                  {keyword === ""
                    ? totals[item.key]
                    : `${grouped[item.key].length}/${totals[item.key]}`}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {BUCKETS.map((item) => {
            const list = grouped[item.key]
            const pageCount = Math.max(1, Math.ceil(list.length / pageSize))
            const page = Math.min(pages[item.key], pageCount)
            const pageRows = list.slice((page - 1) * pageSize, page * pageSize)
            return (
              <TabsContent
                key={item.key}
                value={item.key}
                className="space-y-3"
              >
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
                                        {note.example}
                                      </TableCell>{" "}
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </PopoverContent>
                          </Popover>
                        </span>
                      </TableHead>
                      <TableHead className="w-[min(80vw,1280px)] min-w-[240px]">
                        值
                      </TableHead>
                      <TableHead className="min-w-[120px]">出口</TableHead>
                      <TableHead className="w-full min-w-[60px]">
                        <span className="sr-only">操作</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((rule, index) => (
                      <CustomRuleRow
                        key={rule.id}
                        rule={rule}
                        index={(page - 1) * pageSize + index + 1}
                        targetOptions={targetOptions}
                        geositeChoices={geositeChoices}
                        onChange={onChange}
                        onRemove={onRemove}
                      />
                    ))}
                  </TableBody>
                </Table>

                {list.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {keyword === "" ? "这个分区还没有规则" : "没有匹配的规则"}
                  </p>
                ) : (
                  /* 分页跟表格一起：换到别的表格时这几件也一起搬。 */
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {`共 ${list.length} 条`}
                    </p>
                    <TablePagination
                      page={page}
                      pageCount={pageCount}
                      pageSize={pageSize}
                      onPageChange={(next) =>
                        setPages((current) => ({
                          ...current,
                          [item.key]: next,
                        }))
                      }
                      onPageSizeChange={(next) => {
                        // 每页条数变了页码会越界，四个分区统一从头开始。
                        setPageSize(next)
                        setPages(FIRST_PAGES)
                      }}
                    />
                  </div>
                )}
              </TabsContent>
            )
          })}
        </Tabs>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
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
