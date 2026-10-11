import { z } from "zod"

/** 规则的两类匹配方式；页面筛选与写入表单共用这份清单。 */
export const CADDY_MATCH_KINDS = ["host", "path"] as const
export const CaddyMatchKindSchema = z.enum(CADDY_MATCH_KINDS)

/** 数据库里的受管规则；名称与备注只存这里，不写进配置文件。 */
export const CaddyRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  note: z.string().max(200),
  matchKind: CaddyMatchKindSchema,
  host: z.string().nullable(),
  pathPrefix: z.string().nullable(),
  stripPrefix: z.boolean(),
  upstream: z.string().min(1),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0),
  createdAt: z.number(),
  updatedAt: z.number(),
})

/** 配置文件里识别到、但尚未纳入管理的规则；只读展示，不可编辑。 */
export const CaddyExternalRuleSchema = z.object({
  id: z.string().min(1),
  matchKind: CaddyMatchKindSchema,
  host: z.string().nullable(),
  pathPrefix: z.string().nullable(),
  stripPrefix: z.boolean(),
  upstream: z.string().min(1),
  line: z.number().int().min(1),
})

/** 新增与修改的入参；跨字段一致性在服务端校验。 */
export const CaddyRuleInputSchema = z.object({
  name: z.string().min(1).max(60),
  note: z.string().max(200).default(""),
  matchKind: CaddyMatchKindSchema,
  host: z.string().max(253).nullable(),
  pathPrefix: z.string().max(512).nullable(),
  stripPrefix: z.boolean(),
  upstream: z.string().min(1).max(253),
  enabled: z.boolean(),
})

/** 相对上次成功应用的变化；从未应用时所有规则都算 added。 */
export const CaddyRuleChangesSchema = z.object({
  added: z.array(CaddyRuleSchema),
  updated: z.array(
    z.object({ before: CaddyRuleSchema, after: CaddyRuleSchema })
  ),
  removed: z.array(CaddyRuleSchema),
  enabled: z.array(CaddyRuleSchema),
  disabled: z.array(CaddyRuleSchema),
})

/** 进程、管理接口与配置文件的真实状态；每项独立，不合并成一个「正常」。 */
export const CaddyStatusSchema = z.object({
  processRunning: z.boolean(),
  version: z.string().nullable(),
  configFile: z.string(),
  binaryPath: z.string(),
  launchdLabel: z.string(),
  adminUrl: z.string(),
  adminReachable: z.boolean(),
  managedRegionPresent: z.boolean(),
  /** 本次读取时间（秒），页面据此标明数据新鲜度。 */
  readAt: z.number(),
})

export const CaddyRulesResponseSchema = z.object({
  status: CaddyStatusSchema,
  /** 数据库里的受管规则。 */
  rules: z.array(CaddyRuleSchema),
  /** 文件里尚未接管的规则。 */
  externalRules: z.array(CaddyExternalRuleSchema),
  unsupportedLines: z.number().int().min(0),
  /** 无法识别行的原文样本，最多 20 条，用于页面提示；不返回整份配置。 */
  unsupportedSamples: z.array(z.string()).max(20),
  /** 上次成功应用的规则指纹与时间；null 表示从未应用。 */
  appliedSignature: z.string().nullable(),
  appliedAt: z.number().nullable(),
  currentSignature: z.string(),
  hasUnappliedChanges: z.boolean(),
  /** 受管区域内容与数据库规则不一致（文件被手工改过）。 */
  managedRegionDrifted: z.boolean(),
  changes: CaddyRuleChangesSchema,
  /** 将要写入受管区域的正文（不含标记行），供应用前透明展示。 */
  previewText: z.string(),
  /** 是否允许应用；false 时 blockedReason 说明原因。 */
  writable: z.boolean(),
  blockedReason: z.string().nullable(),
})

export const CaddyRuleIdPathParamsSchema = z.object({ id: z.string().min(1) })

export const CaddyRuleImportResultSchema = z.object({
  imported: z.number().int().min(0),
  skipped: z.number().int().min(0),
})

/** 一次应用在数据库里的终态；unknown 表示无法核实，不得当成成功也不能重做。 */
export const CADDY_APPLY_STATUSES = ["success", "failed", "unknown"] as const
export const CaddyApplyStatusSchema = z.enum(CADDY_APPLY_STATUSES)

/** 一次应用的结果；verified 表示运行配置里已核实到本次规则。 */
export const CaddyApplyResultSchema = z.object({
  message: z.string(),
  versionId: z.string().min(1),
  appliedAt: z.number(),
  ruleCount: z.number().int().min(0),
  verified: z.boolean(),
  backupFile: z.string().nullable(),
})

/** 历史版本摘要，供页面选择恢复目标。 */
export const CaddyVersionSummarySchema = z.object({
  id: z.string().min(1),
  appliedAt: z.number(),
  status: CaddyApplyStatusSchema,
  message: z.string(),
  ruleCount: z.number().int().min(0),
})

export const CaddyVersionListSchema = z.object({
  versions: z.array(CaddyVersionSummarySchema),
})

/** 应用请求带客户端读到的规则指纹，服务端据此做乐观并发检查。 */
export const CaddyApplyInputSchema = z.object({
  expectedSignature: z.string().min(1),
})

export const CaddyVersionIdPathParamsSchema = z.object({
  id: z.string().min(1),
})
