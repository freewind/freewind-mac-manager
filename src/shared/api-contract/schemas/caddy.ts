import { z } from "zod"

/** 规则的两类匹配方式；页面筛选与后续写入表单共用这份清单。 */
export const CADDY_MATCH_KINDS = ["host", "path"] as const
export const CaddyMatchKindSchema = z.enum(CADDY_MATCH_KINDS)
export const CaddyRuleOriginSchema = z.enum(["managed", "external"])

/** 文件里识别到的一条转发规则。本任务只从配置文件读取，id 由匹配条件派生。 */
export const CaddyRuleSchema = z.object({
  id: z.string().min(1),
  matchKind: CaddyMatchKindSchema,
  host: z.string().nullable(),
  pathPrefix: z.string().nullable(),
  stripPrefix: z.boolean(),
  upstream: z.string().min(1),
  origin: CaddyRuleOriginSchema,
  line: z.number().int().min(1),
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
  rules: z.array(CaddyRuleSchema),
  unsupportedLines: z.number().int().min(0),
  /** 无法识别行的原文样本，最多 20 条，用于页面提示；不返回整份配置。 */
  unsupportedSamples: z.array(z.string()).max(20),
})
