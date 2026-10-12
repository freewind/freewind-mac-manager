import {
  DATABASE_BACKUP_UPLOAD_MAX_BYTES,
  type DatabaseBackup,
  type DatabaseBackupCreated,
  type DatabaseBackupSource,
  TASK_KINDS,
} from "@shared/api-contract"
import {
  createDatabaseBackup,
  downloadDatabaseBackup,
  uploadDatabaseBackup,
} from "@shared/client-api"
import { describeError, formatBytes } from "@shared/format"
import { databaseBackupTaskTarget } from "@shared/task-targets"
import { useQueryClient } from "@tanstack/react-query"
import { useTaskAction } from "@web/hooks/use-task-action"
import { useRef, useState } from "react"
import { toast } from "sonner"
import {
  BACKUP_PAGE_SIZE,
  backupKeys,
  useBackupRestoreState,
  useBackupsList,
} from "./queries"

/** 来源筛选：all 表示不传 source。 */
export type BackupSourceFilter = DatabaseBackupSource | "all"

/** 触发浏览器保存：GB 级文件一次性生成对象 URL，用完立刻释放。 */
const saveBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * 备份视图的数据与动作编排。
 *
 * - 远程数据走 TanStack Query（列表 + 恢复状态），组件只读缓存；
 * - 创建备份是长任务：走 useTaskAction，201 是完成结果、202 是受理回执并交给
 *   任务中心查询，**不在页面里自己轮询**；
 * - 导入与下载是传输例外（原生 fetch，不进 JSON 契约）：不自动重试；中断或失败
 *   如实说明并提示重新读取核实，绝不谎报成功。
 */
export const useBackups = () => {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [source, setSource] = useState<BackupSourceFilter>("all")
  const [importing, setImporting] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const importAbort = useRef<AbortController | null>(null)
  const downloadAbort = useRef<AbortController | null>(null)

  const listQuery = useBackupsList({
    page,
    pageSize: BACKUP_PAGE_SIZE,
    source: source === "all" ? undefined : source,
  })
  const restoreQuery = useBackupRestoreState()

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: backupKeys.listScope() })
  }

  const create = useTaskAction<DatabaseBackupCreated>({
    kind: TASK_KINDS.databaseBackupCreate,
    target: databaseBackupTaskTarget(),
    run: (requestId) => createDatabaseBackup({ requestId }),
    onCompleted: async (created) => {
      toast.success(created.message)
      await invalidate()
    },
  })

  /**
   * 导入一个 SQLite 备份文件。
   *
   * 先做客户端大小预检：超过 8GiB 直接拒绝、不发请求（服务端也会按
   * Content-Length 回 413，这里只是让用户少等一次往返）。
   */
  const importBackup = async (file: File): Promise<boolean> => {
    if (importing) return false
    if (file.size > DATABASE_BACKUP_UPLOAD_MAX_BYTES) {
      toast.error(
        `${file.name} 有 ${formatBytes(file.size)}，超过 ${formatBytes(
          DATABASE_BACKUP_UPLOAD_MAX_BYTES
        )} 上限`
      )
      return false
    }
    const controller = new AbortController()
    importAbort.current = controller
    setImporting(true)
    try {
      const created = await uploadDatabaseBackup(file, {
        signal: controller.signal,
        originalFileName: file.name,
      })
      toast.success(`已导入 ${created.backup.fileName}`)
      await invalidate()
      return true
    } catch (error) {
      if (controller.signal.aborted) {
        toast("已取消导入：没有产生新备份")
        return false
      }
      // 上传中断无法确认服务端是否已收下文件：只提示重新读取核实，不自动重传。
      toast.error(
        `导入未完成：${describeError(
          error
        )}。请重新读取列表核实是否已导入，不要重复上传同一文件。`
      )
      return false
    } finally {
      setImporting(false)
      importAbort.current = null
    }
  }

  const cancelImport = (): void => {
    importAbort.current?.abort()
  }

  /** 下载：只读操作，中断只需中止 signal，服务端会随流关闭句柄。 */
  const download = async (backup: DatabaseBackup): Promise<void> => {
    if (downloadingId !== null) return
    const controller = new AbortController()
    downloadAbort.current = controller
    setDownloadingId(backup.id)
    try {
      const result = await downloadDatabaseBackup(backup.id, {
        signal: controller.signal,
      })
      const fileName = result.fileName ?? backup.fileName
      saveBlob(result.blob, fileName)
      toast.success(`已开始保存 ${fileName}`)
    } catch (error) {
      if (controller.signal.aborted) {
        toast("已取消下载")
        return
      }
      toast.error(`下载失败：${describeError(error)}`)
    } finally {
      setDownloadingId(null)
      downloadAbort.current = null
    }
  }

  const cancelDownload = (): void => {
    downloadAbort.current?.abort()
  }

  return {
    // 列表
    backups: listQuery.data?.backups ?? [],
    total: listQuery.data?.total ?? 0,
    totalBytes: listQuery.data?.totalBytes ?? 0,
    directory: listQuery.data?.directory ?? null,
    page: listQuery.data?.page ?? page,
    pageSize: listQuery.data?.pageSize ?? BACKUP_PAGE_SIZE,
    listLoading: listQuery.isPending,
    listError: listQuery.error === null ? null : describeError(listQuery.error),
    source,
    setSource: (next: BackupSourceFilter): void => {
      setSource(next)
      setPage(1)
    },
    setPage,
    refresh: async (): Promise<void> => {
      await listQuery.refetch()
      await restoreQuery.refetch()
    },

    // 创建（长任务：201 完成 / 202 受理）
    createBackup: () => create.run(undefined),
    createBusy: create.busy,

    // 导入（传输例外）
    importBackup,
    importing,
    cancelImport,

    // 下载（传输例外）
    download,
    downloadingId,
    cancelDownload,

    // 恢复状态（本任务只读展示）
    restore: restoreQuery.data ?? null,
    restoreLoading: restoreQuery.isPending,
    restoreError:
      restoreQuery.error === null ? null : describeError(restoreQuery.error),
  }
}
