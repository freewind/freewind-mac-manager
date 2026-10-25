import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import type { CustomRule, GeositeRule } from "@shared/api-contract"
import {
  type ClashMergeGroupType,
  DEFAULT_GEOSITE_RULES,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_MERGE_TEMPLATE,
} from "@shared/clash-merge-defaults"
import { describeError } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Checkbox } from "@web/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@web/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
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
import { ChevronRight, CircleHelp, GripVertical, Lock } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { toast } from "sonner"
import { EditableYaml } from "./editable-yaml"
import {
  useClashMergeConfigQuery,
  useClashVergeGeositeQuery,
  useClashVergeProfilesQuery,
  useMergeClashProfiles,
  useSaveClashMergeConfig,
} from "./queries"

/** 一行自定义规则：类型 + 值 + 出口，id 只用于 React key。 */
type CustomRow = CustomRule & { id: string }

/** 可选的规则类型：只开常用的三种。 */
const CUSTOM_RULE_TYPES: CustomRule["type"][] = [
  "DOMAIN-SUFFIX",
  "DOMAIN",
  "DOMAIN-KEYWORD",
]

/** GEO 分类分流的出口：只有三个固定选项，对应合并后的三个组。 */
type GeositeTarget = GeositeRule["target"]

/** 一行 GEO 分流：分类名 + 出口，id 只用于 React key。 */
type GeositeRow = GeositeRule & { id: string }

/** 下拉里的分类选项：名字 + 条目数 + 前若干条域名（带类型与属性）。 */
type GeositeOption = {
  code: string
  count: number
  preview: { type: string; value: string; attributes: string[] }[]
}

const GEOSITE_TARGET_LABELS: Record<GeositeTarget, string> = {
  proxy: "走代理",
  direct: "直连",
  reject: "拒绝",
}

/**
 * 自定义域名规则的出口：三个内置别名，也可以直接选本次合并生成的分组名。
 * 某些网站对地区有要求，必须能把域名钉到「香港」「美国」这类具体组上。
 */
const CUSTOM_TARGET_ALIASES: Record<string, string> = {
  proxy: "走代理",
  direct: "直连",
  reject: "拒绝",
}

/**
 * 个数单元格：点开看该分类前 10 个域名，用来判断里面究竟是什么。
 * 没有预览数据时退化成纯文本，不弹空窗。
 */
