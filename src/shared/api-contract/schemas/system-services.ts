import { z } from "zod"

export const ServiceDomainSchema = z.enum(["user", "global", "system"])

export const ServiceStateSchema = z.enum([
  "running",
  "stopped",
  "failed",
  "disabled",
])

/** 一条 launchd 服务：plist 元数据 + 运行时状态。 */
export const SystemServiceSchema = z.object({
  label: z.string(),
  domain: ServiceDomainSchema,
  filePath: z.string(),
  /** plist 文件是否还在原处（卸载后为 false） */
  exists: z.boolean(),
  loaded: z.boolean(),
  disabled: z.boolean(),
  state: ServiceStateSchema,
  pid: z.number().nullable(),
  lastExitCode: z.number().nullable(),
  startedAt: z.number().nullable(),
  program: z.string(),
  args: z.array(z.string()),
  runAtLoad: z.boolean(),
  keepAlive: z.boolean(),
  startInterval: z.number().nullable(),
  workingDirectory: z.string().nullable(),
  stdoutPath: z.string().nullable(),
  stderrPath: z.string().nullable(),
  environment: z.record(z.string()),
  processType: z.string().nullable(),
  throttleInterval: z.number().nullable(),
  /** 位于系统目录、需要 root 才能改动的服务 */
  requiresRoot: z.boolean(),
  /** plist 原文 */
  plist: z.string(),
})

export const ServicesResponseSchema = z.object({
  services: z.array(SystemServiceSchema),
  /** 读取过程中跳过的 plist 及原因 */
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
})

export const ServiceTargetQuerySchema = z.object({
  label: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._-]+$/, "服务标识包含非法字符"),
  domain: ServiceDomainSchema,
})

export const ServiceTargetBodySchema = z.object({
  label: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._-]+$/, "服务标识包含非法字符"),
  domain: ServiceDomainSchema,
})

export const ServiceEnabledBodySchema = ServiceTargetBodySchema.extend({
  disabled: z.boolean(),
})
