import type { DatabaseBackupSource } from "@shared/api-contract"

/** 备份来源的中文说法：列表、删除确认与恢复确认共用一份。 */
export const SOURCE_LABELS: Record<DatabaseBackupSource, string> = {
  manual: "手工创建",
  import: "导入",
  pre_restore: "恢复前自动",
}

/** 签名只显示前 8 位：够人眼比对，不把整串签名铺满界面。 */
export const shortSignature = (signature: string): string =>
  `${signature.slice(0, 8)}…`
