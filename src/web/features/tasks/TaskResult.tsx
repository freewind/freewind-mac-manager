import type { TaskRecord } from "@shared/api-contract"
import { formatBytes } from "@shared/format"

/** 任务结果按业务语义展示，保留失败对象与原因供用户核实。 */
export const TaskResult = ({ task }: { task: TaskRecord }) => {
  const result = task.result
  if (!result) return null
  if ("completed" in result) {
    return (
      <section className="flex flex-col gap-1 break-all" aria-label="操作结果">
        <p>
          完成 {result.completed.length} 项，失败 {result.failed.length} 项，
          部分完成 {result.partial?.length ?? 0} 项，跳过{" "}
          {result.skipped.length} 项
        </p>
        {result.completed.map((path) => (
          <p key={`completed:${path}`}>已完成：{path}</p>
        ))}
        {result.failed.map((item) => (
          <p key={`failed:${item.path}`} className="text-destructive">
            失败：{item.path}，{item.message}
          </p>
        ))}
        {result.partial?.map((item) => (
          <p key={`partial:${item.path}`} className="text-destructive">
            部分完成：{item.path}，{item.message}
            {item.destination ? `；目标：${item.destination}` : ""}
          </p>
        ))}
        {result.skipped.map((path) => (
          <p key={`skipped:${path}`}>未执行：{path}</p>
        ))}
      </section>
    )
  }
  if ("fileCount" in result) {
    return (
      <p>
        扫描完成：{result.fileCount} 个文件、{result.dirCount} 个目录， 共{" "}
        {formatBytes(result.totalSize)}
      </p>
    )
  }
  if ("rangeText" in result) return <p>已保存快照：{result.rangeText}</p>
  if ("snapshotIds" in result) {
    return <p>操作后保留 {result.snapshotIds.length} 份快照</p>
  }
  if ("removed" in result) return <p>已删除 {result.removed} 份快照</p>
  return task.message === result.message ? null : <p>{result.message}</p>
}
