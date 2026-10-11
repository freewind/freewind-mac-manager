import {
  Delete02Icon,
  Edit02Icon,
  PauseIcon,
  PlayIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CaddyExternalRule, CaddyRule } from "@shared/api-contract"
import { ActionButton } from "@web/components/ActionButton"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Input } from "@web/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { useState } from "react"
import { matchConditionOf, matchKindLabel } from "../format"

type RuleListProps = {
  rules: CaddyRule[]
  busy: boolean
  /** 非空表示写操作目前不可用，文案说明原因（离线或读取失败）。 */
  disabledReason: string | null
  onEdit: (rule: CaddyRule) => void
  onSetEnabled: (rule: CaddyRule, enabled: boolean) => Promise<boolean>
  onDelete: (rule: CaddyRule) => Promise<boolean>
}

/** 一行里的动作按钮：图标按钮都有可访问名称，触控目标不小于 44px。 */
const RuleActions = (props: {
  rule: CaddyRule
  busy: boolean
  disabledReason: string | null
  onEdit: (rule: CaddyRule) => void
  onToggle: (rule: CaddyRule) => void
  onDelete: (rule: CaddyRule) => void
}) => {
  const disabled = props.busy || props.disabledReason !== null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        variant="outline"
        size="icon"
        className="size-11"
        aria-label={`编辑规则「${props.rule.name}」`}
        title="编辑"
        disabled={disabled}
        onClick={() => props.onEdit(props.rule)}
      >
        <HugeiconsIcon icon={Edit02Icon} aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-11"
        aria-label={
          props.rule.enabled
            ? `停用规则「${props.rule.name}」`
            : `启用规则「${props.rule.name}」`
        }
        title={props.rule.enabled ? "停用" : "启用"}
        disabled={disabled}
        onClick={() => props.onToggle(props.rule)}
      >
        <HugeiconsIcon
          icon={props.rule.enabled ? PauseIcon : PlayIcon}
          aria-hidden="true"
        />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-11 text-destructive"
        aria-label={`删除规则「${props.rule.name}」`}
        title="删除"
        disabled={disabled}
        onClick={() => props.onDelete(props.rule)}
      >
        <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
      </Button>
    </div>
  )
}

const ruleSummary = (rule: CaddyRule): string =>
  `${rule.name}（${matchConditionOf(rule)} → ${rule.upstream}）`

const StripeNote = (props: { rule: CaddyRule }) =>
  props.rule.matchKind === "path" ? (
    <span className="text-xs text-muted-foreground">
      {props.rule.stripPrefix ? "剥离前缀" : "保留前缀"}
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">—</span>
  )

/**
 * 受管规则列表。
 *
 * 手机用卡片、桌面用表格，数据、搜索与动作只有一份：差异只在渲染上，
 * 不给同一份数据建第二套查询或校验。
 */
