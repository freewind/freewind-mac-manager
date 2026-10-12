import { z } from "zod"
import { ApiErrorSchema } from "./common"

/**
 * 数据库备份管理的契约：备份条目、列表、创建结果、批量删除结果、恢复计划与状态。
 *
 * 备份用 SQLite 原生备份能力生成，文件名带 UTC 毫秒时间戳与短 ID，**同名不覆盖**；
 * 上传导入的原始文件名只用于展示，绝不作为路径来源。
 *
 * 与大小有关的实现要求（服务端必须遵守，契约只固定边界）：
 * - 备份与导入都必须**流式**处理文件，不得整文件读入内存；
 * - 接收上传前先检查目标磁盘可用空间，不够就直接拒绝，不做部分写入；
 * - 上限按「本机当前库规模的若干倍」留余量，不凭感觉取值。
 *
 * JSON 响应只带元信息（文件名、字节数、签名等），不含文件内容，
 * 因此列表与详情的响应体大小与备份体积无关；文件本身走上传/下载两条传输路径。
 */

/** 备份列表一页最多 100 条。 */
export const DATABASE_BACKUP_PAGE_SIZE_MAX = 100
/** 一次最多删除 100 份备份。 */
export const DATABASE_BACKUP_DELETE_MAX = 100
/**
 * 上传导入的备份文件大小上限：8GiB。
 *
 * 依据：本机应用库 `data/snapshots.sqlite3` 已经是 1.8GB（另有 675MB WAL），
 * 用本应用自己生成的备份去导入必须能通过，所以上限要覆盖真实备份并留出余量；
 * 取当前库规模的几倍（8GiB）而不是刚够用。
 * 超过上限直接拒绝，不做部分写入；实现必须流式接收并预先检查磁盘可用空间。
 */
export const DATABASE_BACKUP_UPLOAD_MAX_BYTES = 8 * 1024 * 1024 * 1024
/** 内容签名与结构签名的长度上限。 */
export const DATABASE_BACKUP_SIGNATURE_MAX_LENGTH = 128

/**
 * 上传大小校验：正好等于上限允许，超过即拒绝。
 * 用于接收前根据 Content-Length 先挡一次，真正落地时仍要边收边计数。
 */
export const DatabaseBackupUploadSizeSchema = z
  .number()
  .int()
  .min(1)
  .max(DATABASE_BACKUP_UPLOAD_MAX_BYTES)

/**
 * 备份 ID：只允许字母、数字、下划线与连字符，因此不可能出现 `.` `/` `..`
 * 这类路径穿越片段；它同时用于拼备份文件名。
 */
export const DatabaseBackupIdSchema = z
  .string()
  .min(6)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/, "备份 ID 只能是字母、数字、下划线与连字符")

/**
 * 备份文件名：`snapshots-<UTC 毫秒时间戳>-<短 ID>.sqlite3`，
 * 例如 `snapshots-20261012T093405123Z-ab12cd.sqlite3`。
 * 时间戳是 UTC（结尾 Z）且精确到毫秒；同名不覆盖，重复时由服务端换短 ID 重生成。
 */
export const DATABASE_BACKUP_FILENAME_PATTERN =
  /^snapshots-\d{8}T\d{6}\d{3}Z-[A-Za-z0-9_-]{6,32}\.sqlite3$/

export const DatabaseBackupFileNameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    DATABASE_BACKUP_FILENAME_PATTERN,
    "备份文件名必须是 snapshots-<UTC 时间戳>-<短 ID>.sqlite3"
  )

/** 备份来源：手工创建、上传导入、恢复前的自动快照。 */
export const DATABASE_BACKUP_SOURCES = [
  "manual",
  "import",
  "pre_restore",
] as const
export const DatabaseBackupSourceSchema = z.enum(DATABASE_BACKUP_SOURCES)

/** 备份文件是否完整可用；不可用时必须说明原因，不能只给一个 false。 */
export const DatabaseBackupIntegritySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.string().min(1).max(200),
  }),
])

