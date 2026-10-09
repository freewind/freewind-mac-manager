import type { ProcessKind, ProcessState } from "@shared/api-contract"
import { formatBytes } from "@shared/format"

export const PROCESS_STATE_LABEL: Record<ProcessState, string> = {
  running: "运行中",
  sleeping: "休眠",
  idle: "空闲",
  stopped: "已停止",
  zombie: "僵尸",
}

export const PROCESS_STATE_VARIANT: Record<
  ProcessState,
  "default" | "secondary" | "outline" | "destructive"
> = {
  running: "default",
  sleeping: "secondary",
  idle: "outline",
  stopped: "destructive",
  zombie: "destructive",
}

export const PROCESS_KIND_LABEL: Record<ProcessKind, string> = {
  kernel: "内核",
  daemon: "系统服务",
  app: "应用",
  helper: "辅助进程",
  service: "后台服务",
}

/** 把秒数写成中文时长：26 秒 / 12 分钟 / 3 小时 5 分 / 6 天 3 小时。 */
export const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}

/** 速率统一写成「12.4 MB/s」。 */
export const formatRate = (bytesPerSecond: number): string =>
  `${formatBytes(bytesPerSecond)}/s`

/** 把 0-1 的比例换算成 Progress 需要的百分数。 */
export const toPercent = (ratio: number): number =>
  Math.min(100, Math.max(0, ratio * 100))

/** 整机 CPU 占用：各核占用的平均值。 */
export const averageCoreUsage = (coreUsage: number[]): number => {
  if (coreUsage.length === 0) return 0
  return coreUsage.reduce((sum, value) => sum + value, 0) / coreUsage.length
}

const AVATAR_TONES = [
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  "bg-orange-500/15 text-orange-600 dark:text-orange-300",
]

/** 进程头像的底色：按进程名散列到一组语义色，保证同一进程颜色稳定。 */
export const avatarToneClass = (name: string): string => {
  let hash = 0
  for (const char of name)
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}
