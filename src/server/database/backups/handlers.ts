import {
  PublicOperationError,
  publicSystemError,
} from "@server/common/public-error"
import { toTaskHttpResponse } from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import {
  contract,
  type DatabaseBackupCreated,
  DatabaseBackupCreatedSchema,
  type DatabaseBackupErrorCode,
  DatabaseBackupIdPathParamsSchema,
  TASK_REQUEST_ID_HEADER,
} from "@shared/api-contract"
import { ApiPath } from "@shared/api-path"
import { formatBytes } from "@shared/format"
import { initServer } from "@ts-rest/express"
import type express from "express"
import { DatabaseBackupError } from "./files"
import {
  cancelRestorePlan,
  readRestorePlan,
  submitRestorePlan,
  toContractRestorePlan,
} from "./restore-plan"
import { createDatabaseBackupService } from "./service"
import { DATABASE_BACKUP_CREATE_KIND, databaseBackupTaskTarget } from "./task"
import {
  BACKUP_UPLOAD_MAX_BYTES,
  BACKUP_UPLOAD_TIMEOUT_MS,
  openBackupDownload,
} from "./transfer"

/**
 * 备份管理的 HTTP 边界：handler 只做入参到服务的映射与状态码裁决，
 * 业务与 IO 全部留在服务层（service / restore-plan / transfer）。
 *
 * 状态码语义：
 * - 读取 200；创建 201（已完整发布）或 202（受理回执，动作仍在执行）；
 * - 提交恢复计划 201 只代表计划已创建（另有 GET 查询状态，不把「有副作用」
 *   当 202 的理由）；409 表示状态冲突（已有活动计划、签名不匹配、计划不可
 *   取消、同目标任务已在跑）；404 不存在；400 入参或内容不合格；
 * - 危险动作（删除、提交计划、取消计划）由服务层重新校验目标、签名与当前
 *   状态，不信任客户端带来的对象信息。
 *
 * 上传与下载是传输例外，不进 JSON 契约（只在 ApiPath 定义），由
 * `registerDatabaseBackupTransferEndpoints` 独立挂载；上传大小上限沿用契约
 * 的 8 GiB，超限回 413。
 */

const s = initServer()

/** 只挑备份域的路由注册，其余端由各自 handler 提供并在 app.ts 合并。 */
/**
 * 注册顺序有意义：GET /backups/restore 会被 GET /backups/:backupId 抢先匹配
 * （"restore" 是合法 ID 段），因此恢复状态必须排在详情之前注册。
 */
export const databaseBackupContract = {
  listDatabaseBackups: contract.listDatabaseBackups,
  getDatabaseRestoreState: contract.getDatabaseRestoreState,
  getDatabaseBackup: contract.getDatabaseBackup,
  createDatabaseBackup: contract.createDatabaseBackup,
  deleteDatabaseBackups: contract.deleteDatabaseBackups,
  planDatabaseRestore: contract.planDatabaseRestore,
  cancelDatabaseRestore: contract.cancelDatabaseRestore,
}

type BackupErrorBody = {
  message: string
  code: DatabaseBackupErrorCode
}

type BackupErrorResponse =
  | { status: 400; body: BackupErrorBody }
  | { status: 403; body: BackupErrorBody }
  | { status: 404; body: BackupErrorBody }
  | { status: 409; body: BackupErrorBody }
  | { status: 500; body: { message: string } }

/**
 * 错误 → 响应：已知备份错误按码映射（404 不存在、409 状态冲突、400 入参或
 * 内容不合格），每个分支给字面量状态与稳定 code（前端分支用）；
 * 未预期异常走公共兜底，只回通用 message，不泄内部路径与堆栈。
 */
