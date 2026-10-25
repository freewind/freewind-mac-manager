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
import type { GeositeRule } from "@shared/api-contract"
import { DEFAULT_GEOSITE_RULES } from "@shared/clash-merge-defaults"
import { describeError, formatTimestamp } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
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
import { GripVertical, Lock } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  useClashMergeConfigQuery,
  useClashVergeGeositeQuery,
  useClashVergeProfilesQuery,
  useMergeClashProfiles,
  useSaveClashMergeConfig,
} from "./queries"

/** GEO 分类分流的出口：只有三个固定选项，对应合并后的三个组。 */
type GeositeTarget = GeositeRule["target"]

/** 一行 GEO 分流：分类名 + 出口，id 只用于 React key。 */
type GeositeRow = GeositeRule & { id: string }

/** 下拉里的分类选项：名字 + 条目数。 */
type GeositeOption = { code: string; count: number }

const GEOSITE_TARGET_LABELS: Record<GeositeTarget, string> = {
  proxy: "走代理",
  direct: "直连",
  reject: "拒绝",
}

/**
 * GEO 分流行：把手在左，可以上下拖动调整顺序；顺序就是规则生效顺序。
 * 只用原生 button 做把手：拖拽需要原生 pointer 事件，交给自己控制更直接。
 */
const SortableGeositeRow = (props: {
  rule: GeositeRow
  count: number
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
        {props.count}
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
  const geositeQuery = useClashVergeGeositeQuery()
  const saveConfig = useSaveClashMergeConfig()
  const mergeProfiles = useMergeClashProfiles()
  const profiles = useMemo(() => query.data?.profiles ?? [], [query.data])
  /** 只记住本地勾选；选中的订阅不保存，每次进来重新勾。 */
  const [editedSelected, setEditedSelected] = useState<string[]>([])
  const [editedRules, setEditedRules] = useState<GroupRule[] | null>(null)
  const selected = editedSelected
  /** 规则行的勾选状态：仅为本地选择，未绑定具体批量动作。 */
  const [checkedRules, setCheckedRules] = useState<string[]>([])
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

  const allProfilesChecked =
    profiles.length > 0 &&
    profiles.every((profile) => selected.includes(profile.uid))

  const toggleAllProfiles = (checked: boolean) => {
    setEditedSelected(checked ? profiles.map((profile) => profile.uid) : [])
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
    setCheckedRules((current) => current.filter((item) => item !== id))
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

  const normalRules = rules.filter((rule) => !rule.fixed)
  const allChecked =
    normalRules.length > 0 &&
    normalRules.every((rule) => checkedRules.includes(rule.id))

  const toggleAllRules = (checked: boolean) => {
    setCheckedRules(checked ? normalRules.map((rule) => rule.id) : [])
  }

  const toggleRule = (id: string, checked: boolean) => {
    setCheckedRules(
      checked
        ? [...checkedRules.filter((item) => item !== id), id]
        : checkedRules.filter((item) => item !== id)
    )
  }

  /**
   * 合并：只传勾选中的规则（按表内顺序），兜底的「其他」由服务端放在最后。
   * 命中 0 个节点的组由服务端跳过。
   */
  const merge = async () => {
    const chosenRules = rules
      .filter((rule) => !rule.fixed && checkedRules.includes(rule.id))
      .map((rule) => ({ pattern: rule.pattern, target: rule.target }))
    try {
      const result = await mergeProfiles.mutateAsync({
        selected,
        rules: chosenRules,
        geositeRules: geositeRules.map((rule) => ({
          code: rule.code,
          target: rule.target,
        })),
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
          .map((rule) => ({ pattern: rule.pattern, target: rule.target })),
        geositeRules: geositeRules.map((rule) => ({
          code: rule.code,
          target: rule.target,
        })),
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
              <TableHead className="min-w-[60px]">
                <Checkbox
                  aria-label="全选分组规则"
                  checked={allChecked}
                  onCheckedChange={(checked) => toggleAllRules(checked)}
                />
              </TableHead>
              <TableHead className="min-w-[120px]">正则</TableHead>
              <TableHead className="min-w-[60px]">匹配数</TableHead>
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
                    <TableCell />
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
                    <Checkbox
                      aria-label={`选择第 ${index + 1} 条分组规则`}
                      checked={checkedRules.includes(rule.id)}
                      onCheckedChange={(checked) =>
                        toggleRule(rule.id, checked)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={rule.pattern}
                      aria-label={`第 ${index + 1} 条规则的正则`}
                      onChange={(event) =>
                        updateRule(rule.id, { pattern: event.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-left tabular-nums text-muted-foreground">
                    {matches.length}
                  </TableCell>
                  <TableCell className="align-top text-xs whitespace-normal">
                    <NodeTags nodes={matches} />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={rule.target}
                      aria-label={`第 ${index + 1} 条规则的目标组名`}
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

        <div className="space-y-2 border-t pt-3">
          <div>
            <h3 className="text-sm font-medium">GEO 分类分流</h3>
            <p className="text-xs text-muted-foreground">
              前三行是固定规则（不可删改，分类不在 geosite.dat
              里时自动跳过）；自定义分类排在它们之后生效，可拖动调整先后。合并时全部写到规则最前面，优先于订阅自带规则
            </p>
            {geositeQuery.isError ? (
              <p className="text-xs text-destructive">
                {`读取 GEO 分类失败：${describeError(geositeQuery.error)}`}
              </p>
            ) : null}
          </div>

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
            {/* 固定三行：不可拖动、不可删改，分类缺失时在最后一列标出。 */}
            <TableBody>
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
                      {info?.count ?? "—"}
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
                      count={
                        geositeOptions.find((item) => item.code === rule.code)
                          ?.count ?? 0
                      }
                      onChangeTarget={(target) =>
                        updateGeositeTarget(rule.id, target)
                      }
                      onRemove={() => removeGeositeRule(rule.id)}
                    />
                  ))}
                </TableBody>
              </SortableContext>
            </DndContext>
          </Table>
          {geositeRules.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              还没有添加自定义分类，当前只有上面三条固定规则
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
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
              : `已选 ${chosen.length} 个订阅、${nodeTotal} 个节点；参与合并的分组 ${checkedRules.length} 个`}
          </span>
        </div>
      </div>
    </section>
  )
}
