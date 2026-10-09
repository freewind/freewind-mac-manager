import { z } from "zod"

/** frpc 支持的隧道类型；页面筛选与表单共用这份清单。 */
export const FrpProxyTypeSchema = z.enum(["tcp", "udp", "http", "https"])

export const FRP_PROXY_TYPES = FrpProxyTypeSchema.options

/** 一条隧道，即 frpc 配置里的一段 [[proxies]]。 */
export const FrpProxySchema = z.object({
  name: z.string(),
  type: FrpProxyTypeSchema,
  localIP: z.string(),
  localPort: z.number().int(),
  remotePort: z.number().int(),
})

/** frpc 服务端连接信息与运行环境；路径与运行态由服务端读取真实来源后填入。 */
export const FrpServerSchema = z.object({
  serverAddr: z.string(),
  serverPort: z.number().int(),
  authMethod: z.string(),
  authToken: z.string(),
  configPath: z.string(),
  binaryPath: z.string(),
  launchdLabel: z.string(),
  state: z.enum(["running", "stopped"]),
  pid: z.number().nullable(),
  startedAt: z.number().nullable(),
})

/** 页面持有的完整配置；savedSignature 是磁盘上已保存内容的指纹。 */
export const FrpConfigSchema = z.object({
  server: FrpServerSchema,
  proxies: z.array(FrpProxySchema),
  savedSignature: z.string(),
})

/**
 * 保存时只接受会写进配置文件的字段：
 * 路径与运行态由服务端自己解析，不接受前端传入，避免写到别处。
 */
export const FrpServerInputSchema = FrpServerSchema.pick({
  serverAddr: true,
  serverPort: true,
  authMethod: true,
  authToken: true,
})

export const FrpConfigInputSchema = z.object({
  server: FrpServerInputSchema,
  proxies: z.array(FrpProxySchema),
})

/** 探测入参：当前配置的服务端地址 + 某条隧道的远程端口。 */
export const FrpProbeBodySchema = z.object({
  serverAddr: z.string().min(1),
  remotePort: z.number().int().min(1).max(65535),
})

/** 一次连通性探测的结果。 */
export const FrpProbeSchema = z.object({
  reachable: z.boolean(),
  latencyMs: z.number(),
  message: z.string(),
  checkedAt: z.number(),
})
