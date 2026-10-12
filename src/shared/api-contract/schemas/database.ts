import { z } from "zod"

/**
 * 应用自身 SQLite 的通用数据管理契约：不写死业务表名，表结构与记录都按这里的
 * 结构描述，新增普通业务表无需再补一套管理代码。
 */

/** 单个文本值上限，按 UTF-8 字节数算：单值不超过 64KiB，超出要明确拒绝。 */
export const DATABASE_TEXT_MAX_LENGTH = 64 * 1024
/** 首期 BLOB 只读，且按字节上限整体编码返回，不做流式。 */
export const DATABASE_BLOB_MAX_BYTES = 64 * 1024
export const DATABASE_PAGE_SIZE_MAX = 100
export const DATABASE_FILTER_MAX = 8
export const DATABASE_SORT_MAX = 4
/** 一次批量删除的上限：超过就分批，避免单个请求长时间占用写锁。 */
export const DATABASE_DELETE_MAX = 100
/** 单表列数上限，同时约束一次写入的列数，避免超宽表拼出超长语句。 */
export const DATABASE_COLUMN_MAX = 512
export const DATABASE_IDENTIFIER_MAX_LENGTH = 128

const BLOB_BASE64_MAX_LENGTH = Math.ceil(DATABASE_BLOB_MAX_BYTES / 3) * 4

/**
 * 表名与列名：SQLite 允许任意字符，所以这里只挡空值、控制字符与超长，
 * 让带空格、引号、非 ASCII 的真实表列名也能表达。服务端仍必须按标识符引用。
 */
export const DatabaseIdentifierSchema = z
  .string()
  .min(1)
  .max(DATABASE_IDENTIFIER_MAX_LENGTH)
  .refine((value) => !/\p{Cc}/u.test(value), "标识符不能包含控制字符")

/**
 * SQLite 的值按存储类带标签传递。integer 用十进制字符串：JS number 存不下
 * int64，超过 2^53 就会静默丢精度。
 */
const sqliteNullValue = z.object({ type: z.literal("null") })

const sqliteTextValue = z.object({
  type: z.literal("text"),
  value: z
    .string()
    .refine(
      (value) =>
        new TextEncoder().encode(value).length <= DATABASE_TEXT_MAX_LENGTH,
      `文本超过 ${DATABASE_TEXT_MAX_LENGTH / 1024}KiB`
    ),
})

const sqliteIntegerValue = z.object({
  type: z.literal("integer"),
  value: z.string().superRefine((value, ctx) => {
    // 先挡非十进制写法，BigInt 遇到 "1e5" 会直接抛异常
    if (!/^-?\d{1,19}$/.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "整数必须是十进制字符串",
      })
      return
    }
    const parsed = BigInt(value)
    if (parsed < -9223372036854775808n || parsed > 9223372036854775807n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "整数超出 SQLite 的 int64 范围",
      })
    }
  }),
})

/**
 * 查询串里的数字都会是字符串，所以这里同时接受 number 与十进制数字串，
 * 统一收敛成 number；显式 null、布尔值不在此列，避免被误当成 0。
 */
const sqliteRealValue = z.object({
  type: z.literal("real"),
  value: z.union([
    z.number().finite(),
    z
      .string()
      .regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/, "实数格式不正确")
      .transform((value) => Number(value))
      .refine((value) => Number.isFinite(value), "实数超出可表示范围"),
  ]),
})

const sqliteBlobValue = z.object({
  type: z.literal("blob"),
  /** 标准 base64，且不超过 DATABASE_BLOB_MAX_BYTES 对应的编码长度。 */
  base64: z
    .string()
    .max(BLOB_BASE64_MAX_LENGTH)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "BLOB 必须是标准 base64"),
})

/** 读取侧取值：五种存储类都可能有。 */
export const SqliteValueSchema = z.discriminatedUnion("type", [
  sqliteNullValue,
  sqliteTextValue,
  sqliteIntegerValue,
  sqliteRealValue,
  sqliteBlobValue,
])

/** 写入侧取值：首期 BLOB 只读，所以这里没有 blob 分支。 */
export const SqliteWritableValueSchema = z.discriminatedUnion("type", [
  sqliteNullValue,
  sqliteTextValue,
  sqliteIntegerValue,
  sqliteRealValue,
])

