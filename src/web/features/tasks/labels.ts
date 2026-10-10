import { TASK_KINDS, type TaskRecord } from "@shared/api-contract"

/**
 * 任务种类与状态的中文说法。
 *
 * 未登记的种类直接显示标识本身，不猜测含义：宁可难看，也不要给出错误的名字。
 */
const KIND_LABELS = {
  [TASK_KINDS.diskScan]: "磁盘扫描",
  [TASK_KINDS.diskSnapshotDelete]: "删除快照",
  [TASK_KINDS.fileCopy]: "复制文件",
  [TASK_KINDS.fileDelete]: "删除文件",
  [TASK_KINDS.fileMove]: "移动文件",
  [TASK_KINDS.fileCreate]: "创建文件或目录",
  [TASK_KINDS.fileRename]: "重命名文件",
  [TASK_KINDS.fileWriteContent]: "保存文件内容",
  [TASK_KINDS.frpConfigSave]: "保存 FRP 配置",
  [TASK_KINDS.serviceAction]: "系统服务操作",
  [TASK_KINDS.diskEntryReveal]: "在访达中定位",
  [TASK_KINDS.diskEntryTrash]: "移到废纸篓",
  [TASK_KINDS.trafficSnapshotSave]: "保存流量快照",
  [TASK_KINDS.trafficSnapshotMerge]: "合并流量快照",
  [TASK_KINDS.trafficSnapshotDelete]: "删除流量快照",
} satisfies Record<TaskRecord["kind"], string>

const STATUS_LABELS: Record<TaskRecord["status"], string> = {
  running: "进行中",
  done: "已完成",
  partial: "部分完成",
  failed: "失败",
  unknown: "结果未知",
}

export const taskKindLabel = (kind: string): string =>
  Object.hasOwn(KIND_LABELS, kind)
    ? KIND_LABELS[kind as keyof typeof KIND_LABELS]
    : kind

export const taskStatusLabel = (status: TaskRecord["status"]): string =>
  STATUS_LABELS[status]
