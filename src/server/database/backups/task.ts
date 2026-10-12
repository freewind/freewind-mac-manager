import {
  type DatabaseBackupCreated,
  TASK_KINDS,
  type TaskProgress,
} from "@shared/api-contract"
import { databaseBackupTaskTarget } from "@shared/task-targets"
import { z } from "zod"
import {
  createDatabaseBackupService,
  type DatabaseBackupServiceOptions,
} from "./service"

/**
 * 数据库备份任务：在任务子进程里跑原生备份，父进程只按 kind 查表执行。
 *
 * 备份读整库、耗时远超写操作的响应阈值，因此它靠任务中心查询进度；
 * 页面关闭或断网不会停止备份（执行只启动一次），进程被杀则由目录与清单核实。
 */

export const DATABASE_BACKUP_CREATE_KIND = TASK_KINDS.databaseBackupCreate

/** 备份读取整库：同一时间只允许一个备份任务，避免重复读盘与争抢空间。 */
export { databaseBackupTaskTarget }

/**
 * 备份任务载荷：只允许服务端自己发起的两类来源。
 * 上传导入不是任务（它是流式接收），因此这里不接受 import。
 */
export const DatabaseBackupTaskPayloadSchema = z.object({
  source: z.enum(["manual", "pre_restore"]).default("manual"),
})

export const runDatabaseBackupCreateTask = async (options: {
  payload: unknown
  report: (progress: TaskProgress) => void
  /** 测试注入临时目录与时钟。 */
  serviceOptions?: DatabaseBackupServiceOptions
}): Promise<{
  result: DatabaseBackupCreated
  message: string
  status: "done"
}> => {
  const parsed = DatabaseBackupTaskPayloadSchema.safeParse(options.payload)
  if (!parsed.success) throw new Error("备份任务载荷非法")
  const service = createDatabaseBackupService(options.serviceOptions)
  const created = await service.create({
    source: parsed.data.source,
    report: options.report,
  })
  return { result: created, message: created.message, status: "done" }
}
