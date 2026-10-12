import type {
  DatabaseRestoreState,
  DatabaseRestoreStatus,
} from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Skeleton } from "@web/components/ui/skeleton"
import type { ReactNode } from "react"

export type RestoreTone = "ok" | "pending" | "danger" | "muted"

export type RestoreSummary = {
  tone: RestoreTone
  title: string
  detail: string
}

const STATUS_LABELS: Record<DatabaseRestoreStatus, string> = {
  planned: "计划已创建",
  applying: "正在应用",
  applied: "已应用",
  failed: "失败",
  cancelled: "已取消",
  unknown: "结果未知",
}

/** 状态中文说法：恢复状态区与列表徽标共用一份。 */
export const restoreStatusLabel = (status: DatabaseRestoreStatus): string =>
  STATUS_LABELS[status]

/**
 * 恢复状态 → 可读结论。
 *
 * 四态区分，且「已恢复」只以 `verified` 为准：计划存在（planned/applying）
 * 不代表数据库已换；applied 但未核实必须说清是签名不一致还是读取失败；
 * unknown 必须带上服务端给的原因，不能含糊成「未知」两个字。
 */
export const describeRestoreState = (
  state: DatabaseRestoreState | null
): RestoreSummary => {
  const plan = state?.plan ?? null
  if (plan === null) {
    return {
      tone: "muted",
      title: "当前没有恢复计划",
      detail:
        "这里显示恢复计划的状态，以及当前数据库是否已核实为所选备份；数据库不会在未确认的情况下被替换。",
    }
  }

  const target = `${plan.backupFileName} · 计划创建于 ${formatTimestamp(
    plan.createdAt / 1000
  )}`

  switch (plan.status) {
    case "planned":
      return {
        tone: "pending",
        title: "恢复计划已创建，等待重启服务后生效",
        detail: `${target} · ${plan.message}`,
      }
    case "applying":
      return {
        tone: "pending",
        title: "重启后正在应用恢复计划",
        detail: `${target} · ${plan.message}`,
      }
    case "applied":
      return state?.verified
        ? {
            tone: "ok",
            title: "已恢复并核实：当前数据库就是这份备份",
            detail: target,
          }
        : {
            tone: "danger",
            title: "计划已应用，但当前数据库尚未核实为这份备份",
            detail: `${target} · ${
              state?.currentSignature === null
                ? "当前库签名读取失败"
                : "当前库签名与备份不一致"
            }，请人工确认当前库内容`,
          }
    case "failed":
      return {
        tone: "danger",
        title: "恢复失败，当前数据库未被替换",
        detail: `${target} · ${plan.message}`,
      }
    case "cancelled":
      return {
        tone: "muted",
        title: "恢复计划已取消，当前数据库未变",
        detail: `${target} · 没有待执行的恢复计划，重启不会再执行恢复`,
      }
    case "unknown":
      return {
        tone: "danger",
        title: "恢复结果未知，需要重新核实",
        detail: `${target} · ${plan.unknownReason ?? plan.message}`,
      }
  }
}

type RestoreStatusCardProps = {
  state: DatabaseRestoreState | null
  loading: boolean
  error: string | null
  /** 可选操作位（例如取消尚未执行的计划）；状态展示本身不负责动作。 */
  action?: ReactNode
}

/** 恢复状态区：状态与「是否已核实」的展示，可选操作位只放轻动作（取消计划）。 */
export const RestoreStatusCard = (props: RestoreStatusCardProps) => {
  const { state, loading, error } = props
  if (loading) return <Skeleton className="h-24 w-full" />
  if (error !== null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>恢复状态读取失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  const plan = state?.plan ?? null
  const summary = describeRestoreState(state)

  return (
    <Alert variant={summary.tone === "danger" ? "destructive" : "default"}>
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {summary.title}
        {plan === null ? null : (
          <Badge variant={summary.tone === "ok" ? "secondary" : "outline"}>
            {restoreStatusLabel(plan.status)}
          </Badge>
        )}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <span>{summary.detail}</span>
        {plan === null ? null : (
          <span className="text-muted-foreground text-xs">
            最近更新 {formatTimestamp(plan.updatedAt / 1000)}
            {state?.currentSignature === null
              ? " · 当前库签名：读取失败"
              : ` · 当前库签名：${state?.currentSignature?.slice(0, 16)}…`}
          </span>
        )}
      </AlertDescription>
      {props.action === undefined ? null : (
        <AlertAction>{props.action}</AlertAction>
      )}
    </Alert>
  )
}
