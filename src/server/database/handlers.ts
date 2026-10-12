import { publicSystemError } from "@server/common/public-error"
import type {
  DatabaseDeleteResult,
  DatabaseRecordResponse,
  DatabaseRecordsResponse,
  DatabaseTable,
  DatabaseTablesResponse,
} from "@shared/api-contract"
import { contract } from "@shared/api-contract"
import { initServer } from "@ts-rest/express"
import { DatabaseMutationError } from "./mutation-protocol"
import {
  createMutationRunner,
  type DatabaseMutationRunner,
  type MutationDeleteInput,
  type MutationInsertInput,
  type MutationUpdateInput,
} from "./mutation-runner"
import { DatabaseQueryError } from "./query-protocol"
import {
  createQueryRunner,
  type DatabaseGetRecordInput,
  type DatabaseListRecordsInput,
  type DatabaseQueryRunner,
} from "./query-runner"

const s = initServer()

/** 只挑 database 域的 7 条路由。 */
export const databaseContract = {
  listDatabaseTables: contract.listDatabaseTables,
  getDatabaseTable: contract.getDatabaseTable,
  listDatabaseRecords: contract.listDatabaseRecords,
  getDatabaseRecord: contract.getDatabaseRecord,
  createDatabaseRecord: contract.createDatabaseRecord,
  updateDatabaseRecord: contract.updateDatabaseRecord,
  deleteDatabaseRecords: contract.deleteDatabaseRecords,
}

/**
 * database 域对外的服务面：只读走查询子进程，写入走写子进程。
 * handler 只依赖这一层，测试可以整体替换，不必碰真实业务库。
 */
export type DatabaseService = {
  listTables: () => Promise<DatabaseTablesResponse>
  getTable: (table: string) => Promise<DatabaseTable>
  listRecords: (
    input: DatabaseListRecordsInput
  ) => Promise<DatabaseRecordsResponse>
  getRecord: (input: DatabaseGetRecordInput) => Promise<DatabaseRecordResponse>
  insert: (input: MutationInsertInput) => Promise<DatabaseRecordResponse>
  update: (input: MutationUpdateInput) => Promise<DatabaseRecordResponse>
  delete: (input: MutationDeleteInput) => Promise<DatabaseDeleteResult>
  shutdown: () => void
}

export type DatabaseServiceOptions = {
  /** 只允许测试注入；生产用 env.DATABASE_FILE 的默认值。 */
  env?: NodeJS.ProcessEnv
  queryRunner?: DatabaseQueryRunner
  mutationRunner?: DatabaseMutationRunner
}

export const createDatabaseService = (
  options: DatabaseServiceOptions = {}
): DatabaseService => {
  const query = options.queryRunner ?? createQueryRunner({ env: options.env })
  const mutation =
    options.mutationRunner ?? createMutationRunner({ env: options.env })
  return {
    listTables: () => query.listTables(),
    getTable: (table) => query.getTable(table),
    listRecords: (input) => query.listRecords(input),
    getRecord: (input) => query.getRecord(input),
    insert: (input) => mutation.insert(input),
    update: (input) => mutation.update(input),
    delete: (input) => mutation.delete(input),
    shutdown: () => {
      query.shutdown()
      mutation.shutdown()
    },
  }
}

type ErrorStatus = 400 | 403 | 404 | 409 | 429 | 500

type ErrorBody = {
  message: string
  executionStatus?: "not_started" | "failed" | "unknown"
}

/**
 * 域内错误带自己的语义状态码与执行状态；其余异常走公共的公开化模式，
 * 内部 SQL、路径与堆栈都留在服务端日志，不进响应体。
 */
const mapError = (error: unknown): { status: ErrorStatus; body: ErrorBody } => {
  if (error instanceof DatabaseMutationError) {
    return {
      status: error.httpStatus,
      body: {
        message: error.message,
        executionStatus: error.executionStatus,
      },
    }
  }
  if (error instanceof DatabaseQueryError) {
    return { status: error.httpStatus, body: { message: error.message } }
  }
  return publicSystemError(error)
}

const fail = (error: unknown): { status: ErrorStatus; body: ErrorBody } =>
  mapError(error)

export const createDatabaseRouter = (service: DatabaseService) =>
  s.router(databaseContract, {
    listDatabaseTables: async () => {
      try {
        return { status: 200 as const, body: await service.listTables() }
      } catch (error) {
        return fail(error)
      }
    },

    getDatabaseTable: async ({ params }) => {
      try {
        return {
          status: 200 as const,
          body: await service.getTable(params.table),
        }
      } catch (error) {
        return fail(error)
      }
    },

    listDatabaseRecords: async ({ params, query }) => {
      try {
        return {
          status: 200 as const,
          body: await service.listRecords({
            table: params.table,
            page: query.page,
            pageSize: query.pageSize,
            filters: query.filters,
            sorts: query.sorts,
          }),
        }
      } catch (error) {
        return fail(error)
      }
    },

    getDatabaseRecord: async ({ params, query }) => {
      try {
        return {
          status: 200 as const,
          body: await service.getRecord({
            table: params.table,
            key: query.key,
          }),
        }
      } catch (error) {
        return fail(error)
      }
    },

    // 新增：201 与创建后的记录（含签名），调用方不必再读一次
    createDatabaseRecord: async ({ params, body }) => {
      try {
        return {
          status: 201 as const,
          body: await service.insert({
            table: params.table,
            values: body.values,
          }),
        }
      } catch (error) {
        return fail(error)
      }
    },

    updateDatabaseRecord: async ({ params, body }) => {
      try {
        return {
          status: 200 as const,
          body: await service.update({
            table: params.table,
            key: body.key,
            expectedSignature: body.expectedSignature,
            values: body.values,
          }),
        }
      } catch (error) {
        return fail(error)
      }
    },

    deleteDatabaseRecords: async ({ params, body }) => {
      try {
        return {
          status: 200 as const,
          body: await service.delete({
            table: params.table,
            items: body.items,
          }),
        }
      } catch (error) {
        return fail(error)
      }
    },
  })