export const RuleList = (props: RuleListProps) => {
  const isDesktop = useIsDesktop()
  const [search, setSearch] = useState("")
  const [pendingDelete, setPendingDelete] = useState<CaddyRule | null>(null)
  const [pendingDisable, setPendingDisable] = useState<CaddyRule | null>(null)
  const deleting = useDialogSubmit(() => setPendingDelete(null), props.busy)
  const disabling = useDialogSubmit(() => setPendingDisable(null), props.busy)

  // 宽屏以外的浮层也要接入统一的返回管理：系统返回先关确认框，再回退页面。
  useHistoryOverlay(pendingDelete !== null, () => setPendingDelete(null))
  useHistoryOverlay(pendingDisable !== null, () => setPendingDisable(null))

  const keyword = search.trim().toLowerCase()
  const visible =
    keyword === ""
      ? props.rules
      : props.rules.filter((rule) =>
          [
            rule.name,
            rule.host ?? "",
            rule.pathPrefix ?? "",
            rule.upstream,
          ].some((text) => text.toLowerCase().includes(keyword))
        )

  const confirmDelete = (): void => {
    const rule = pendingDelete
    if (rule === null) return
    void deleting.submit(() => props.onDelete(rule))
  }

  const confirmDisable = (): void => {
    const rule = pendingDisable
    if (rule === null) return
    void disabling.submit(() => props.onSetEnabled(rule, false))
  }

  const toggle = (rule: CaddyRule): void => {
    if (rule.enabled) {
      setPendingDisable(rule)
      return
    }
    void props.onSetEnabled(rule, true)
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">受管规则</h2>
        <p className="text-xs text-muted-foreground">
          共 {props.rules.length} 条；改动只存数据库，点「应用变更」后才写进
          Caddyfile
        </p>
      </div>

      {props.rules.length > 0 ? (
        <div className="flex items-center gap-2">
          <Input
            id="caddy-rule-search"
            aria-label="搜索规则"
            className="min-h-11"
            placeholder="按名称、域名或上游搜索"
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <HugeiconsIcon
            icon={Search01Icon}
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      ) : null}

      {props.rules.length === 0 ? (
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Edit02Icon} />
            </EmptyMedia>
            <EmptyTitle>还没有受管规则</EmptyTitle>
            <EmptyDescription>
              新增一条规则，或把 Caddyfile 里已有的规则导入进来。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          没有匹配「{search.trim()}」的规则。
        </p>
      ) : isDesktop ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>匹配</TableHead>
                <TableHead>上游</TableHead>
                <TableHead>前缀</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="max-w-[12rem] truncate font-medium">
                    {rule.name}
                  </TableCell>
                  <TableCell className="max-w-[14rem] truncate">
                    <span className="text-xs text-muted-foreground">
                      {matchKindLabel(rule.matchKind)}
                    </span>{" "}
                    {matchConditionOf(rule)}
                  </TableCell>
                  <TableCell className="max-w-[14rem] truncate font-mono text-xs">
                    {rule.upstream}
                  </TableCell>
                  <TableCell>
                    <StripeNote rule={rule} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={rule.enabled ? "secondary" : "outline"}>
                      {rule.enabled ? "启用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <RuleActions
                      rule={rule}
                      busy={props.busy}
                      disabledReason={props.disabledReason}
                      onEdit={props.onEdit}
                      onToggle={toggle}
                      onDelete={setPendingDelete}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((rule) => (
            <li
              key={rule.id}
              className="flex min-w-0 flex-col gap-2 rounded-lg border p-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {rule.name}
                </span>
                <Badge variant={rule.enabled ? "secondary" : "outline"}>
                  {rule.enabled ? "启用" : "停用"}
                </Badge>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-xs text-muted-foreground">
                  {matchKindLabel(rule.matchKind)}：{matchConditionOf(rule)}
                </span>
                <span className="truncate font-mono text-xs">
                  → {rule.upstream}
                </span>
                <StripeNote rule={rule} />
                {rule.note ? (
                  <span className="text-xs text-muted-foreground">
                    {rule.note}
                  </span>
                ) : null}
              </div>
              <RuleActions
                rule={rule}
                busy={props.busy}
                disabledReason={props.disabledReason}
                onEdit={props.onEdit}
                onToggle={toggle}
                onDelete={setPendingDelete}
              />
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除规则「{pendingDelete?.name ?? ""}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `${ruleSummary(pendingDelete)}。` : ""}
              规则会从数据库删除；下次应用变更后，Caddyfile
              里对应的转发也会消失，域名或路径将不再指向原来的上游。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting.busy}>取消</AlertDialogCancel>
            <ActionButton
              variant="destructive"
              className="min-h-11"
              busy={deleting.busy}
              busyLabel="删除中"
              onClick={confirmDelete}
            >
              删除规则「{pendingDelete?.name ?? ""}」
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDisable !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisable(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              停用规则「{pendingDisable?.name ?? ""}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDisable ? `${ruleSummary(pendingDisable)}。` : ""}
              停用后这条规则不再写进配置文件；应用变更时对应的转发会从 Caddy
              里移除，规则本身仍留在数据库中，可以随时重新启用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disabling.busy}>
              取消
            </AlertDialogCancel>
            <ActionButton
              className="min-h-11"
              busy={disabling.busy}
              busyLabel="停用中"
              onClick={confirmDisable}
            >
              停用规则「{pendingDisable?.name ?? ""}」
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

type ExternalRulesSectionProps = {
  externalRules: CaddyExternalRule[]
  unsupportedLines: number
  unsupportedSamples: string[]
  busy: boolean
  disabledReason: string | null
  onImport: () => Promise<boolean>
}

/**
 * 尚未接管的规则与无法识别的行：只读展示。
 *
 * 这些内容不会写进受管区域，应用变更会被后端拒绝；先导入或先手工整理，
 * 页面必须把这件事说清楚，而不是给一个点不动的按钮。
 */
export const ExternalRulesSection = (props: ExternalRulesSectionProps) => {
  if (props.externalRules.length === 0 && props.unsupportedLines === 0) {
    return null
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      {props.unsupportedLines > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>
            配置文件里有 {props.unsupportedLines} 行无法识别
          </AlertTitle>
          <AlertDescription>
            <p>
              这些行不在受管区域里，应用变更可能覆盖手工配置，因此现在不能应用。
            </p>
            <div className="mt-2 max-w-full overflow-x-auto rounded-md border bg-muted/40">
              <ul className="w-max min-w-full p-2 font-mono text-xs">
                {props.unsupportedSamples.map((sample) => (
                  <li key={sample} className="whitespace-pre">
                    {sample}
                  </li>
                ))}
              </ul>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {props.externalRules.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">
              Caddyfile 里尚未接管的规则（{props.externalRules.length} 条）
            </h3>
            <ActionButton
              variant="outline"
              className="ml-auto min-h-11 px-3"
              busy={props.busy}
              busyLabel="导入中"
              disabled={props.disabledReason !== null}
              onClick={() => void props.onImport()}
            >
              导入现有规则
            </ActionButton>
          </div>
          <p className="text-xs text-muted-foreground">
            导入只把它们记进数据库，不修改文件；导入后仍要应用变更才会接管受管区域。
          </p>
          <ul className="flex flex-col gap-1">
            {props.externalRules.map((rule) => (
              <li
                key={rule.id}
                className="flex min-w-0 flex-col gap-0.5 border-t pt-1 text-xs first:border-t-0 first:pt-0"
              >
                <span className="truncate">
                  第 {rule.line} 行：{matchConditionOf(rule)}
                  {rule.matchKind === "path" && rule.stripPrefix
                    ? "（剥离前缀）"
                    : ""}
                </span>
                <span className="truncate font-mono">→ {rule.upstream}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