export const DatabaseBackupSchema = z.object({
  id: DatabaseBackupIdSchema,
  fileName: DatabaseBackupFileNameSchema,
  /** 创建时间：UTC 毫秒时间戳。 */
  createdAt: z.number().int().min(0),
  /**
   * 文件字节数。刻意不设人为上限：备份就是当前库的快照，库长到多大备份就有多大，
   * 卡一个「产物上限」只会让真实文件被契约判为非法。
   * JS number 能精确表示到 2^53 字节（约 9PB），够用。
   */
  sizeBytes: z.number().int().min(0),
  source: DatabaseBackupSourceSchema,
  integrity: DatabaseBackupIntegritySchema,
  /** 备份内容签名：恢复前核对，避免选中后被替换。 */
  contentSignature: z
    .string()
    .min(16)
    .max(DATABASE_BACKUP_SIGNATURE_MAX_LENGTH),
  /** 概览信息；尚未统计时为 null，不冒充 0。 */
  tableCount: z.number().int().min(0).nullable(),
  rowCount: z.number().int().min(0).nullable(),
  /** 上传导入时的原始文件名：只用于展示，绝不是路径来源。 */
  originalFileName: z.string().max(255).nullable(),
  /**
   * 恢复阻塞原因：null 表示具备恢复到本应用所需的结构；
   * 非空是具体原因（例如缺少应用必要表），此时仍可在列表中查看与删除，
   * 但不允许用于替换应用数据库。与文件完整性（integrity）分开判断。
   */
  restoreBlockedReason: z.string().max(500).nullable(),
})

export const DatabaseBackupsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(DATABASE_BACKUP_PAGE_SIZE_MAX)
    .default(50),
  source: DatabaseBackupSourceSchema.optional(),
})

export const DatabaseBackupsResponseSchema = z.object({
  backups: z.array(DatabaseBackupSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  /** 备份目录（展示用）与全部备份占用字节数。 */
  directory: z.string().min(1),
  totalBytes: z.number().int().min(0),
})

/** 创建备份完成：201 只代表备份已经完整发布，可以用于恢复。 */
export const DatabaseBackupCreatedSchema = z.object({
  backup: DatabaseBackupSchema,
  message: z.string().min(1).max(200),
})

export const DatabaseBackupIdPathParamsSchema = z.object({
  backupId: DatabaseBackupIdSchema,
})

/** 删除项带内容签名：防止选中之后备份被换掉。 */
export const DatabaseBackupDeleteItemSchema = z.object({
  id: DatabaseBackupIdSchema,
  expectedSignature: z
    .string()
    .min(16)
    .max(DATABASE_BACKUP_SIGNATURE_MAX_LENGTH),
})

export const DatabaseBackupDeleteBodySchema = z.object({
  items: z
    .array(DatabaseBackupDeleteItemSchema)
    .min(1)
    .max(DATABASE_BACKUP_DELETE_MAX),
})

export const DatabaseBackupDeleteFailureSchema = z.object({
  id: DatabaseBackupIdSchema,
  message: z.string().min(1).max(200),
})

/**
 * 删除结果是逐条的：备份是彼此独立的文件，不做整批回滚，
 * 因此必须同时给出成功与失败的条目，不能只回一个总数。
 */
export const DatabaseBackupDeleteResultSchema = z.object({
  deleted: z.array(DatabaseBackupIdSchema),
  failed: z.array(DatabaseBackupDeleteFailureSchema),
})

/**
 * 恢复状态：
 * - planned：计划已创建，等待重启生效（**不代表数据库已恢复**）；
 * - applying：重启后正在应用；
 * - applied：已应用并核实；
 * - failed：应用失败；
 * - cancelled：未执行前被取消；
 * - unknown：无法核实（服务中断等），必须靠重新读取确认。
 */
export const DATABASE_RESTORE_STATUSES = [
  "planned",
  "applying",
  "applied",
  "failed",
  "cancelled",
  "unknown",
] as const
export const DatabaseRestoreStatusSchema = z.enum(DATABASE_RESTORE_STATUSES)

/** 允许的状态迁移；终态不再变化。 */
export const DATABASE_RESTORE_TRANSITIONS: Record<
  (typeof DATABASE_RESTORE_STATUSES)[number],
  readonly (typeof DATABASE_RESTORE_STATUSES)[number][]
> = {
  planned: ["applying", "cancelled", "unknown"],
  applying: ["applied", "failed", "unknown"],
  applied: [],
  failed: [],
  cancelled: [],
  unknown: [],
}

export const canTransitionRestore = (
  from: (typeof DATABASE_RESTORE_STATUSES)[number],
  to: (typeof DATABASE_RESTORE_STATUSES)[number]
): boolean => DATABASE_RESTORE_TRANSITIONS[from].includes(to)

export const DatabaseRestorePlanSchema = z
  .object({
    id: z.string().min(6).max(64),
    backupId: DatabaseBackupIdSchema,
    backupFileName: DatabaseBackupFileNameSchema,
    status: DatabaseRestoreStatusSchema,
    /** 计划创建时间：UTC 毫秒。 */
    createdAt: z.number().int().min(0),
    /** 最近一次状态变化时间：UTC 毫秒。 */
    updatedAt: z.number().int().min(0),
    /** 可读说明，例如「重启服务后生效」。 */
    message: z.string().min(1).max(300),
    /** 结果未知的原因；只在 status=unknown 时有值。 */
    unknownReason: z.string().max(200).nullable(),
  })
  .superRefine((plan, ctx) => {
    if (plan.status === "unknown" && plan.unknownReason === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "状态未知时必须说明原因",
        path: ["unknownReason"],
      })
    }
    if (plan.status !== "unknown" && plan.unknownReason !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "只有状态未知时才允许填写原因",
        path: ["unknownReason"],
      })
    }
  })

