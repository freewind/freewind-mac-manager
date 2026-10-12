import type { DatabaseBackupSource } from "@shared/api-contract"
import { formatBytes } from "@shared/format"

/** 备份来源的中文说法：列表、删除确认与恢复确认共用一份。 */
export const SOURCE_LABELS: Record<DatabaseBackupSource, string> = {
  manual: "手工创建",
  import: "导入",
  pre_restore: "恢复前自动",
}

/** 签名只显示前 8 位：够人眼比对，不把整串签名铺满界面。 */
export const shortSignature = (signature: string): string =>
  `${signature.slice(0, 8)}…`

/** 传输进度：拿不到总量时只说已传字节数，不编造百分比。 */
export const formatProgress = (progress: {
  loaded: number
  total?: number | undefined
}): string => {
  const loaded = formatBytes(progress.loaded)
  const total = progress.total
  if (total === undefined || total <= 0) return `已传 ${loaded}`
  const percent = Math.min(100, Math.floor((progress.loaded / total) * 100))
  return `已传 ${loaded} / 共 ${formatBytes(total)}（${percent}%）`
}

/** 有总量时才给进度条的值，否则只靠文字，不画一根假进度条。 */
export const progressPercent = (progress: {
  loaded: number
  total?: number | undefined
}): number | null =>
  progress.total === undefined || progress.total <= 0
    ? null
    : Math.min(100, Math.round((progress.loaded / progress.total) * 100))
