import type {
  CaddyApplyStatus,
  CaddyRule,
  CaddyRuleChanges,
  CaddyRuleInput,
} from "@shared/api-contract"

/**
 * Caddy 页的纯展示逻辑：匹配条件文案、变更描述、状态标签。
 * 放在域内供多个区块共用，避免同一句中文在多处各写一遍。
 */

export const matchKindLabel = (kind: CaddyRule["matchKind"]): string =>
  kind === "host" ? "域名" : "路径前缀"

/** 匹配条件：域名规则显示域名，路径规则显示前缀。 */
export const matchConditionOf = (rule: {
  matchKind: CaddyRule["matchKind"]
  host: string | null
  pathPrefix: string | null
}): string =>
  rule.matchKind === "host" ? (rule.host ?? "") : (rule.pathPrefix ?? "")

/** 把受管规则转成写接口入参；只覆盖显式传入的字段（如启用状态）。 */
export const toCaddyRuleInput = (
  rule: CaddyRule,
  overrides: Partial<CaddyRuleInput> = {}
): CaddyRuleInput => ({
  name: rule.name,
  note: rule.note,
  matchKind: rule.matchKind,
  host: rule.host,
  pathPrefix: rule.pathPrefix,
  stripPrefix: rule.stripPrefix,
  upstream: rule.upstream,
  enabled: rule.enabled,
  ...overrides,
})

export const CADDY_APPLY_STATUS_LABELS: Record<CaddyApplyStatus, string> = {
  success: "已生效",
  failed: "失败",
  unknown: "结果未知",
}

/** 失败用破坏色，结果未知用描边提醒「不能当成成功」，成功不抢视觉注意力。 */
export const caddyApplyStatusVariant = (
  status: CaddyApplyStatus
): "secondary" | "destructive" | "outline" => {
  if (status === "failed") return "destructive"
  if (status === "unknown") return "outline"
  return "secondary"
}

/** 只列出真正变化的字段，便于用户看出这次改动动了什么。 */
export const describeRuleDiff = (
  before: CaddyRule,
  after: CaddyRule
): string => {
  const parts: string[] = []
  if (before.name !== after.name) {
    parts.push(`名称「${before.name}」→「${after.name}」`)
  }
  if (before.upstream !== after.upstream) {
    parts.push(`上游 ${before.upstream} → ${after.upstream}`)
  }
  if (
    before.matchKind !== after.matchKind ||
    before.host !== after.host ||
    before.pathPrefix !== after.pathPrefix
  ) {
    parts.push(`匹配 ${matchConditionOf(before)} → ${matchConditionOf(after)}`)
  }
  if (before.stripPrefix !== after.stripPrefix) {
    parts.push(
      `剥离前缀 ${before.stripPrefix ? "是" : "否"} → ${
        after.stripPrefix ? "是" : "否"
      }`
    )
  }
  if (before.note !== after.note) parts.push("备注有改动")
  return parts.length === 0 ? "顺序变化" : parts.join("；")
}

export type CaddyChangeGroup = {
  key: string
  label: string
  items: string[]
}

const describeRule = (rule: CaddyRule): string =>
  `${rule.name}（${matchConditionOf(rule)} → ${rule.upstream}）`

/** 变化清单：条数为 0 的分类不返回，页面也就不会显示空分类。 */
export const describeChanges = (
  changes: CaddyRuleChanges
): CaddyChangeGroup[] => {
  const groups: CaddyChangeGroup[] = []
  if (changes.added.length > 0) {
    groups.push({
      key: "added",
      label: "新增",
      items: changes.added.map(describeRule),
    })
  }
  if (changes.updated.length > 0) {
    groups.push({
      key: "updated",
      label: "修改",
      items: changes.updated.map(
        (item) =>
          `${item.after.name}：${describeRuleDiff(item.before, item.after)}`
      ),
    })
  }
  if (changes.removed.length > 0) {
    groups.push({
      key: "removed",
      label: "删除",
      items: changes.removed.map(describeRule),
    })
  }
  if (changes.enabled.length > 0) {
    groups.push({
      key: "enabled",
      label: "启用",
      items: changes.enabled.map(describeRule),
    })
  }
  if (changes.disabled.length > 0) {
    groups.push({
      key: "disabled",
      label: "停用",
      items: changes.disabled.map(describeRule),
    })
  }
  return groups
}

/** 应用确认对话框要写清条数与后果，因此这里给出汇总文本。 */
export const changeSummaryOf = (
  changes: CaddyRuleChanges
): { total: number; text: string } => {
  const parts: string[] = []
  if (changes.added.length > 0) parts.push(`新增 ${changes.added.length} 条`)
  if (changes.updated.length > 0)
    parts.push(`修改 ${changes.updated.length} 条`)
  if (changes.removed.length > 0)
    parts.push(`删除 ${changes.removed.length} 条`)
  if (changes.enabled.length > 0)
    parts.push(`启用 ${changes.enabled.length} 条`)
  if (changes.disabled.length > 0)
    parts.push(`停用 ${changes.disabled.length} 条`)
  return {
    total:
      changes.added.length +
      changes.updated.length +
      changes.removed.length +
      changes.enabled.length +
      changes.disabled.length,
    text: parts.join("、"),
  }
}
