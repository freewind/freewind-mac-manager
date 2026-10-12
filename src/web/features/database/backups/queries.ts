import type {
  DatabaseBackupsQueryInput,
  DatabaseBackupsResponse,
  DatabaseRestoreState,
} from "@shared/api-contract"
import {
  fetchDatabaseBackups,
  fetchDatabaseRestoreState,
} from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"

const ALL = ["database", "backups"] as const

/** 列表默认页大小：与服务端默认一致，避免前后端各说一套。 */
export const BACKUP_PAGE_SIZE = 50

/** 备份域的查询 key：页码、页大小与来源全部进 key，动作后按 listScope 统一失效。 */
export const backupKeys = {
  all: ALL,
  list: (query: DatabaseBackupsQueryInput) =>
    [
      ...ALL,
      "list",
      query.page ?? 1,
      query.pageSize ?? BACKUP_PAGE_SIZE,
      query.source ?? "all",
    ] as const,
  /** 列表全域（不限页码与筛选），用于创建/导入之后失效。 */
  listScope: () => [...ALL, "list"] as const,
  restoreState: () => [...ALL, "restore"] as const,
}

/** 恢复状态的轮询节奏：只在「计划尚未终结」时启用。 */
export const RESTORE_STATE_POLL_MS = 5000

/**
 * 恢复状态要不要继续轮询。
 *
 * `verified=true` 必须立刻停：计划进入 applied 之后，服务端每轮都会流式重算
 * 整库内容签名（本机库 1.8GB，单次 1–2 秒 CPU 与磁盘 IO），已经核实过就不该
 * 再算一次。没有计划、以及 applied / failed / cancelled 这些终态同样不轮询，
 * 只有等待重启生效（planned）与正在应用（applying）才需要盯着。
 */
export const restoreStatePollMs = (
  state: DatabaseRestoreState | undefined
): number | false => {
  if (state === undefined || state.verified) return false
  const status = state.plan?.status
  return status === "planned" || status === "applying"
    ? RESTORE_STATE_POLL_MS
    : false
}

/** 备份列表：只读，分页与来源筛选都进 key。 */
export const useBackupsList = (query: DatabaseBackupsQueryInput) =>
  useQuery({
    queryKey: backupKeys.list(query),
    queryFn: async ({ signal }): Promise<DatabaseBackupsResponse> =>
      fetchDatabaseBackups(query, { signal }),
  })

/**
 * 恢复状态：计划状态与「当前库是否已核实就是这份备份」由服务端分开返回，
 * 这里原样透传，不做前端合并判断。
 */
export const useBackupRestoreState = () =>
  useQuery({
    queryKey: backupKeys.restoreState(),
    queryFn: async ({ signal }): Promise<DatabaseRestoreState> =>
      fetchDatabaseRestoreState({ signal }),
    refetchInterval: (query) => restoreStatePollMs(query.state.data),
  })
