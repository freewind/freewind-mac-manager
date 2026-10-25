import { z } from "zod"

export const ClashVergeAvailabilitySchema = z.object({
  state: z.enum(["available", "unavailable", "unauthorized", "not_configured"]),
  message: z.string().nullable(),
})

export const ClashVergeStatusSchema = z.object({
  sampledAt: z.number().int(),
  availability: ClashVergeAvailabilitySchema,
  core: z.object({
    version: z.string().nullable(),
    meta: z.boolean().nullable(),
  }),
  config: z.object({
    mode: z.string().nullable(),
    tunEnabled: z.boolean().nullable(),
  }),
  traffic: z.object({
    uploadRate: z.number().nonnegative().nullable(),
    downloadRate: z.number().nonnegative().nullable(),
    uploadTotal: z.number().nonnegative().nullable(),
    downloadTotal: z.number().nonnegative().nullable(),
  }),
  sections: z.object({
    core: ClashVergeAvailabilitySchema,
    config: ClashVergeAvailabilitySchema,
    traffic: ClashVergeAvailabilitySchema,
  }),
})

export const ClashVergeProxySchema = z.object({
  name: z.string(),
  type: z.string(),
  alive: z.boolean().nullable(),
  selected: z.string().nullable(),
  members: z.array(z.string()).max(1000),
  delays: z
    .array(
      z.object({
        time: z.string(),
        delay: z.number().nonnegative(),
      })
    )
    .max(32),
})

export const ClashVergeProxiesResponseSchema = z.object({
  sampledAt: z.number().int(),
  availability: ClashVergeAvailabilitySchema,
  proxies: z.array(ClashVergeProxySchema).max(2000),
})

export const ClashVergeConnectionSchema = z.object({
  id: z.string(),
  source: z.string().nullable(),
  destination: z.string().nullable(),
  network: z.string().nullable(),
  process: z.string().nullable(),
  upload: z.number().nonnegative(),
  download: z.number().nonnegative(),
  startedAt: z.string(),
  chains: z.array(z.string()).max(32),
  rule: z.string().nullable(),
  rulePayload: z.string().nullable(),
})

export const ClashVergeConnectionsResponseSchema = z.object({
  sampledAt: z.number().int(),
  availability: ClashVergeAvailabilitySchema,
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  /** 本次响应的条数上限：前后端文案的单一来源，旧后端可能不带，前端回退默认值。 */
  limit: z.number().int().positive().optional(),
  connections: z.array(ClashVergeConnectionSchema).max(200),
})

/**
 * 全局 Merge 是手写规则文本，正常几 KB；上限防误把整份订阅贴进来，
 * 也是保存 body 的契约边界（zod 按字符数计，服务层读取时再按字节复核）。
 */
export const CLASH_VERGE_MERGE_MAX_CHARS = 256 * 1024

export const ClashVergeMergeFileSchema = z.object({
  /** 服务端固定路径（Clash Verge profiles/Merge.yaml），只回显、不接受客户端传入。 */
  path: z.string(),
  content: z.string(),
  size: z.number().int().nonnegative(),
  /** 修改时间，秒级时间戳。 */
  modified: z.number().int().nonnegative(),
})

export const SaveClashVergeMergeBodySchema = z.object({
  content: z.string().max(CLASH_VERGE_MERGE_MAX_CHARS),
})

/**
 * 订阅里的单个节点：只取排障需要的字段，不含密码、uuid 等凭据。
 * server 是本机订阅里的服务器地址，页面已有访问密码，原样展示便于核对。
 */
export const ClashVergeProfileNodeSchema = z.object({
  name: z.string(),
  type: z.string(),
  server: z.string(),
  port: z.number().int().nullable(),
  /**
   * 同一订阅内除名字外配置完全相同的条目：指向前面首次出现的序号（1 起）。
   * null 表示它是这条配置的首次出现（或唯一一条）。
   */
  duplicateOf: z.number().int().positive().nullable(),
})

/**
 * 订阅清单条目：Clash Verge 的 profiles.yaml 里 type 为 remote 的记录。
 * 只读回显，不含编辑与切换能力；url 原样返回，由调用方决定展示方式。
 */
export const ClashVergeProfileSchema = z.object({
  uid: z.string(),
  name: z.string(),
  url: z.string(),
  /** 是否 Clash Verge 当前正在使用的订阅（profiles.yaml 顶层的 current）。 */
  current: z.boolean(),
  nodes: z.array(ClashVergeProfileNodeSchema).max(300),
  /** 节点数超过上限时只回前 300 条，这里标出是否被截断。 */
  nodesTruncated: z.boolean(),
})

export const ClashVergeProfilesResponseSchema = z.object({
  /** 服务端固定路径（Clash Verge profiles.yaml），只回显、不接受客户端传入。 */
  path: z.string(),
  /** 读取时间，秒级时间戳。 */
  sampledAt: z.number().int(),
  profiles: z.array(ClashVergeProfileSchema).max(200),
})