/** SQLite 的列亲和性；numeric 是 INT/REAL/NUMERIC 等声明类型的归并结果。 */
export const DATABASE_COLUMN_AFFINITIES = [
  "integer",
  "real",
  "text",
  "blob",
  "numeric",
] as const
export const DatabaseColumnAffinitySchema = z.enum(DATABASE_COLUMN_AFFINITIES)

/** 表级禁用原因：为什么某个操作在这张表上不可用。 */
export const DATABASE_OPERATION_DISABLED_REASONS = [
  /** 视图没有可直接写入的存储。 */
  "view",
  /** 虚拟表（如 fts5）没有普通存储，不支持通用写入。 */
  "virtual_table",
  /** 虚拟表的影子表是实现细节，不直接对外写入。 */
  "shadow_table",
  /** SQLite 内部表，不对外暴露写操作。 */
  "system_table",
  /** 没有显式可靠的非空唯一主键，无法安全定位单条记录。 */
  "no_primary_key",
] as const
export const DatabaseOperationDisabledReasonSchema = z.enum(
  DATABASE_OPERATION_DISABLED_REASONS
)

/** 列级禁用原因：为什么这一列不能写入。 */
export const DATABASE_COLUMN_DISABLED_REASONS = [
  /** 生成列由数据库计算，写入必然失败。 */
  "generated",
  /** 虚拟表隐藏列，不参与普通读写。 */
  "hidden",
  /** 首期 BLOB 只读。 */
  "blob_read_only",
] as const
export const DatabaseColumnDisabledReasonSchema = z.enum(
  DATABASE_COLUMN_DISABLED_REASONS
)

export const DATABASE_OPERATIONS = [
  "read",
  "insert",
  "update",
  "delete",
] as const
export const DatabaseOperationSchema = z.enum(DATABASE_OPERATIONS)

/**
 * 操作能力：allowed=false 时必须给出原因与可读说明，页面直接展示，
 * 不能只留一个禁用的按钮。
 */
export const DatabaseCapabilitySchema = z.discriminatedUnion("allowed", [
  z.object({
    operation: DatabaseOperationSchema,
    allowed: z.literal(true),
  }),
  z.object({
    operation: DatabaseOperationSchema,
    allowed: z.literal(false),
    reason: DatabaseOperationDisabledReasonSchema,
    message: z.string().min(1).max(200),
  }),
])

/**
 * 列的写入能力只表示这一列自身是否可写（生成列、隐藏列、BLOB）；
 * 整张表是否可写由表级 capabilities 决定，例如视图的列也标可写但表不可写。
 */
export const DatabaseColumnWriteSchema = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true) }),
  z.object({
    allowed: z.literal(false),
    reason: DatabaseColumnDisabledReasonSchema,
    message: z.string().min(1).max(200),
  }),
])

export const DatabaseColumnSchema = z.object({
  name: DatabaseIdentifierSchema,
  /** 建表时的声明类型原文；SQLite 允许空类型，此时为空串。 */
  declaredType: z.string().max(64),
  affinity: DatabaseColumnAffinitySchema,
  notNull: z.boolean(),
  /**
   * 省略表示没有 DEFAULT 子句，缺省值就是 NULL；显式 { type: "null" } 表示
   * 写了 DEFAULT NULL。两者语义不同，必须分开，不能都压成 null。
   */
  defaultValue: SqliteValueSchema.optional(),
  /** 主键中的位置，从 1 开始；0 表示不是主键列，复合主键据此排序。 */
  primaryKeyPosition: z.number().int().min(0).max(16),
  generated: z.boolean(),
  hidden: z.boolean(),
  write: DatabaseColumnWriteSchema,
})

export const DatabaseUniqueConstraintSchema = z.object({
  /** 约束或索引名；SQLite 对匿名约束会给自动名。 */
  name: z.string().min(1).max(DATABASE_IDENTIFIER_MAX_LENGTH),
  columns: z.array(DatabaseIdentifierSchema).min(1).max(16),
})

export const DatabaseForeignKeySchema = z.object({
  id: z.number().int().min(0),
  columns: z.array(DatabaseIdentifierSchema).min(1).max(16),
  referencedTable: DatabaseIdentifierSchema,
  referencedColumns: z.array(DatabaseIdentifierSchema).min(1).max(16),
  /** ON DELETE / ON UPDATE 动作原文，如 NO ACTION / CASCADE / SET NULL。 */
  onDelete: z.string().min(1).max(32),
  onUpdate: z.string().min(1).max(32),
})