const toBackupErrorResponse = (error: unknown): BackupErrorResponse => {
  if (error instanceof DatabaseBackupError) {
    const body: BackupErrorBody = { message: error.message, code: error.code }
    switch (error.code) {
      case "backup_not_found":
        return { status: 404, body }
      case "signature_mismatch":
      case "restore_plan_pending":
      case "restore_not_cancellable":
        return { status: 409, body }
      case "backup_invalid":
      case "unsupported_format":
      case "too_large":
        return { status: 400, body }
    }
  }
  const mapped = publicSystemError(error)
  if (mapped.status === 500) return { status: 500, body: mapped.body }
  if (mapped.status === 404) {
    return {
      status: 404,
      body: { message: mapped.body.message, code: "backup_not_found" },
    }
  }
  if (mapped.status === 403) {
    return {
      status: 403,
      body: { message: mapped.body.message, code: "backup_invalid" },
    }
  }
  if (mapped.status === 409) {
    return {
      status: 409,
      body: { message: mapped.body.message, code: "backup_invalid" },
    }
  }
  return {
    status: 400,
    body: { message: mapped.body.message, code: "backup_invalid" },
  }
}

export const createDatabaseBackupsRouter = (runtime: TaskRuntime) =>
  s.router(databaseBackupContract, {
    listDatabaseBackups: async ({ query }) => {
      try {
        return {
          status: 200 as const,
          body: createDatabaseBackupService().list(query),
        }
      } catch (error) {
        return toBackupErrorResponse(error)
      }
    },

    // 恢复状态：已核实 = 恢复执行成功并通过复验（完整性、结构与应用必要
    // 表）；服务能应答即表示启动迁移已通过，因此 applied 即已核实。
    // 不与后续写入的库字节比对：运行中必然持续写库，字节比对永远不成立；
    // 恢复完成时的字节指纹只记录在计划回执里作诊断，不参与判定。
    getDatabaseRestoreState: async () => {
      try {
        const read = readRestorePlan()
        if (read.corrupt) {
          throw new PublicOperationError(500, "恢复计划文件损坏，无法读取状态")
        }
        const plan = read.plan
        return {
          status: 200 as const,
          body: {
            plan: plan === null ? null : toContractRestorePlan(plan),
            verified: plan !== null && plan.status === "applied",
          },
        }
      } catch (error) {
        return toBackupErrorResponse(error)
      }
    },

    getDatabaseBackup: async ({ params }) => {
      try {
        const backup = createDatabaseBackupService().get(params.backupId)
        if (backup === null) {
          throw new DatabaseBackupError("backup_not_found", "备份不存在")
        }
        return { status: 200 as const, body: backup }
      } catch (error) {
        return toBackupErrorResponse(error)
      }
    },

    // 长任务走统一运行时：同目标任务互斥、requestId 幂等、进度可查。
    createDatabaseBackup: async ({ headers }) => {
      try {
        const rawRequestId = headers[TASK_REQUEST_ID_HEADER]
        const outcome = await runtime.runner.submit<DatabaseBackupCreated>({
          kind: DATABASE_BACKUP_CREATE_KIND,
          target: databaseBackupTaskTarget(),
          lockTarget: databaseBackupTaskTarget(),
          payload: { source: "manual" },
          requestId: typeof rawRequestId === "string" ? rawRequestId : null,
          toCompletedResponse: (result) => {
            const parsed = DatabaseBackupCreatedSchema.safeParse(result.result)
            if (!parsed.success) {
              throw new Error("备份任务结果不符合契约，不能作为完成结果返回")
            }
            return { status: 201 as const, body: parsed.data }
          },
        })
        return toTaskHttpResponse(outcome, 201)
      } catch (error) {
        return publicSystemError(error)
      }
    },

    // 删除：逐项结果，服务层按签名与状态逐个复核（409 = 签名不符）。
    deleteDatabaseBackups: async ({ body }) => {
      try {
        const result = await createDatabaseBackupService().remove({
          items: body.items,
        })
        return { status: 200 as const, body: result }
      } catch (error) {
        return toBackupErrorResponse(error)
      }
    },

    // 提交恢复计划：服务层重新核验来源身份、签名、完整性与应用兼容性。
    planDatabaseRestore: async ({ body }) => {
      try {
        const plan = submitRestorePlan({
          backupId: body.backupId,
          expectedSignature: body.expectedSignature,
          backupCurrent: body.backupCurrent,
        })
        return { status: 201 as const, body: toContractRestorePlan(plan) }
      } catch (error) {
        return toBackupErrorResponse(error)
      }
    },

    // 取消计划：仅 pending 可取消，其余状态（含已应用）由服务层报 409。
    cancelDatabaseRestore: async () => {
      try {
        return {
          status: 200 as const,
          body: toContractRestorePlan(cancelRestorePlan()),
        }
      } catch (error) {
        return toBackupErrorResponse(error)
      }
    },
  })

