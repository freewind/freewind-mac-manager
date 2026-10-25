import {
  DEFAULT_HEALTH_CHECK,
  DEFAULT_MERGE_TEMPLATE,
} from "@shared/clash-merge-defaults"
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
 * 订阅里的代理组：成员只保留真实节点名（嵌套的组名不算），
 * 用于在节点列表里展示层级。
 */
export const ClashVergeProfileGroupSchema = z.object({
  name: z.string(),
  members: z.array(z.string()).max(1000),
})

/**
 * 订阅清单条目：Clash Verge 的 profiles.yaml 里 type 为 remote 的记录。
 * 只读回显，不含编辑与切换能力；url 原样返回，由调用方决定展示方式。
 */
export const ClashVergeProfileSchema = z.object({
  uid: z.string(),
  name: z.string(),
  /** 订阅链接；本地生成的配置（如合并结果）没有链接。 */
  url: z.string().nullable(),
  /** 是否 Clash Verge 当前正在使用的订阅（profiles.yaml 顶层的 current）。 */
  current: z.boolean(),
  nodes: z.array(ClashVergeProfileNodeSchema).max(300),
  /** 节点数超过上限时只回前 300 条，这里标出是否被截断。 */
  nodesTruncated: z.boolean(),
  /** 订阅自带的代理组；没有组时前端直接平铺节点。 */
  groups: z.array(ClashVergeProfileGroupSchema).max(100),
})

export const ClashVergeProfilesResponseSchema = z.object({
  /** 服务端固定路径（Clash Verge profiles.yaml），只回显、不接受客户端传入。 */
  path: z.string(),
  /** 读取时间，秒级时间戳。 */
  sampledAt: z.number().int(),
  profiles: z.array(ClashVergeProfileSchema).max(200),
})

/**
 * 订阅配置文件内容（只读）：用于在页面里核对订阅文件原文。
 * 超过字符上限时截断，truncated 标出，不拒绝整份读取。
 */
export const ClashVergeProfileFileSchema = z.object({
  /** 服务端解析出的路径，不接受客户端传入。 */
  path: z.string(),
  /** 订阅名，与清单里显示的一致。 */
  name: z.string(),
  size: z.number().int().nonnegative(),
  truncated: z.boolean(),
  content: z.string(),
})

/** 读哪个订阅的配置文件：uid 必须是清单里已有的条目，服务端自己查证。 */
export const ClashVergeProfileFileQuerySchema = z.object({
  uid: z.string().min(1).max(64),
})

/**
 * 切换当前订阅：只接受清单里已存在的订阅 uid，服务端自己查证，
 * 不信任客户端传来的名称与其他字段。
 */
export const SetClashVergeCurrentProfileBodySchema = z.object({
  uid: z.string().min(1).max(64),
})

/** 合并后可选的组类型：默认手动选择，另两种交给内核自动决定。 */
export const ClashMergeGroupTypeSchema = z.enum([
  "select",
  "url-test",
  "fallback",
])

/** 一条分组规则：正则匹配节点名，目标组名直接填写。 */
export const ClashMergeRuleSchema = z.object({
  pattern: z.string().max(500),
  target: z.string().max(60),
  /** 生成的组类型：早期版本没有这个字段，读旧记录时是手动选择。 */
  type: ClashMergeGroupTypeSchema.default("select"),
})

/** GEO 分类分流的出口：只有三个固定选项，对应合并后的三个组。 */
export const GeositeTargetSchema = z.enum(["proxy", "direct", "reject"])

/** 一条 GEO 分类分流：分类名 + 出口，不写具体域名。 */
export const GeositeRuleSchema = z.object({
  code: z.string().min(1).max(64),
  target: GeositeTargetSchema,
})

/** 自定义域名规则的匹配类型：只开常用的三种，不够用再加。 */
export const CustomRuleTypeSchema = z.enum([
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
])

/** 一条自定义规则：类型 + 值 + 出口，出口与 GEO 分类共用三个选项。 */
export const CustomRuleSchema = z.object({
  type: CustomRuleTypeSchema,
  value: z.string().min(1).max(200),
  target: GeositeTargetSchema,
})