export const DatabaseRestorePlanBodySchema = z.object({
  backupId: DatabaseBackupIdSchema,
  /** 提交时核对备份内容签名，避免选中后被替换。 */
  expectedSignature: z
    .string()
    .min(16)
    .max(DATABASE_BACKUP_SIGNATURE_MAX_LENGTH),
  /** 恢复前是否先自动生成一份 pre_restore 备份（默认生成）。 */
  backupCurrent: z.boolean().default(true),
})

/**
 * 恢复状态查询：计划状态与「当前库是否已经真的是这份备份」分开表达，
 * 不能只凭计划存在就宣称已恢复。
 */
export const DatabaseRestoreStateSchema = z
  .object({
    plan: DatabaseRestorePlanSchema.nullable(),
    /**
     * 已核实 = 恢复执行成功并通过复验（完整性、结构与应用必要表）。
     * 服务能应答本状态即表示启动迁移已通过，因此计划 applied 时即为已核实；
     * 不与后续写入的库字节比对——运行中流量采样与业务操作必然持续写库，
     * 字节比对在生产上永远不成立。恢复完成时的库字节指纹记录在计划回执
     * （finalSignature）里，仅作诊断，不参与本判定。
     */
    verified: z.boolean(),
  })
  .superRefine((state, ctx) => {
    // 「已核实」只能跟在已应用的计划后面：未应用就宣称核实是谎报。
    if (state.verified && state.plan?.status !== "applied") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "只有已应用（applied）的计划才能宣称已核实",
        path: ["verified"],
      })
    }
  })

/** 备份相关的稳定错误码：前端据此分支，文案仍走 message。 */
export const DATABASE_BACKUP_ERROR_CODES = [
  "backup_not_found",
  "backup_invalid",
  "signature_mismatch",
  "restore_plan_pending",
  "restore_not_cancellable",
  "too_large",
  "unsupported_format",
] as const
export const DatabaseBackupErrorCodeSchema = z.enum(DATABASE_BACKUP_ERROR_CODES)

export const DatabaseBackupErrorSchema = ApiErrorSchema.extend({
  code: DatabaseBackupErrorCodeSchema,
})