const CategoryCountCell = (props: {
  code: string
  option: GeositeOption | undefined
}) => {
  const preview = props.option?.preview ?? []
  if (props.option === undefined) return <>—</>
  if (preview.length === 0) return <>{props.option.count}</>
  const first = preview.slice(0, 10)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            aria-label={`查看 ${props.code} 的前几个域名`}
          >
            {props.option.count}
          </Button>
        }
      />
      <PopoverContent className="w-80 text-xs">
        <p className="mb-1 text-muted-foreground">
          {`${props.code} 的前 ${first.length} 个域名（共 ${props.option.count} 条）`}
        </p>
        <ul className="space-y-1 font-mono break-all">
          {first.map((domain) => (
            <li key={`${domain.type}-${domain.value}`}>
              <span className="mr-1 text-[10px] text-muted-foreground">
                {DOMAIN_TYPE_LABEL[domain.type] ?? domain.type}
              </span>
              {domain.value}
              {domain.attributes.length > 0 ? (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {domain.attributes
                    .map((attribute) => `@${attribute}`)
                    .join(" ")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/**
 * GEO 分流行：把手在左，可以上下拖动调整顺序；顺序就是规则生效顺序。
 * 只用原生 button 做把手：拖拽需要原生 pointer 事件，交给自己控制更直接。
 */
const SortableGeositeRow = (props: {
  rule: GeositeRow
  option: GeositeOption | undefined
  onChangeTarget: (target: GeositeTarget) => void
  onRemove: () => void
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.rule.id })
  return (
    <TableRow
      ref={setNodeRef}
      style={{
        transform:
          transform === null
            ? undefined
            : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        transition,
        opacity: isDragging ? 0.6 : undefined,
      }}
    >
      <TableCell className="w-8">
        <button
          type="button"
          aria-label={`拖动调整顺序：${props.rule.code}`}
          className="inline-flex size-6 touch-none cursor-grab items-center justify-center rounded-md hover:bg-muted"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" className="size-3" />
        </button>
      </TableCell>
      <TableCell className="text-left">{props.rule.code}</TableCell>
      <TableCell className="text-left text-muted-foreground tabular-nums">
        <CategoryCountCell code={props.rule.code} option={props.option} />
      </TableCell>
      <TableCell className="text-left">
        <Select
          value={props.rule.target}
          onValueChange={(next) => props.onChangeTarget(next as GeositeTarget)}
        >
          <SelectTrigger aria-label={`${props.rule.code} 的出口`}>
            <SelectValue>
              {GEOSITE_TARGET_LABELS[props.rule.target]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(GEOSITE_TARGET_LABELS) as GeositeTarget[]).map(
              (target) => (
                <SelectItem key={target} value={target}>
                  {GEOSITE_TARGET_LABELS[target]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="w-full text-left">
        <Button
          variant="outline"
          size="sm"
          aria-label={`删除分类 ${props.rule.code}`}
          onClick={props.onRemove}
        >
          删除
        </Button>
      </TableCell>
    </TableRow>
  )
}

/**
 * 分组规则行：把手在左，可上下拖动调整组的先后，顺序就是生成配置里的顺序。
 * 兜底行不参与拖拽，单独渲染在最后一行。
 */
const SortableRuleRow = (props: {
  rule: GroupRule
  index: number
  matches: string[]
  onToggle: (checked: boolean) => void
  onChange: (patch: Partial<GroupRule>) => void
  onRemove: () => void
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.rule.id })
  const label = `第 ${props.index + 1} 条分组规则`
  return (
    <TableRow
      ref={setNodeRef}
      style={{
        transform:
          transform === null
            ? undefined
            : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        transition,
        opacity: isDragging ? 0.6 : undefined,
      }}
    >
      <TableCell>
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`拖动调整顺序：${label}`}
            className="inline-flex size-6 touch-none cursor-grab items-center justify-center rounded-md hover:bg-muted"
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden="true" className="size-3" />
          </button>
          <Checkbox
            aria-label={`选择${label}`}
            checked={props.rule.enabled}
            onCheckedChange={(checked) => props.onToggle(checked)}
          />
        </span>
      </TableCell>
      <TableCell>
        <Input
          value={props.rule.pattern}
          aria-label={`${label}的正则`}
          onChange={(event) => props.onChange({ pattern: event.target.value })}
        />
      </TableCell>
      <TableCell className="text-left tabular-nums text-muted-foreground">
        {props.matches.length}
      </TableCell>
      <TableCell className="align-top text-xs whitespace-normal">
        <NodeTags nodes={props.matches} />
      </TableCell>
      <TableCell>
        <Input
          value={props.rule.target}
          aria-label={`${label}的目标组名`}
          onChange={(event) => props.onChange({ target: event.target.value })}
        />
      </TableCell>
      <TableCell className="text-left">
        <Select
          value={props.rule.type}
          onValueChange={(next) =>
            props.onChange({ type: next as ClashMergeGroupType })
          }
        >
          <SelectTrigger aria-label={`${label}的类型`}>
            <SelectValue>{GROUP_TYPE_LABELS[props.rule.type]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(GROUP_TYPE_LABELS) as ClashMergeGroupType[]).map(
              (type) => (
                <SelectItem key={type} value={type}>
                  {GROUP_TYPE_LABELS[type]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Button
          variant="outline"
          size="sm"
          aria-label={`删除${label}`}
          onClick={props.onRemove}
        >
          删除
        </Button>
      </TableCell>
    </TableRow>
  )
}

/** 一条自定义分组规则：正则在节点名里匹配，目标组名直接填写。 */
type GroupRule = {
  id: string
  pattern: string
  target: string
  /** 生成的组类型：手动选、测速最快或按序兜底。 */
  type: ClashMergeGroupType
  /** 这条规则参与合并吗：勾选框控制，未勾选的只留在页面上。 */
  enabled: boolean
  fixed?: boolean
}

/** 兜底规则：固定目标组名「其他」，不可删除、固定在最后，聚合其余规则没命中的节点。 */
const FALLBACK_RULE: GroupRule = {
  id: "fallback",
  pattern: "",
  target: "其他",
  type: "select",
  enabled: true,
  fixed: true,
}

/** 组类型的中文叫法：直接说清选中后会发生什么。 */
const GROUP_TYPE_LABELS: Record<ClashMergeGroupType, string> = {
  select: "手动选择",
  "url-test": "测速最快",
  fallback: "按序兜底",
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

/** protobuf 里的类型：页面显示中文，免得看不懂 plain / rootdomain。 */
const DOMAIN_TYPE_LABEL: Record<string, string> = {
  plain: "域名",
  rootdomain: "根域",
  full: "全匹配",
  regex: "正则",
}

/** 一行能放下的节点标签个数：超过就收进「全部」弹窗。 */
const NODE_TAGS_INLINE = 6

/**
 * 订阅表里的节点列：只显示一行，超出部分被裁掉，由「全部」按钮在弹窗里看。
 * 节点多时逐个撑开会把行高拉得很高，也把下面的内容挤到屏幕外。
 */
const NodeTagsCell = (props: { label: string; nodes: string[] }) => {
  const [open, setOpen] = useState(false)
  if (props.nodes.length === 0) return null
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden">
        {props.nodes.map((node) => (
          <span
            key={node}
            className="inline-flex max-w-full shrink-0 items-center rounded-md border px-1.5 py-0.5 text-xs"
          >
            {node}
          </span>
        ))}
      </span>
      {props.nodes.length > NODE_TAGS_INLINE ? (
        <Button
          variant="outline"
          size="sm"
          aria-label={`查看全部节点：${props.label}`}
          onClick={() => setOpen(true)}
        >
          全部
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(96vw,760px)] sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>
              {`${props.label}（${props.nodes.length} 个节点）`}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto">
            <span className="flex flex-wrap gap-1">
              {props.nodes.map((node) => (
                <span
                  key={node}
                  className="inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 text-xs break-all"
                >
                  {node}
                </span>
              ))}
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
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
 * 可折叠的卡片：合并页下面几块默认收起，点标题展开。
 * 标题右侧放一行摘要，收着也能看出里面大概有什么。
 * 夹在 Card 与内部块之间时，这里负责补上卡片的纵向间距：
 * Card 的 gap 只作用于直接子元素，套一层 Collapsible 后就不再生效。
 */
const CollapsibleCard = (props: {
  title: string
  description: string
  /** 标题旁的计数徽标，如「3 条」。 */
  summary?: string
  children: ReactNode
}) => {
  const [open, setOpen] = useState(false)
  return (
    <Card size="sm">
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="flex flex-col gap-(--card-spacing)"
      >
        <CardHeader>
          <CardTitle>
            <CollapsibleTrigger
              render={
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-2 text-left"
                >
                  <span className="flex items-center gap-1">
                    <ChevronRight
                      aria-hidden="true"
                      className="size-3 transition-transform [&[aria-expanded=true]>svg]:rotate-90"
                    />
                    {props.title}
                  </span>
                  {props.summary === undefined ? null : (
                    <Badge variant="secondary" className="font-normal">
                      {props.summary}
                    </Badge>
                  )}
                </button>
              }
            />
          </CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">{props.children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
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
  const geositeQuery = useClashVergeGeositeQuery()
  const saveConfig = useSaveClashMergeConfig()
  const mergeProfiles = useMergeClashProfiles()
  const profiles = useMemo(() => query.data?.profiles ?? [], [query.data])
  /** 勾选的订阅：本地改动优先后保存的 uid；清单里已删掉的自动失效。 */
  const [editedSelected, setEditedSelected] = useState<string[] | null>(null)
  const selected = editedSelected ?? configQuery.data?.selectedProfiles ?? []
  const [editedRules, setEditedRules] = useState<GroupRule[] | null>(null)
  const rules = useMemo<GroupRule[]>(
    () =>
      editedRules ?? [
        ...(configQuery.data?.rules ?? []).map((rule, index) => ({
          ...rule,
          id: `saved-${index}`,
        })),
        // 兜底行固定在最后：新规则加在它前面。
        FALLBACK_RULE,
      ],
    [editedRules, configQuery.data]
  )
  const fallbackRule = rules.find((rule) => rule.fixed) ?? FALLBACK_RULE

  /** GEO 分流行：本地编辑优先，否则回显服务端保存的。 */
  const [editedGeosite, setEditedGeosite] = useState<GeositeRow[] | null>(null)
  const geositeRules = useMemo<GeositeRow[]>(
    () =>
      editedGeosite ??
      (configQuery.data?.geositeRules ?? []).map((rule, index) => ({
        ...rule,
        id: `saved-geosite-${index}`,
      })),
    [editedGeosite, configQuery.data]
  )
  /** 分类选项：条目多的排前面，与 GEO 数据页同一个顺序。 */
  const geositeOptions = useMemo<GeositeOption[]>(
    () =>
      [...(geositeQuery.data?.categories ?? [])].sort(
        (left, right) => right.count - left.count
      ),
    [geositeQuery.data]
  )

  /** 自定义域名规则：本地编辑优先，否则回显服务端保存的。 */
  const [editedCustom, setEditedCustom] = useState<CustomRow[] | null>(null)
  const customRules = useMemo<CustomRow[]>(
    () =>
      editedCustom ??
      (configQuery.data?.customRules ?? []).map((rule, index) => ({
        ...rule,
        id: `saved-custom-${index}`,
      })),
    [editedCustom, configQuery.data]
  )

  /** 基座模板：本地编辑优先，否则回显服务端保存的。 */
  const [editedTemplate, setEditedTemplate] = useState<string | null>(null)
  const template =
    editedTemplate ?? configQuery.data?.template ?? DEFAULT_MERGE_TEMPLATE

  /** 测速参数：间隔存成字符串，允许输入过程中被清空。 */
  const [editedHealth, setEditedHealth] = useState<{
    url: string
    interval: string
  } | null>(null)
  const health = editedHealth ?? {
    url: configQuery.data?.healthCheck.url ?? DEFAULT_HEALTH_CHECK.url,
    interval: String(
      configQuery.data?.healthCheck.interval ?? DEFAULT_HEALTH_CHECK.interval
    ),
  }

  /** 模板会不会与已保存的不同：用来提示尚未保存。 */
  const templateDirty =
    configQuery.data !== undefined && template !== configQuery.data.template

  /**
   * 页面上任何设置与已保存的不同，就把保存按钮高亮。
   * 逐项比实际提交的内容（去掉 id 这类只在本地用的字段），保存成功后 config 失效重取，自然回落。
   */
  const dirty = useMemo(() => {
    const saved = configQuery.data
    if (saved === undefined) return false
    const current = JSON.stringify({
      // 与服务端实际写进配置的内容对齐：空行会被丢掉，不参与比较，
      // 否则存完还显示「有改动」。
      rules: rules
        .filter(
          (rule) =>
            !rule.fixed &&
            rule.pattern.trim() !== "" &&
            rule.target.trim() !== ""
        )
        .map((rule) => ({
          pattern: rule.pattern,
          target: rule.target,
          type: rule.type,
          enabled: rule.enabled,
        })),
      geositeRules: geositeRules.map((rule) => ({
        code: rule.code,
        target: rule.target,
      })),
      customRules: customRules
        .filter((rule) => rule.value.trim() !== "")
        .map((rule) => ({
          type: rule.type,
          value: rule.value,
          target: rule.target,
        })),
      template,
      healthCheck: {
        url: health.url.trim(),
        interval: Number(health.interval),
      },
      // 订阅的勾选顺序无意义，比之前先排序。
      selectedProfiles: [...selected].sort(),
      includeFallback: fallbackRule.enabled,
    })
    const stored = JSON.stringify({
      rules: saved.rules,
      geositeRules: saved.geositeRules,
      customRules: saved.customRules,
      template: saved.template,
      healthCheck: saved.healthCheck,
      selectedProfiles: [...saved.selectedProfiles].sort(),
      includeFallback: saved.includeFallback,
    })
    return current !== stored
  }, [
    rules,
    geositeRules,
    customRules,
    template,
    health,
    selected,
    fallbackRule,
    configQuery.data,
  ])

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
  /** 按规则 id 取命中节点：拖拽后顺序会变，用 id 取比用下标稳。 */
  const matchesById = useMemo(
    () => new Map(rules.map((rule, index) => [rule.id, previews[index] ?? []])),
    [rules, previews]
  )
  const normalRules = useMemo(
    () => rules.filter((rule) => !rule.fixed),
    [rules]
  )
  const sortableRuleIds = useMemo(
    () => normalRules.map((rule) => rule.id),
    [normalRules]
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

  const allProfilesChecked =
    profiles.length > 0 &&
    profiles.every((profile) => selected.includes(profile.uid))

  const toggleAllProfiles = (checked: boolean) => {
    setEditedSelected(checked ? profiles.map((profile) => profile.uid) : [])
  }

  const addRule = () => {
    // 新规则插在兜底行前面：兜底永远留着收尾。
    const normal = rules.filter((rule) => !rule.fixed)
    setEditedRules([
      ...normal,
      {
        id: crypto.randomUUID(),
        pattern: "",
        target: "",
        type: "select",
        enabled: true,
      },
      ...rules.filter((rule) => rule.fixed),
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

  /** 拖动后按新顺序重写普通规则，兜底行始终留在最后。 */
  const handleRuleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over === null || active.id === over.id) return
    const normal = rules.filter((rule) => !rule.fixed)
    const from = normal.findIndex((rule) => rule.id === active.id)
    const to = normal.findIndex((rule) => rule.id === over.id)
    if (from === -1 || to === -1) return
    setEditedRules([
      ...arrayMove(normal, from, to),
      ...rules.filter((rule) => rule.fixed),
    ])
  }

  const addGeositeRule = (code: string) => {
    if (geositeRules.some((rule) => rule.code === code)) return
    setEditedGeosite([
      ...geositeRules,
      { id: crypto.randomUUID(), code, target: "proxy" },
    ])
  }

  const updateGeositeTarget = (id: string, target: GeositeTarget) => {
    setEditedGeosite(
      geositeRules.map((rule) => (rule.id === id ? { ...rule, target } : rule))
    )
  }

  const removeGeositeRule = (id: string) => {
    setEditedGeosite(geositeRules.filter((rule) => rule.id !== id))
  }

  /** 可选的具体分组名：来自分组规则里的目标组名，去重且不含内置别名。 */
  const customTargetOptions = useMemo(() => {
    const names = new Set<string>()
    for (const rule of rules) {
      const name = rule.target.trim()
      if (name !== "" && !(name in CUSTOM_TARGET_ALIASES)) names.add(name)
    }
    return [...names]
  }, [rules])

  const addCustomRule = () => {
    setEditedCustom([
      ...customRules,
      {
        id: crypto.randomUUID(),
        type: "DOMAIN-SUFFIX",
        value: "",
        target: "proxy",
      },
    ])
  }

  const updateCustomRule = (id: string, patch: Partial<CustomRule>) => {
    setEditedCustom(
      customRules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    )
  }

  const removeCustomRule = (id: string) => {
    setEditedCustom(customRules.filter((rule) => rule.id !== id))
  }

  // 按下拖动 5px 才激活，手机上下滑页面不会被当成拖拽。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleGeositeDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over === null || active.id === over.id) return
    const from = geositeRules.findIndex((rule) => rule.id === active.id)
    const to = geositeRules.findIndex((rule) => rule.id === over.id)
    if (from === -1 || to === -1) return
    setEditedGeosite(arrayMove(geositeRules, from, to))
  }

  const allChecked = rules.length > 0 && rules.every((rule) => rule.enabled)

  const toggleAllRules = (checked: boolean) => {
    setEditedRules(rules.map((rule) => ({ ...rule, enabled: checked })))
  }

  const toggleRule = (id: string, checked: boolean) => {
    updateRule(id, { enabled: checked })
  }

  /**
   * 合并：只传勾选中的规则（按表内顺序），兜底的「其他」由服务端放在最后。
   * 命中 0 个节点的组由服务端跳过。
   */
  const merge = async () => {
    const chosenRules = rules
      .filter((rule) => !rule.fixed && rule.enabled)
      .map((rule) => ({
        pattern: rule.pattern,
        target: rule.target,
        type: rule.type,
        enabled: true,
      }))
    const includeFallback = fallbackRule.enabled
    try {
      const result = await mergeProfiles.mutateAsync({
        selected,
        rules: chosenRules,
        includeFallback,
        geositeRules: geositeRules.map((rule) => ({
          code: rule.code,
          target: rule.target,
        })),
        customRules: customRules
          .filter((rule) => rule.value.trim() !== "")
          .map((rule) => ({
            type: rule.type,
            value: rule.value.trim(),
            target: rule.target,
          })),
        template,
        healthCheck: {
          url: health.url.trim(),
          interval: Number(health.interval),
        },
      })
      toast.success(result.message)
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  /** 保存到服务端：只存用户填的正则与目标组名，兑底行与订阅选择都不存。 */
  const save = async () => {
    try {
      const result = await saveConfig.mutateAsync({
        rules: rules
          .filter((rule) => !rule.fixed)
          .map((rule) => ({
            pattern: rule.pattern,
            target: rule.target,
            type: rule.type,
            enabled: rule.enabled,
          })),
        geositeRules: geositeRules.map((rule) => ({
          code: rule.code,
          target: rule.target,
        })),
        customRules: customRules
          .filter((rule) => rule.value.trim() !== "")
          .map((rule) => ({
            type: rule.type,
            value: rule.value.trim(),
            target: rule.target,
          })),
        template,
        healthCheck: {
          url: health.url.trim(),
          interval: Number(health.interval),
        },
        selectedProfiles: selected,
        includeFallback: fallbackRule.enabled,
      })
      toast.success(result.message)
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  return (
    <section className="space-y-3" aria-label="合并订阅">
      <h2 className="text-sm font-medium">合并订阅</h2>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            订阅
            {profiles.length === 0 ? null : (
              <Badge variant="secondary" className="font-normal">
                {`已选 ${chosen.length}/${profiles.length}`}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            勾选要合并的订阅，合并后这些订阅的节点会写进同一份配置
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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
                    <Checkbox
                      aria-label="全选订阅"
                      checked={allProfilesChecked}
                      onCheckedChange={(checked) => toggleAllProfiles(checked)}
                    />
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
                        onCheckedChange={(checked) =>
                          toggle(profile.uid, checked)
                        }
                      />
                    </TableCell>
                    <TableCell className="text-left">{profile.name}</TableCell>
                    <TableCell className="text-left text-muted-foreground tabular-nums">
                      {profile.nodes.length}
                    </TableCell>
                    <TableCell className="w-full max-w-0 text-left whitespace-normal text-muted-foreground">
                      {profile.nodes.length === 0 ? (
                        "（没有节点）"
                      ) : (
                        <NodeTagsCell
                          label={profile.name}
                          nodes={profile.nodes.map((node) => node.name)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <CollapsibleCard
        title="自定义分组规则"
        description="正则在节点名里匹配，右侧列出命中的节点；目标组名直接填。最后一行固定兜底，其余节点归到「其他」"
        summary={`${rules.filter((rule) => !rule.fixed).length} 条`}
      >
        {/* 测速参数全局一份：只有测速最快、按序兜底两种组用得上，放在表格上方。 */}
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor="health-url" className="space-y-1">
            <span className="block text-xs text-muted-foreground">
              测速地址
            </span>
            <Input
              id="health-url"
              value={health.url}
              aria-label="测速地址"
              className="w-[min(70vw,320px)]"
              onChange={(event) =>
                setEditedHealth({ ...health, url: event.target.value })
              }
            />
          </label>
          <label htmlFor="health-interval" className="space-y-1">
            <span className="block text-xs text-muted-foreground">
              间隔（秒）
            </span>
            <Input
              id="health-interval"
              value={health.interval}
              inputMode="numeric"
              aria-label="测速间隔（秒）"
              className="w-24"
              onChange={(event) =>
                setEditedHealth({ ...health, interval: event.target.value })
              }
            />
          </label>
          <p className="pb-1 text-xs text-muted-foreground">
            仅「测速最快」「按序兜底」两种组使用；地址要选你的线路也能访问的 204
            地址，否则组里会一个可用节点都没有
          </p>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleRuleDragEnd}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[90px]">
                  <span className="flex items-center gap-1">
                    <Checkbox
                      aria-label="全选分组规则"
                      checked={allChecked}
                      onCheckedChange={(checked) => toggleAllRules(checked)}
                    />
                    全选
                  </span>
                </TableHead>
                <TableHead className="min-w-[120px]">正则</TableHead>
                <TableHead className="min-w-[60px]">匹配数</TableHead>
                <TableHead className="w-full min-w-[60px]">匹配节点</TableHead>
                <TableHead className="min-w-[120px]">目标组名</TableHead>
                <TableHead className="min-w-[100px]">类型</TableHead>
                {/* 添加按钮放最后一列：新行插在兜底行前面。 */}
                <TableHead className="min-w-[80px]">
                  <Button variant="outline" size="sm" onClick={addRule}>
                    添加
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SortableContext
                items={sortableRuleIds}
                strategy={verticalListSortingStrategy}
              >
                {normalRules.map((rule, index) => (
                  <SortableRuleRow
                    key={rule.id}
                    rule={rule}
                    index={index}
                    matches={matchesById.get(rule.id) ?? []}
                    onToggle={(checked) => toggleRule(rule.id, checked)}
                    onChange={(patch) => updateRule(rule.id, patch)}
                    onRemove={() => removeRule(rule.id)}
                  />
                ))}
              </SortableContext>
              {/* 兜底行固定最后一行：它兜其余规则没命中的节点，不参与拖拽。 */}
              <TableRow>
                <TableCell>
                  <span className="flex items-center gap-1">
                    <span className="size-6" aria-hidden="true" />
                    <Checkbox
                      aria-label="生成兜底的「其他」组"
                      checked={fallbackRule.enabled}
                      onCheckedChange={(checked) =>
                        toggleRule(fallbackRule.id, checked)
                      }
                    />
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  其余未匹配的节点
                </TableCell>
                <TableCell className="text-left tabular-nums text-muted-foreground">
                  {unmatchedNodes.length}
                </TableCell>
                <TableCell className="align-top text-xs whitespace-normal">
                  <NodeTags nodes={unmatchedNodes} />
                </TableCell>
                <TableCell>
                  <Input
                    value={fallbackRule.target}
                    disabled
                    aria-label="兜底分组的目标组名"
                  />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  手动选择
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </DndContext>
      </CollapsibleCard>

      <CollapsibleCard
        title="自定义域名规则"
        description="按域名后缀、完整域名或关键词匹配，命中就走你指定的出口；出口可选内置三项，也能直接选某个地区组（比如对地区有要求的网站）；比下面的 GEO 分类先生效"
        summary={`${customRules.length} 条`}
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
                          <TableRow>
                            <TableCell className="align-top font-mono">
                              DOMAIN
                            </TableCell>
                            <TableCell className="align-top whitespace-normal">
                              只匹配这个域名本身，不含子域名
                            </TableCell>
                            <TableCell className="w-full align-top font-mono whitespace-normal">
                              DOMAIN,example.com
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="align-top font-mono">
                              DOMAIN-SUFFIX
                            </TableCell>
                            <TableCell className="align-top whitespace-normal">
                              匹配这个域名及其所有子域名
                            </TableCell>
                            <TableCell className="w-full align-top font-mono whitespace-normal">
                              DOMAIN-SUFFIX,example.com
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="align-top font-mono">
                              DOMAIN-KEYWORD
                            </TableCell>
                            <TableCell className="align-top whitespace-normal">
                              域名里包含这个词就命中
                            </TableCell>
                            <TableCell className="w-full align-top font-mono whitespace-normal">
                              DOMAIN-KEYWORD,ads
                            </TableCell>
                          </TableRow>
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
            {customRules.map((rule, index) => (
              <TableRow key={rule.id}>
                <TableCell className="text-left">
                  <Select
                    value={rule.type}
                    onValueChange={(next) =>
                      updateCustomRule(rule.id, {
                        type: next as CustomRule["type"],
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label={`第 ${index + 1} 条自定义规则的类型`}
                    >
                      <SelectValue>{rule.type}</SelectValue>
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
                    value={rule.value}
                    placeholder="example.com"
                    aria-label={`第 ${index + 1} 条自定义规则的值`}
                    onChange={(event) =>
                      updateCustomRule(rule.id, { value: event.target.value })
                    }
                  />
                </TableCell>
                <TableCell className="text-left">
                  <Select
                    value={rule.target}
                    onValueChange={(next) =>
                      updateCustomRule(rule.id, {
                        target: next ?? rule.target,
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label={`第 ${index + 1} 条自定义规则的出口`}
                    >
                      <SelectValue>
                        {CUSTOM_TARGET_ALIASES[rule.target] ?? rule.target}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CUSTOM_TARGET_ALIASES).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        )
                      )}
                      {customTargetOptions.map((name) => (
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
                    aria-label={`删除第 ${index + 1} 条自定义规则`}
                    onClick={() => removeCustomRule(rule.id)}
                  >
                    删除
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {customRules.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有自定义规则</p>
        ) : null}
        <Button variant="outline" size="sm" onClick={addCustomRule}>
          添加规则
        </Button>
      </CollapsibleCard>

      <CollapsibleCard
        title="GEO 分类分流"
        description="上方选中即加入，可拖动调整先后；表格最后三行是固定规则（不可删改，分类不在 geosite.dat 里时自动跳过），排在自定义规则之后生效。合并时全部写到规则最前面"
        summary={`${geositeRules.length} 个`}
      >
        {geositeQuery.isError ? (
          <p className="text-xs text-destructive">
            {`读取 GEO 分类失败：${describeError(geositeQuery.error)}`}
          </p>
        ) : null}

        <Combobox
          items={geositeOptions}
          value={null as GeositeOption | null}
          itemToStringValue={(item: GeositeOption) => item.code}
          disabled={geositeOptions.length === 0}
          onValueChange={(item: GeositeOption | null) => {
            if (item !== null) addGeositeRule(item.code)
          }}
        >
          <ComboboxInput
            placeholder="搜索并添加分类"
            aria-label="搜索并添加 GEO 分类"
            className="max-w-sm"
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

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <span className="sr-only">拖动排序</span>
              </TableHead>
              <TableHead className="min-w-[120px]">分类</TableHead>
              <TableHead className="min-w-[60px]">个数</TableHead>
              <TableHead className="min-w-[120px]">出口</TableHead>
              <TableHead className="w-full min-w-[60px]">
                <span className="sr-only">状态与操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleGeositeDragEnd}
          >
            <SortableContext
              items={geositeRules.map((rule) => rule.id)}
              strategy={verticalListSortingStrategy}
            >
              <TableBody>
                {geositeRules.map((rule) => (
                  <SortableGeositeRow
                    key={rule.id}
                    rule={rule}
                    option={geositeOptions.find(
                      (item) => item.code === rule.code
                    )}
                    onChangeTarget={(target) =>
                      updateGeositeTarget(rule.id, target)
                    }
                    onRemove={() => removeGeositeRule(rule.id)}
                  />
                ))}
              </TableBody>
            </SortableContext>
          </DndContext>
          {/* 固定三行放最后：实际生效顺序也是自定义在前、固定在后。
                多个 tbody 之间那条分隔线单独补上，否则上一组末行会被去掉边框。 */}
          <TableBody
            className={geositeRules.length > 0 ? "border-t" : undefined}
          >
            {DEFAULT_GEOSITE_RULES.map((rule) => {
              const known = geositeQuery.data !== undefined
              const info = geositeOptions.find(
                (item) => item.code.toUpperCase() === rule.code.toUpperCase()
              )
              return (
                <TableRow key={rule.code}>
                  <TableCell className="w-8">
                    <Lock
                      aria-hidden="true"
                      className="size-3 text-muted-foreground"
                    />
                  </TableCell>
                  <TableCell className="text-left">{rule.code}</TableCell>
                  <TableCell className="text-left text-muted-foreground tabular-nums">
                    <CategoryCountCell code={rule.code} option={info} />
                  </TableCell>
                  <TableCell className="text-left">
                    {GEOSITE_TARGET_LABELS[rule.target]}
                  </TableCell>
                  <TableCell className="w-full text-left text-xs">
                    {known && info === undefined ? (
                      <span className="text-destructive">
                        geosite.dat 里已经没有这个分类，合并时会跳过
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {known ? "固定规则" : "检查中…"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {geositeRules.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            还没有添加自定义分类，当前只有上面三条固定规则
          </p>
        ) : null}
      </CollapsibleCard>

      <CollapsibleCard
        title="基座模板"
        description="合并产物以它为底：proxies 与 proxy-groups 是占位，rules 列表会被自动填充"
        summary={`${template.length} 字符${templateDirty ? " · 未保存" : ""}`}
      >
        <EditableYaml
          value={template}
          ariaLabel="基座模板 YAML"
          onChange={(next) => setEditedTemplate(next)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditedTemplate(DEFAULT_MERGE_TEMPLATE)}
          >
            恢复默认模板
          </Button>
        </div>
      </CollapsibleCard>

      <div className="flex flex-wrap items-center justify-center gap-3 border-t pt-4">
        {/* 保存放在合并左边：这些都是我们自己维护的设置，合并生成的配置会覆盖文件，不会覆盖它们。 */}
        <ActionButton
          variant={dirty ? "default" : "outline"}
          busy={saveConfig.isPending}
          busyLabel="保存中…"
          onClick={() => void save()}
        >
          {dirty ? "保存设置（有改动）" : "保存设置"}
        </ActionButton>
        <ActionButton
          disabled={chosen.length < 2}
          busy={mergeProfiles.isPending}
          busyLabel="生成中…"
          onClick={() => void merge()}
        >
          合并订阅
        </ActionButton>
        <span className="text-xs text-muted-foreground">
          {chosen.length < 2
            ? "先在上面勾选至少 2 个订阅"
            : `已选 ${chosen.length} 个订阅、${nodeTotal} 个节点；参与合并的分组 ${rules.filter((rule) => !rule.fixed && rule.enabled).length} 个`}
        </span>
        {configQuery.isError ? (
          <span className="text-xs text-destructive">
            {`读取已保存设置失败：${describeError(configQuery.error)}`}
          </span>
        ) : null}
      </div>
    </section>
  )
}