/**
 * 反向引用：别的表用外键指向本表。删除或改主键会连带影响它们，
 * 写确认必须能据此提示额外业务影响。
 */
export const DatabaseIncomingForeignKeySchema = z.object({
  table: DatabaseIdentifierSchema,
  /** 引用方的列。 */
  columns: z.array(DatabaseIdentifierSchema).min(1).max(16),
  /** 本表被引用的列。 */
  referencedColumns: z.array(DatabaseIdentifierSchema).min(1).max(16),
  onDelete: z.string().min(1).max(32),
  onUpdate: z.string().min(1).max(32),
})

export const DatabaseConstraintsSchema = z.object({
  /** 主键列名，按位置排序；空数组表示没有主键。 */
  primaryKey: z.array(DatabaseIdentifierSchema).max(16),
  unique: z.array(DatabaseUniqueConstraintSchema).max(32),
  foreignKeys: z.array(DatabaseForeignKeySchema).max(32),
  /** CHECK 表达式原文；本期不解析 DDL，因此恒为空数组（DDL 变化已计入结构签名）。 */
  checks: z.array(z.string().min(1).max(512)).max(32),
})

/** 结构签名：随表结构变化，客户端据此判断结构元信息是否过期。 */
export const DatabaseSchemaSignatureSchema = z.string().min(1).max(128)

/** 记录签名：由主键与当前值算出，用于乐观并发，防止覆盖他人刚做的修改。 */
export const DatabaseRecordSignatureSchema = z.string().min(1).max(128)

export const DATABASE_TABLE_KINDS = ["table", "view"] as const
export const DatabaseTableKindSchema = z.enum(DATABASE_TABLE_KINDS)

export const DatabaseTableSummarySchema = z.object({
  name: DatabaseIdentifierSchema,
  kind: DatabaseTableKindSchema,
  /** 行数；视图或统计失败时为 null，不能假装是 0。 */
  rowCount: z.number().int().min(0).nullable(),
  /** 四种操作都必须报一次能力，页面不用猜哪些按钮该出现。 */
  capabilities: z
    .array(DatabaseCapabilitySchema)
    .length(DATABASE_OPERATIONS.length),
})

export const DatabaseTableSchema = DatabaseTableSummarySchema.extend({
  columns: z.array(DatabaseColumnSchema).min(1).max(DATABASE_COLUMN_MAX),
  constraints: DatabaseConstraintsSchema,
  signature: DatabaseSchemaSignatureSchema,
  /** WITHOUT ROWID 表只能靠主键定位。 */
  withoutRowId: z.boolean(),
  /** 触发器名称：有触发器的表写入会产生额外副作用，页面需要据此提示。 */
  triggers: z.array(DatabaseIdentifierSchema).max(64),
  /** 指向本表的外键：删除或改主键会连带影响这些表。 */
  referencedBy: z.array(DatabaseIncomingForeignKeySchema).max(64),
})

export const DatabaseTablesResponseSchema = z.object({
  tables: z.array(DatabaseTableSummarySchema),
})

/** 主键的一个组成部分：列名加值。 */
export const DatabaseRecordKeyPartSchema = z.object({
  column: DatabaseIdentifierSchema,
  value: SqliteValueSchema,
})

/** 读取结果里的主键：没有可靠主键的表为空数组，此时记录只能读、不能定位。 */
export const DatabaseRecordKeySchema = z
  .array(DatabaseRecordKeyPartSchema)
  .max(16)

/** 定位一条记录用的主键：必须完整非空，写操作与单条读取都用它。 */
export const DatabaseRecordLocatorKeySchema = z
  .array(DatabaseRecordKeyPartSchema)
  .min(1)
  .max(16)

export const DatabaseRecordSchema = z.object({
  key: DatabaseRecordKeySchema,
  /** 列名到值的映射；BLOB 按 base64 编码。 */
  values: z.record(DatabaseIdentifierSchema, SqliteValueSchema),
  signature: DatabaseRecordSignatureSchema,
})

export const DatabaseRecordResponseSchema = z.object({
  table: DatabaseIdentifierSchema,
  record: DatabaseRecordSchema,
})

export const DATABASE_FILTER_OPERATORS = [
  "eq",
  "ne",
  "contains",
  "startsWith",
  "gt",
  "gte",
  "lt",
  "lte",
  "isNull",
  "isNotNull",
] as const
export const DatabaseFilterOperatorSchema = z.enum(DATABASE_FILTER_OPERATORS)

