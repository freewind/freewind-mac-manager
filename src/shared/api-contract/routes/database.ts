import { ApiPath, toContractPath } from "@shared/api-path"
import { ApiErrorSchema } from "../schemas/common"
import {
  DatabaseDeleteBodySchema,
  DatabaseDeleteResultSchema,
  DatabaseInsertBodySchema,
  DatabaseRecordQuerySchema,
  DatabaseRecordResponseSchema,
  DatabaseRecordsQuerySchema,
  DatabaseRecordsResponseSchema,
  DatabaseTablePathParamsSchema,
  DatabaseTableSchema,
  DatabaseTablesResponseSchema,
  DatabaseUpdateBodySchema,
} from "../schemas/database"

/**
 * 通用数据管理：表名只是路径参数，不在契约里写死任何业务表。
 * 每个端点都显式声明 400/401/403/404/409/429/500，错误不合并成一种。
 */
const errorResponses = {
  400: ApiErrorSchema,
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  429: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const databaseRoutes = {
  // 列出可管理的表与视图，附带每张表的操作能力；只读。
  listDatabaseTables: {
    method: "GET",
    path: toContractPath(ApiPath.databaseTables),
    responses: {
      200: DatabaseTablesResponseSchema,
      ...errorResponses,
    },
  },
  // 读取单表结构：列、约束、主键与结构签名；只读。
  getDatabaseTable: {
    method: "GET",
    path: toContractPath(ApiPath.databaseTable),
    pathParams: DatabaseTablePathParamsSchema,
    responses: {
      200: DatabaseTableSchema,
      ...errorResponses,
    },
  },
  // 分页读取记录，支持筛选与排序；只读，不产生任何写入副作用。
  listDatabaseRecords: {
    method: "GET",
    path: toContractPath(ApiPath.databaseRecords),
    pathParams: DatabaseTablePathParamsSchema,
    query: DatabaseRecordsQuerySchema,
    responses: {
      200: DatabaseRecordsResponseSchema,
      ...errorResponses,
    },
  },
  // 单条记录：复合主键放进 query，路径里只保留表名。
  getDatabaseRecord: {
    method: "GET",
    path: toContractPath(ApiPath.databaseRecord),
    pathParams: DatabaseTablePathParamsSchema,
    query: DatabaseRecordQuerySchema,
    responses: {
      200: DatabaseRecordResponseSchema,
      ...errorResponses,
    },
  },
  // 新增一行：201 与创建后的记录，调用方据此拿到签名，不必再读一次。
  createDatabaseRecord: {
    method: "POST",
    path: toContractPath(ApiPath.databaseRecords),
    pathParams: DatabaseTablePathParamsSchema,
    body: DatabaseInsertBodySchema,
    responses: {
      201: DatabaseRecordResponseSchema,
      ...errorResponses,
    },
  },
  // 修改一行：主键与 expectedSignature 都在 body 里，缺少就拒绝，不做整表更新。
  updateDatabaseRecord: {
    method: "PATCH",
    path: toContractPath(ApiPath.databaseRecords),
    pathParams: DatabaseTablePathParamsSchema,
    body: DatabaseUpdateBodySchema,
    responses: {
      200: DatabaseRecordResponseSchema,
      ...errorResponses,
    },
  },
  // 批量删除是一次复杂动作，用 POST；单条删除复用一个元素。
  // DELETE 不允许带 body，所以不走 DELETE 方法。
  deleteDatabaseRecords: {
    method: "POST",
    path: toContractPath(ApiPath.databaseRecordDelete),
    pathParams: DatabaseTablePathParamsSchema,
    body: DatabaseDeleteBodySchema,
    responses: {
      200: DatabaseDeleteResultSchema,
      ...errorResponses,
    },
  },
} as const
