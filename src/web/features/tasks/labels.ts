import type { TaskRecord } from "@shared/api-contract"

/**
 * 任务种类与状态的中文说法。
 *
 * 未登记的种类直接显示标识本身，不猜测含义：宁可难看，也不要给出错误的名字。
 */
const KIND_LABELS: Record<string, string> = {
  disk_scan: "磁盘扫描",
  disk_snapshot_delete: "删除快照",
  file_copy: "复制文件",
  file_delete: "删除文件",
  file_move: "移动文件",
  traffic_snapshot_save: "保存流量快照",
  traffic_snapshot_merge: "合并流量快照",
  traffic_snapshot_delete: "删除流量快照",
}

const STATUS_LABELS: Record<TaskRecord["status"], string> = {
  running: "进行中",
  done: "已完成",
  partial: "部分完成",
  failed: "失败",
  unknown: "结果未知",
}

export const taskKindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind

export const taskStatusLabel = (status: TaskRecord["status"]): string =>
  STATUS_LABELS[status]