/** 传输例外错误 → 状态：上传的大小超限用 413（比 JSON 端点的 400 更准确）。 */
const toTransferErrorResponse = (
  error: unknown
): { status: number; body: { message: string; code?: string } } => {
  const mapped = toBackupErrorResponse(error)
  if (error instanceof DatabaseBackupError && error.code === "too_large") {
    return { status: 413, body: { message: error.message, code: error.code } }
  }
  return { status: mapped.status, body: mapped.body }
}

/** 原始文件名头：编码传输（header 只允许 ASCII），服务端解码后仍只作展示。 */
const ORIGINAL_FILE_NAME_HEADER = "x-file-name"

const decodeOriginalFileName = (value: string | undefined): string | null => {
  if (value === undefined || value.length === 0) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * 备份上传与下载：文件传输端点，独立挂载在认证中间件之后。
 *
 * - 上传：raw request 流式接收（不进 JSON 契约），Content-Length 先过 8 GiB
 *   上限（413），传输总时限由服务层的 GB 级上限把守；文件名只取自请求头、
 *   服务端净化后仅作展示。
 * - 下载：按备份 ID 定位并核验身份，octet-stream + 服务端附件名 + 明确长度；
 *   客户端断开时销毁读流，句柄随流释放，不长期持有。
 */
export const registerDatabaseBackupTransferEndpoints = (
  app: express.Express
): void => {
  app.post(ApiPath.databaseBackupUpload, async (request, response) => {
    try {
      const declared = Number(request.get("content-length") ?? 0)
      if (Number.isFinite(declared) && declared > BACKUP_UPLOAD_MAX_BYTES) {
        response.status(413).json({
          message: `上传文件超过 ${formatBytes(BACKUP_UPLOAD_MAX_BYTES)} 上限`,
          code: "too_large",
        })
        return
      }
      // GB 级上传允许分钟级传输；到点由服务层超时中止并清理临时文件。
      request.setTimeout(BACKUP_UPLOAD_TIMEOUT_MS, () => {
        request.destroy(new Error("上传超时"))
      })
      const created = await createDatabaseBackupService().importUpload({
        source: request,
        declaredLength:
          Number.isFinite(declared) && declared > 0 ? declared : null,
        originalFileName: decodeOriginalFileName(
          request.get(ORIGINAL_FILE_NAME_HEADER)
        ),
      })
      response.status(201).json(created)
    } catch (error) {
      const mapped = toTransferErrorResponse(error)
      response.status(mapped.status).json(mapped.body)
    }
  })

  app.get(ApiPath.databaseBackupDownload, (request, response) => {
    try {
      const params = DatabaseBackupIdPathParamsSchema.safeParse({
        backupId: request.params.backupId,
      })
      if (!params.success) {
        response.status(400).json({
          message: "备份 ID 不合法",
          code: "backup_invalid",
        })
        return
      }
      const handle = openBackupDownload({ backupId: params.data.backupId })
      response.status(200)
      for (const [key, value] of Object.entries(handle.headers)) {
        response.setHeader(key, value)
      }
      // 响应结束或客户端断开都销毁读流：autoClose 会关闭底层句柄。
      response.on("close", () => {
        handle.stream.destroy()
      })
      handle.stream.pipe(response)
    } catch (error) {
      const mapped = toTransferErrorResponse(error)
      response.status(mapped.status).json(mapped.body)
    }
  })
}
