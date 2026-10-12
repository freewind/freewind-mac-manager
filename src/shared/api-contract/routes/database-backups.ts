import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import {
  ApiErrorSchema,
  TaskAcceptedSchema,
  TaskRequestIdHeadersSchema,
} from "../schemas/common"
import {
  DatabaseBackupCreatedSchema,
  DatabaseBackupDeleteBodySchema,
  DatabaseBackupDeleteResultSchema,
  DatabaseBackupErrorSchema,
  DatabaseBackupIdPathParamsSchema,
  DatabaseBackupSchema,
  DatabaseBackupsQuerySchema,
  DatabaseBackupsResponseSchema,
  DatabaseRestorePlanBodySchema,
  DatabaseRestorePlanSchema,
  DatabaseRestoreStateSchema,
} from "../schemas/database-backups"

/**
 * 备份管理的端点。
 *
 * 401 走认证中间件的公共结构（没有备份错误码），其余业务错误都带稳定的 `code`；
 * 未预期异常只回公共 message。
 *
 * 上传与下载是文件传输，不在 JSON 契约里伪装：它们只声明在 `ApiPath`，
 * 见 `src/shared/api-path/index.ts` 里的说明（大小上限、认证与错误行为）。
 */
const errorResponses = {
  400: DatabaseBackupErrorSchema,
  401: ApiErrorSchema,
  403: DatabaseBackupErrorSchema,
  404: DatabaseBackupErrorSchema,
  409: DatabaseBackupErrorSchema,
  429: DatabaseBackupErrorSchema,
  500: ApiErrorSchema,
} as const

export const databaseBackupRoutes = {
  // 备份列表：只读，按创建时间倒序，支持按来源筛选与分页。
  listDatabaseBackups: {
    method: "GET",
    path: toContractPath(ApiPath.databaseBackups),
    query: DatabaseBackupsQuerySchema,
    responses: {
      200: DatabaseBackupsResponseSchema,
      ...errorResponses,
    },
  },
  // 单份备份详情：恢复前核对内容签名用。
  getDatabaseBackup: {
    method: "GET",
    path: toContractPath(ApiPath.databaseBackup),
    pathParams: DatabaseBackupIdPathParamsSchema,
    responses: {
      200: DatabaseBackupSchema,
      ...errorResponses,
    },
  },
  // 创建备份：可能长耗时，走现有任务受理与查询体系。
  // 201 只代表备份已经完整发布（可以用于恢复），202 是受理回执、动作仍在执行。
  createDatabaseBackup: {
    method: "POST",
    path: toContractPath(ApiPath.databaseBackups),
    body: c.noBody(),
    headers: TaskRequestIdHeadersSchema,
    responses: {
      201: DatabaseBackupCreatedSchema,
      202: TaskAcceptedSchema,
      ...errorResponses,
    },
  },
  // 删除旧备份：逐条结果，不做整批回滚（备份是彼此独立的文件）。
  deleteDatabaseBackups: {
    method: "POST",
    path: toContractPath(ApiPath.databaseBackupsDelete),
    body: DatabaseBackupDeleteBodySchema,
    responses: {
      200: DatabaseBackupDeleteResultSchema,
      ...errorResponses,
    },
  },
  // 提交恢复计划：201 只代表计划已创建，**绝不表示当前数据库已恢复**。
  // 计划要等重启才生效，状态另有 GET 查询途径；这里不用 202 掩盖「等待重启」。
  planDatabaseRestore: {
    method: "POST",
    path: toContractPath(ApiPath.databaseBackupRestore),
    body: DatabaseRestorePlanBodySchema,
    responses: {
      201: DatabaseRestorePlanSchema,
      ...errorResponses,
    },
  },
  // 恢复状态：计划状态与「当前库是否已核实是这份备份」分开表达。
  getDatabaseRestoreState: {
    method: "GET",
    path: toContractPath(ApiPath.databaseBackupRestore),
    responses: {
      200: DatabaseRestoreStateSchema,
      ...errorResponses,
    },
  },
  // 取消尚未执行的恢复计划；已经开始应用的计划不可取消（409）。
  cancelDatabaseRestore: {
    method: "DELETE",
    path: toContractPath(ApiPath.databaseBackupRestore),
    body: c.noBody(),
    responses: {
      200: DatabaseRestorePlanSchema,
      ...errorResponses,
    },
  },
} as const