/**
 * 测速地址与间隔：url-test 与 fallback 组共用。
 * 只接受 http/https，其余 scheme 内核不认，合并前就拦下。
 */
export const ClashHealthCheckSchema = z.object({
  url: z
    .string()
    .trim()
    .max(300)
    .refine((value) => /^https?:\/\/\S+$/i.test(value), {
      message: "测速地址必须以 http:// 或 https:// 开头",
    }),
  interval: z.number().int().min(10).max(86400),
})

/**
 * 合并订阅的分组规则：只存用户手输的正则与目标组名，
 * 选中哪些订阅、命中哪些节点都是实时算出来的，不落库。
 */
export const ClashMergeConfigSchema = z.object({
  rules: z.array(ClashMergeRuleSchema).max(200),
  /** GEO 分类分流：早期版本没有这个字段，读旧记录时默认为空。 */
  geositeRules: z.array(GeositeRuleSchema).max(200).default([]),
  /** 自定义域名规则：优先级最高，排在 GEO 规则之前。 */
  customRules: z.array(CustomRuleSchema).max(200).default([]),
  /** 基座模板：合并产物里所有手写配置都来自它。 */
  template: z.string().max(20000).default(DEFAULT_MERGE_TEMPLATE),
  /** 测速参数：早期版本没有这个字段，读旧记录时用默认值。 */
  healthCheck: ClashHealthCheckSchema.default(DEFAULT_HEALTH_CHECK),
  /** 上次保存时间，秒级；null 表示从未保存过。 */
  updatedAt: z.number().int().nullable(),
})

/** 保存时只接受规则，保存时间由服务端写。 */
export const SaveClashMergeConfigBodySchema = z.object({
  rules: z.array(ClashMergeRuleSchema).max(200),
  geositeRules: z.array(GeositeRuleSchema).max(200).default([]),
  customRules: z.array(CustomRuleSchema).max(200).default([]),
  template: z.string().max(20000).default(DEFAULT_MERGE_TEMPLATE),
  healthCheck: ClashHealthCheckSchema.default(DEFAULT_HEALTH_CHECK),
})

/** geosite 里的单个域名：类型、值与属性标记（如 ads、cn）。 */
export const ClashVergeGeositeDomainSchema = z.object({
  type: z.enum(["plain", "rootdomain", "full", "regex"]),
  value: z.string(),
  /** v2fly 的 attribute 标注，没有时为空数组。 */
  attributes: z.array(z.string()).max(10),
})

/** geosite 数据库里的单个分类：名字、条目数与前面一段域名（带类型）。 */
export const ClashVergeGeositeCategorySchema = z.object({
  code: z.string(),
  count: z.number().int().nonnegative(),
  /** 该分类的前若干条域名，数量受上限控制，不足的部分由 count 体现。 */
  preview: z.array(ClashVergeGeositeDomainSchema).max(100),
})

/** geosite 数据库概览：文件信息 + 全部分类名、条目数与域名预览。 */
export const ClashVergeGeositeSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  /** 文件修改时间，秒级时间戳。 */
  modified: z.number().int().nonnegative(),
  totalCategories: z.number().int().nonnegative(),
  totalDomains: z.number().int().nonnegative(),
  categories: z.array(ClashVergeGeositeCategorySchema).max(4000),
})

/** 合并订阅：选中的订阅 uid 与已勾选的分组规则（按顺序生效）。 */
export const MergeClashProfilesBodySchema = z.object({
  selected: z.array(z.string().max(64)).min(1).max(200),
  rules: z.array(ClashMergeRuleSchema).max(200),
  /** 是否生成兜底的「其他」组：不勾选时未匹配的节点不进任何组。 */
  includeFallback: z.boolean().default(true),
  geositeRules: z.array(GeositeRuleSchema).max(200).default([]),
  customRules: z.array(CustomRuleSchema).max(200).default([]),
  template: z.string().max(20000).default(DEFAULT_MERGE_TEMPLATE),
  healthCheck: ClashHealthCheckSchema.default(DEFAULT_HEALTH_CHECK),
})