/** 这两类算子只看是否为空，不接受取值。 */
const FILTER_OPERATORS_WITHOUT_VALUE = new Set(["isNull", "isNotNull"])

export const DatabaseFilterSchema = z
  .object({
    column: DatabaseIdentifierSchema,
    operator: DatabaseFilterOperatorSchema,
    value: SqliteValueSchema.optional(),
  })
  .refine(
    (filter) =>
      FILTER_OPERATORS_WITHOUT_VALUE.has(filter.operator)
        ? filter.value === undefined
        : filter.value !== undefined,
    {
      message: "isNull/isNotNull 不得带取值，其余算子必须带取值",
      path: ["value"],
    }
  )

export const DATABASE_SORT_DIRECTIONS = ["asc", "desc"] as const
export const DatabaseSortDirectionSchema = z.enum(DATABASE_SORT_DIRECTIONS)

export const DatabaseSortSchema = z.object({
  column: DatabaseIdentifierSchema,
  direction: DatabaseSortDirectionSchema,
})

export const DatabaseRecordsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(DATABASE_PAGE_SIZE_MAX)
    .default(50),
  filters: z.array(DatabaseFilterSchema).max(DATABASE_FILTER_MAX).default([]),
  sorts: z.array(DatabaseSortSchema).max(DATABASE_SORT_MAX).default([]),
})

export const DatabaseRecordQuerySchema = z.object({
  key: DatabaseRecordLocatorKeySchema,
})

export const DatabaseRecordsResponseSchema = z.object({
  table: DatabaseIdentifierSchema,
  records: z.array(DatabaseRecordSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  /** 当前筛选条件下的总数；无法精确统计时为 null。 */
  total: z.number().int().min(0).nullable(),
  /** 表结构签名，页面据此发现结构已变化。 */
  signature: DatabaseSchemaSignatureSchema,
})

/**
 * 新增：values 里没有出现的列用默认值，出现的列按显式值写入；
 * 所以省略列与写 { type: "null" } 是两种不同语义。
 */
export const DatabaseInsertBodySchema = z
  .object({
    values: z.record(DatabaseIdentifierSchema, SqliteWritableValueSchema),
  })
  .refine((body) => Object.keys(body.values).length <= DATABASE_COLUMN_MAX, {
    message: `一次最多写 ${DATABASE_COLUMN_MAX} 列`,
    path: ["values"],
  })

/**
 * 修改：values 只含要改的列，定位与并发校验靠 key + expectedSignature，
 * 缺少任一都不能执行，避免误改整表或覆盖他人改动。
 */
export const DatabaseUpdateBodySchema = z
  .object({
    key: DatabaseRecordLocatorKeySchema,
    expectedSignature: DatabaseRecordSignatureSchema,
    values: z.record(DatabaseIdentifierSchema, SqliteWritableValueSchema),
  })
  .refine((body) => Object.keys(body.values).length >= 1, {
    message: "至少要修改一列",
    path: ["values"],
  })
  .refine((body) => Object.keys(body.values).length <= DATABASE_COLUMN_MAX, {
    message: `一次最多写 ${DATABASE_COLUMN_MAX} 列`,
    path: ["values"],
  })

export const DatabaseDeleteItemSchema = z.object({
  key: DatabaseRecordLocatorKeySchema,
  expectedSignature: DatabaseRecordSignatureSchema,
})

/** 批量删除：单条删除就是一个元素的批量，不另开一套结构。 */
export const DatabaseDeleteBodySchema = z.object({
  items: z.array(DatabaseDeleteItemSchema).min(1).max(DATABASE_DELETE_MAX),
})

export const DatabaseDeleteFailureSchema = z.object({
  key: DatabaseRecordLocatorKeySchema,
  message: z.string().min(1),
})

/**
 * 删除结果逐项可核实：deleted 是真的删掉的，conflicts 是被他人改动拦下的，
 * failed 是其他错误；不能只回一个总数冒充全部成功。
 */
export const DatabaseDeleteResultSchema = z.object({
  deleted: z.array(DatabaseRecordLocatorKeySchema),
  conflicts: z.array(DatabaseRecordLocatorKeySchema),
  failed: z.array(DatabaseDeleteFailureSchema),
})

export const DatabaseTablePathParamsSchema = z.object({
  table: DatabaseIdentifierSchema,
})
