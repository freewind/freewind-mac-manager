import { randomUUID } from "node:crypto"
import type { Stats } from "node:fs"
import { chmod, lstat, open, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"
import { runCommand } from "@server/common/collect"
import { PublicOperationError } from "@server/common/public-error"
import { CLASH_VERGE_PROFILE_DIR, CLASH_VERGE_PROFILES_FILE } from "@server/env"
import type {
  ClashMergeConfig,
  ClashVergeConnection,
  ClashVergeConnectionsResponse,
  ClashVergeGeoip,
  ClashVergeGeosite,
  ClashVergeMmdb,
  ClashVergeProfileFile,
  ClashVergeProfileNode,
  ClashVergeProfilesResponse,
  ClashVergeProxiesResponse,
  ClashVergeProxy,
  ClashVergeStatus,
  MergeClashProfilesBody,
  SaveClashMergeConfigBody,
} from "@shared/api-contract"
import {
  ClashVergeConnectionsResponseSchema,
  ClashVergeProxiesResponseSchema,
  ClashVergeStatusSchema,
} from "@shared/api-contract/schemas/clash-verge"
import {
  type ClashMergeGroupType,
  DEFAULT_GEOSITE_RULES,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_MERGE_RULES,
  DEFAULT_MERGE_TEMPLATE,
  MERGED_URL_TEST_TOLERANCE,
} from "@shared/clash-merge-defaults"
import { parse as parseYaml, stringify as toYaml } from "yaml"
import {
  ControllerError,
  connectionLimit,
  requestControllerJson,
} from "./controller"
import { parseYamlRecord } from "./discovery"
import { parseGeoipDat } from "./geo-dat"
import { pickNumber, pickString, readMmdbMeta, walkMmdb } from "./mmdb"
import { readVarint } from "./protobuf"
import { getClashMergeStore } from "./store"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const availability = (
  state: "available" | "unavailable" | "unauthorized" | "not_configured",
  message: string | null = null
) => ({ state, message })

const unavailableResult = (error: unknown) => {
  if (error instanceof ControllerError) {
    return availability(
      error.kind === "not_configured"
        ? "not_configured"
        : error.kind === "unauthorized"
          ? "unauthorized"
          : "unavailable",
      error.message
    )
  }
  return availability("unavailable", "无法读取 Clash Verge 状态")
}

const readSection = async (
  endpoint: Parameters<typeof requestControllerJson>[0]
) => {
  try {
    return {
      value: await requestControllerJson(endpoint),
      status: availability("available"),
    }
  } catch (error) {
    return { value: null, status: unavailableResult(error) }
  }
}

const nullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null

export const getClashVergeStatus = async (): Promise<ClashVergeStatus> => {
  const [versionResult, configResult, trafficResult] = await Promise.all([
    readSection("version"),
    readSection("configs"),
    readSection("traffic"),
  ])
  const version = isRecord(versionResult.value) ? versionResult.value : {}
  const config = isRecord(configResult.value) ? configResult.value : {}
  const traffic = isRecord(trafficResult.value) ? trafficResult.value : {}
  const coreAvailable = versionResult.status.state === "available"
  const configAvailable = configResult.status.state === "available"
  const trafficAvailable = trafficResult.status.state === "available"
  const failures = [versionResult, configResult, trafficResult].filter(
    (result) => result.status.state !== "available"
  )
  const state = failures.some((result) => result.status.state === "unavailable")
    ? "unavailable"
    : failures.some((result) => result.status.state === "unauthorized")
      ? "unauthorized"
      : failures.some((result) => result.status.state === "not_configured")
        ? "not_configured"
        : "available"
  const sampledAt = Date.now()

  return ClashVergeStatusSchema.parse({
    sampledAt,
    availability: availability(
      state,
      state === "available" ? null : (failures[0]?.status.message ?? null)
    ),
    core: {
      version:
        coreAvailable && typeof version.version === "string"
          ? version.version
          : null,
      meta:
        coreAvailable && typeof version.meta === "boolean"
          ? version.meta
          : null,
    },
    config: {
      mode:
        configAvailable && typeof config.mode === "string" ? config.mode : null,
      tunEnabled:
        configAvailable && isRecord(config.tun) && config.tun.enable === true
          ? true
          : configAvailable &&
              isRecord(config.tun) &&
              config.tun.enable === false
            ? false
            : null,
    },
    traffic: {
      uploadRate: trafficAvailable ? nullableNumber(traffic.up) : null,
      downloadRate: trafficAvailable ? nullableNumber(traffic.down) : null,
      uploadTotal: trafficAvailable ? nullableNumber(traffic.upTotal) : null,
      downloadTotal: trafficAvailable
        ? nullableNumber(traffic.downTotal)
        : null,
    },
    sections: {
      core: versionResult.status,
      config: configResult.status,
      traffic: trafficResult.status,
    },
  })
}

const mapProxy = (name: string, value: unknown): ClashVergeProxy | null => {
  if (!isRecord(value) || typeof value.type !== "string") return null
  const history = Array.isArray(value.history) ? value.history : []
  const delays = history
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter(
      (entry) =>
        typeof entry.time === "string" && nullableNumber(entry.delay) !== null
    )
    .slice(-32)
    .map((entry) => ({
      time: entry.time as string,
      delay: entry.delay as number,
    }))
  return {
    name,
    type: value.type,
    alive: typeof value.alive === "boolean" ? value.alive : null,
    selected: typeof value.now === "string" ? value.now : null,
    members: Array.isArray(value.all)
      ? value.all
          .filter((member): member is string => typeof member === "string")
          .slice(0, 1000)
      : [],
    delays,
  }
}

export const getClashVergeProxies =
  async (): Promise<ClashVergeProxiesResponse> => {
    try {
      const result = await requestControllerJson("proxies")
      if (!isRecord(result) || !isRecord(result.proxies)) {
        throw new ControllerError(
          "Clash Verge 代理组数据格式无效",
          "invalid_response"
        )
      }
      const proxies = Object.entries(result.proxies)
        .slice(0, 2000)
        .map(([name, value]) => mapProxy(name, value))
        .filter((proxy) => proxy !== null)
      return ClashVergeProxiesResponseSchema.parse({
        sampledAt: Date.now(),
        availability: availability("available"),
        proxies,
      })
    } catch (error) {
      return ClashVergeProxiesResponseSchema.parse({
        sampledAt: Date.now(),
        availability: unavailableResult(error),
        proxies: [],
      })
    }
  }

const nullableString = (value: unknown): string | null =>
  typeof value === "string" ? value.slice(0, 2048) : null

const mapConnection = (value: unknown): ClashVergeConnection | null => {
  if (!isRecord(value) || !isRecord(value.metadata)) return null
  const metadata = value.metadata
  return {
    id: typeof value.id === "string" ? value.id.slice(0, 256) : "",
    source: nullableString(metadata.sourceIP),
    destination: nullableString(metadata.destinationIP ?? metadata.host),
    network: nullableString(metadata.network),
    process: nullableString(metadata.process),
    upload: nullableNumber(value.upload) ?? 0,
    download: nullableNumber(value.download) ?? 0,
    startedAt: typeof value.start === "string" ? value.start : "",
    chains: Array.isArray(value.chains)
      ? value.chains
          .filter((chain): chain is string => typeof chain === "string")
          .slice(0, 32)
      : [],
    rule: nullableString(value.rule),
    rulePayload: nullableString(value.rulePayload),
  }
}

export const getClashVergeConnections =
  async (): Promise<ClashVergeConnectionsResponse> => {
    try {
      const result = await requestControllerJson("connections")
      if (!isRecord(result) || !Array.isArray(result.connections)) {
        throw new ControllerError(
          "Clash Verge 连接数据格式无效",
          "invalid_response"
        )
      }
      const mapped = result.connections
        .slice(0, connectionLimit + 1)
        .map((value) => mapConnection(value))
        .filter((connection) => connection !== null)
      return ClashVergeConnectionsResponseSchema.parse({
        sampledAt: Date.now(),
        availability: availability("available"),
        total: result.connections.length,
        truncated: result.connections.length > connectionLimit,
        // 上限单一来源：前端文案直接读这里，不再写死第二处。
        limit: connectionLimit,
        connections: mapped.slice(0, connectionLimit),
      })
    } catch (error) {
      return ClashVergeConnectionsResponseSchema.parse({
        sampledAt: Date.now(),
        availability: unavailableResult(error),
        total: 0,
        truncated: false,
        connections: [],
      })
    }
  }

/* ---------- 订阅清单（只读） ---------- */

type ProfileEntry = {
  uid: string
  name: string
  /** 订阅链接；本地配置（如合并结果）没有链接。 */
  url: string | null
  /** 配置在 profiles 目录里的文件名（如 R9qx7MBAX2DY.yaml），用来读节点。 */
  file: string
}

/**
 * 从 profiles.yaml 的 items 里挑出订阅与本地配置（remote / local）。
 * 其余 merge / script / rules 等都是内部配置项，不是可选的配置。
 * 名称缺失时退回文件名，再退回固定文案，不让界面出现空标题。
 */
const profileEntries = (items: unknown): ProfileEntry[] => {
  const result: ProfileEntry[] = []
  for (const item of Array.isArray(items) ? items : []) {
    if (!isRecord(item)) continue
    if (item.type !== "remote" && item.type !== "local") continue
    const file = typeof item.file === "string" ? item.file : ""
    const trimmedName = typeof item.name === "string" ? item.name.trim() : ""
    result.push({
      uid: typeof item.uid === "string" ? item.uid : "",
      name: trimmedName || file || "未命名配置",
      url: typeof item.url === "string" ? item.url : null,
      file,
    })
  }
  return result
}

/** 单个订阅能回显的节点上限：订阅动辄上百节点，超过只回前面的。 */
const PROFILE_NODES_LIMIT = 300

/**
 * 键按名称排序后序列化：同一份配置换行或换键序也认作同一条，
 * 用于判断两个节点除名字外是否一模一样。
 */
const stableKey = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${key}:${stableKey(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/** 订阅自带的代理组：成员只保留真实节点名，嵌套的组名丢掉。 */
const profileGroups = (
  document: Record<string, unknown>,
  nodeNames: Set<string>
): { name: string; members: string[] }[] => {
  const raw = document["proxy-groups"]
  const groups: { name: string; members: string[] }[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item) || typeof item.name !== "string") continue
    const members = (Array.isArray(item.proxies) ? item.proxies : []).filter(
      (member): member is string =>
        typeof member === "string" && nodeNames.has(member)
    )
    if (members.length === 0) continue
    groups.push({ name: item.name, members })
  }
  return groups
}

/**
 * 读单个订阅的节点：节点就在 profiles/<file> 的 proxies 里。
 * 文件名来自 profiles.yaml 而非客户端，仍要求是单纯文件名（不含路径分隔符），
 * 避免异常数据把读取路径带出 profiles 目录；读不到按空列表返回，不报错。
 *
 * duplicateOf 指向同配置首次出现的序号（1 起）：机场常把同一条线路
 * 写成多个名字，只让后出现的那几条标注重复，第一条保持干净。
 */
const profileNodes = async (
  file: string
): Promise<{
  nodes: ClashVergeProfileNode[]
  nodesTruncated: boolean
  groups: { name: string; members: string[] }[]
}> => {
  if (file === "" || path.basename(file) !== file) {
    return { nodes: [], nodesTruncated: false, groups: [] }
  }
  let text: string
  try {
    text = await readFile(path.join(CLASH_VERGE_PROFILE_DIR, file), "utf8")
  } catch {
    return { nodes: [], nodesTruncated: false, groups: [] }
  }
  const proxies = parseYamlRecord(text).proxies
  const document = parseYamlRecord(text)
  const entries: { node: ClashVergeProfileNode; key: string }[] = []
  for (const item of Array.isArray(proxies) ? proxies : []) {
    if (!isRecord(item) || typeof item.name !== "string") continue
    const { name: _, ...rest } = item
    entries.push({
      node: {
        name: item.name,
        type: typeof item.type === "string" ? item.type : "未知",
        server: typeof item.server === "string" ? item.server : "",
        port: typeof item.port === "number" ? item.port : null,
        duplicateOf: null,
      },
      key: stableKey(rest),
    })
  }
  const firstSeen = new Map<string, number>()
  const nodes = entries.slice(0, PROFILE_NODES_LIMIT).map((entry, position) => {
    const first = firstSeen.get(entry.key)
    if (first === undefined) firstSeen.set(entry.key, position + 1)
    return { ...entry.node, duplicateOf: first ?? null }
  })
  return {
    nodes,
    nodesTruncated: entries.length > PROFILE_NODES_LIMIT,
    groups: profileGroups(document, new Set(nodes.map((node) => node.name))),
  }
}

const readClashVergeIndex = async (): Promise<{
  text: string
  document: Record<string, unknown>
}> => {
  let text: string
  try {
    text = await readFile(CLASH_VERGE_PROFILES_FILE, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PublicOperationError(
        404,
        `找不到 Clash Verge 订阅清单：${CLASH_VERGE_PROFILES_FILE}（请先在 Clash Verge 中添加订阅）`
      )
    }
    throw error
  }
  return { text, document: parseYamlRecord(text) }
}

/** 配置文件正文字符上限：超出就截断（本机最大约 900 KB，实际不会触发）。 */
const CLASH_VERGE_PROFILE_FILE_MAX_CHARS = 2_000_000

/**
 * 读单个订阅的配置文件原文（只读），用于在页面里核对订阅文件内容。
 * uid 由服务端在清单里查证，文件名仍要求是单纯文件名，
 * 防止异常数据把读取路径带出 profiles 目录。
 */
export const readClashVergeProfileFile = async (
  uid: string
): Promise<ClashVergeProfileFile> => {
  const { document } = await readClashVergeIndex()
  const entry = profileEntries(document.items).find((item) => item.uid === uid)
  if (entry === undefined) {
    throw new PublicOperationError(404, "订阅不存在：清单里没有这个 uid")
  }
  if (entry.file === "" || path.basename(entry.file) !== entry.file) {
    throw new PublicOperationError(400, "该订阅没有可读的配置文件")
  }
  const filePath = path.join(CLASH_VERGE_PROFILE_DIR, entry.file)
  let content: string
  try {
    content = await readFile(filePath, "utf8")
  } catch {
    throw new PublicOperationError(
      404,
      "订阅配置文件还没下载到本地，先在 Clash Verge 里更新该订阅"
    )
  }
  const truncated = content.length > CLASH_VERGE_PROFILE_FILE_MAX_CHARS
  return {
    path: filePath,
    name: entry.name,
    size: Buffer.byteLength(content, "utf8"),
    truncated,
    content: truncated
      ? content.slice(0, CLASH_VERGE_PROFILE_FILE_MAX_CHARS)
      : content,
  }
}
/** geosite 数据库：与 profiles.yaml 同目录，由 Clash Verge 下载维护。 */
const CLASH_VERGE_GEOSITE_FILE = path.join(
  path.dirname(CLASH_VERGE_PROFILES_FILE),
  "geosite.dat"
)

/** 每个分类预览多少条：够看清内容即可，不把几万条全塞给页面。 */
const GEOSITE_PREVIEW_LIMIT = 30

/** protobuf 里的类型枚举顺序：Plain / Regex / RootDomain / Full。 */
const GEOSITE_DOMAIN_TYPES = ["plain", "regex", "rootdomain", "full"] as const

type GeositeDomainType = (typeof GEOSITE_DOMAIN_TYPES)[number]

type GeositeCategory = {
  code: string
  domains: { type: GeositeDomainType; value: string; attributes: string[] }[]
}

/** 解析结果缓存：文件 mtime 变了才重解，否则每次请求都要重读 4 MB。 */
let geositeCache: { modified: number; categories: GeositeCategory[] } | null =
  null

/** 读一条 Domain 的 attribute key：Attribute 的 key 在字段 1，其余值跳过。 */
const readAttributeKey = (
  buffer: Buffer,
  start: number,
  end: number
): string | null => {
  let cursor = start
  let key: string | null = null
  while (cursor < end) {
    const tag = readVarint(buffer, cursor)
    cursor = tag.next
    const kind = tag.value >> 3
    const wire = tag.value & 7
    if (wire === 0) {
      cursor = readVarint(buffer, cursor).next
    } else if (wire === 2) {
      const len = readVarint(buffer, cursor)
      cursor = len.next
      const next = Math.min(cursor + len.value, end)
      if (kind === 1) key = buffer.toString("utf8", cursor, next)
      cursor = next
    } else {
      break
    }
  }
  return key
}

/**
 * 解析 geosite.dat（protobuf，无第三方库）：
 * 顶层 repeated GeoSite，其中 country_code = 1、repeated Domain = 2；
 * Domain 里 type = 1（varint）、value = 2（string），其余字段跳过。
 */
const parseGeosite = (buffer: Buffer): GeositeCategory[] => {
  const categories: GeositeCategory[] = []
  let offset = 0
  while (offset < buffer.length) {
    const outer = readVarint(buffer, offset)
    offset = outer.next
    const field = outer.value >> 3
    const wire = outer.value & 7
    if (wire !== 2) break
    const length = readVarint(buffer, offset)
    offset = length.next
    const end = Math.min(offset + length.value, buffer.length)
    if (field !== 1) {
      offset = end
      continue
    }
    let code = ""
    const domains: GeositeCategory["domains"] = []
    while (offset < end) {
      const inner = readVarint(buffer, offset)
      offset = inner.next
      const innerField = inner.value >> 3
      const innerWire = inner.value & 7
      if (innerWire !== 2) {
        if (innerWire === 0) offset = readVarint(buffer, offset).next
        continue
      }
      const innerLength = readVarint(buffer, offset)
      offset = innerLength.next
      const innerEnd = Math.min(offset + innerLength.value, end)
      if (innerField === 1) {
        code = buffer.toString("utf8", offset, innerEnd)
      } else if (innerField === 2) {
        let domainType: GeositeDomainType = "plain"
        let value = ""
        const attributes: string[] = []
        let cursor = offset
        while (cursor < innerEnd) {
          const fieldTag = readVarint(buffer, cursor)
          cursor = fieldTag.next
          const wireType = fieldTag.value & 7
          const kind = fieldTag.value >> 3
          if (wireType === 0) {
            const num = readVarint(buffer, cursor)
            cursor = num.next
            if (kind === 1)
              domainType = GEOSITE_DOMAIN_TYPES[num.value] ?? "plain"
          } else if (wireType === 2) {
            const len = readVarint(buffer, cursor)
            cursor = len.next
            const nextCursor = Math.min(cursor + len.value, innerEnd)
            if (kind === 2) value = buffer.toString("utf8", cursor, nextCursor)
            else if (kind === 3) {
              const attributeKey = readAttributeKey(buffer, cursor, nextCursor)
              if (attributeKey !== null) attributes.push(attributeKey)
            }
            cursor = nextCursor
          } else {
            break
          }
        }
        if (value !== "") domains.push({ type: domainType, value, attributes })
      }
      offset = innerEnd
    }
    if (code !== "") categories.push({ code, domains })
  }
  return categories
}

/** 读 geosite.dat 并解析（带 mtime 缓存）；文件不存在给 404。 */
const loadGeosite = async (): Promise<{
  size: number
  modified: number
  categories: GeositeCategory[]
}> => {
  let info: Stats
  try {
    info = await lstat(CLASH_VERGE_GEOSITE_FILE)
  } catch {
    throw new PublicOperationError(
      404,
      `找不到 geosite 数据库：${CLASH_VERGE_GEOSITE_FILE}（在 Clash Verge 里更新一次 GEO 数据）`
    )
  }
  const modified = Math.floor(info.mtimeMs / 1000)
  if (geositeCache !== null && geositeCache.modified === modified) {
    return { size: info.size, modified, categories: geositeCache.categories }
  }
  const categories = parseGeosite(await readFile(CLASH_VERGE_GEOSITE_FILE))
  geositeCache = { modified, categories }
  return { size: info.size, modified, categories }
}

/** geosite 概览：文件信息 + 全部分类名与条目数。 */
export const readClashVergeGeosite = async (): Promise<ClashVergeGeosite> => {
  const { size, modified, categories } = await loadGeosite()
  return {
    path: CLASH_VERGE_GEOSITE_FILE,
    size,
    modified,
    totalCategories: categories.length,
    totalDomains: categories.reduce(
      (sum, category) => sum + category.domains.length,
      0
    ),
    categories: categories.map((category) => ({
      code: category.code,
      count: category.domains.length,
      preview: category.domains
        .slice(0, GEOSITE_PREVIEW_LIMIT)
        .map((domain) => ({
          type: domain.type,
          value: domain.value,
          attributes: domain.attributes,
        })),
    })),
  }
}

/** geoip.dat、Country.mmdb、ASN.mmdb：与 geosite.dat 同目录，同样由 Clash Verge 维护。 */
const CLASH_VERGE_GEO_DIR = path.dirname(CLASH_VERGE_PROFILES_FILE)
const CLASH_VERGE_GEOIP_FILE = path.join(CLASH_VERGE_GEO_DIR, "geoip.dat")
const CLASH_VERGE_COUNTRY_FILE = path.join(CLASH_VERGE_GEO_DIR, "Country.mmdb")
const CLASH_VERGE_ASN_FILE = path.join(CLASH_VERGE_GEO_DIR, "ASN.mmdb")
/** ASN 动辄八万多个，全给页面没意义：按网段数取前 500 个。 */
const MMDB_GROUP_LIMIT = 500

/** geoip.dat 解析结果缓存：文件 mtime 变了才重解。 */
let geoipCache: {
  modified: number
  categories: ReturnType<typeof parseGeoipDat>
} | null = null

/** mmdb 聚合结果缓存：键是文件路径，值为 mtime 与分组。 */
const mmdbCache = new Map<
  string,
  {
    modified: number
    size: number
    meta: ReturnType<typeof readMmdbMeta>
    totalNetworks: number
    totalGroups: number
    groups: { key: string; label: string; count: number; preview: string[] }[]
  }
>()

/** 报 404 时把文件名带上，方便看出是哪份 GEO 数据缺了。 */
const geoFileMissing = (file: string): PublicOperationError =>
  new PublicOperationError(
    404,
    `找不到 ${path.basename(file)}：${file}（在 Clash Verge 里更新一次 GEO 数据）`
  )

/** geoip.dat 概览：国家码、网段总数与前几条网段。 */
export const readClashVergeGeoip = async (): Promise<ClashVergeGeoip> => {
  let info: Stats
  try {
    info = await lstat(CLASH_VERGE_GEOIP_FILE)
  } catch {
    throw geoFileMissing(CLASH_VERGE_GEOIP_FILE)
  }
  const modified = Math.floor(info.mtimeMs / 1000)
  if (geoipCache === null || geoipCache.modified !== modified) {
    geoipCache = {
      modified,
      categories: parseGeoipDat(
        await readFile(CLASH_VERGE_GEOIP_FILE),
        GEOSITE_PREVIEW_LIMIT
      ),
    }
  }
  const categories = geoipCache.categories
  return {
    path: CLASH_VERGE_GEOIP_FILE,
    size: info.size,
    modified,
    totalCategories: categories.length,
    totalCidrs: categories.reduce((sum, item) => sum + item.count, 0),
    categories,
  }
}

/**
 * 把 mmdb 的网段按国家或 ASN 聚合：遍历一次全库，只留下分组计数与
 * 每组前几条网段。首次遍历要一两秒，之后按 mtime 复用结果。
 */
const loadMmdbGroups = async (
  file: string,
  kind: "country" | "asn"
): Promise<{
  size: number
  modified: number
  meta: ReturnType<typeof readMmdbMeta>
  totalNetworks: number
  totalGroups: number
  groups: { key: string; label: string; count: number; preview: string[] }[]
}> => {
  let info: Stats
  try {
    info = await lstat(file)
  } catch {
    throw geoFileMissing(file)
  }
  const modified = Math.floor(info.mtimeMs / 1000)
  const cached = mmdbCache.get(file)
  if (cached !== undefined && cached.modified === modified) return cached

  const buffer = await readFile(file)
  const meta = readMmdbMeta(buffer)
  const accumulator = new Map<
    string | number,
    { label: string; count: number; preview: string[] }
  >()
  let totalNetworks = 0
  walkMmdb(buffer, meta, (cidr, data) => {
    totalNetworks += 1
    // ASN 用数字作键：几百万次拼 "AS12345" 字符串会让首次遍历明显变慢。
    const key =
      kind === "country"
        ? pickString(data, "country.iso_code") ||
          pickString(data, "registered_country.iso_code") ||
          "未知"
        : (pickNumber(data, "autonomous_system_number") ?? 0)
    const label =
      kind === "country"
        ? pickString(data, "country.names.en")
        : pickString(data, "autonomous_system_organization")
    const existing = accumulator.get(key)
    if (existing === undefined) {
      accumulator.set(key, { label, count: 1, preview: [cidr] })
      return
    }
    existing.count += 1
    if (existing.preview.length < GEOSITE_PREVIEW_LIMIT) {
      existing.preview.push(cidr)
    }
  })

  const groups = [...accumulator.entries()]
    .map(([key, item]) => ({
      key: kind === "country" ? String(key) : `AS${key}`,
      ...item,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, MMDB_GROUP_LIMIT)
  const result = {
    size: info.size,
    modified,
    meta,
    totalNetworks,
    groups,
    totalGroups: accumulator.size,
  }
  mmdbCache.set(file, result)
  return result
}

/** Country.mmdb 概览：按国家聚合的网段。 */
export const readClashVergeCountry = async (): Promise<ClashVergeMmdb> => {
  const { size, modified, meta, totalNetworks, groups, totalGroups } =
    await loadMmdbGroups(CLASH_VERGE_COUNTRY_FILE, "country")
  return {
    path: CLASH_VERGE_COUNTRY_FILE,
    size,
    modified,
    meta,
    totalNetworks,
    totalGroups,
    groups,
  }
}

/** ASN.mmdb 概览：按 ASN 聚合的网段。 */
export const readClashVergeAsn = async (): Promise<ClashVergeMmdb> => {
  const { size, modified, meta, totalNetworks, groups, totalGroups } =
    await loadMmdbGroups(CLASH_VERGE_ASN_FILE, "asn")
  return {
    path: CLASH_VERGE_ASN_FILE,
    size,
    modified,
    meta,
    totalNetworks,
    totalGroups,
    groups,
  }
}

/**
 * 读订阅清单：Clash Verge 不对外提供订阅 API，只能解析 profiles.yaml。
 * 这里回显磁盘上的配置内容，不是内核运行状态；文件不存在给 404，
 * 解析不出条目时返回空列表，不伪造订阅。
 */ export const readClashVergeProfiles =
  async (): Promise<ClashVergeProfilesResponse> => {
    const { document } = await readClashVergeIndex()
    const entries = profileEntries(document.items)
    // 顶层 current 是被启用订阅的 uid：只有一个订阅会被标记为当前启用。
    const currentUid =
      typeof document.current === "string" ? document.current : ""
    const profiles = await Promise.all(
      entries.map(async (entry) => ({
        uid: entry.uid,
        name: entry.name,
        url: entry.url,
        current: entry.uid !== "" && entry.uid === currentUid,
        ...(await profileNodes(entry.file)),
      }))
    )
    return {
      path: CLASH_VERGE_PROFILES_FILE,
      sampledAt: Math.floor(Date.now() / 1000),
      profiles,
    }
  }

/* ---------- 切换当前订阅 ---------- */

/** Clash Verge 的 App 名：osascript 与 open 都按名字定位，装在哪都不影响。 */
const CLASH_VERGE_APP_NAME = "Clash Verge"
/** 进程名（二进制名）：pgrep -x 精确匹配，避免误命中其它进程。 */
const CLASH_VERGE_PROCESS_NAME = "clash-verge"
/** 等待退出/启动的单步间隔与步数：合计 12 秒。 */
const RESTART_STEP_MS = 500
const RESTART_STEPS = 24

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const isClashVergeRunning = async (): Promise<boolean> => {
  try {
    await runCommand("/usr/bin/pgrep", ["-x", CLASH_VERGE_PROCESS_NAME])
    return true
  } catch {
    return false
  }
}

/**
 * 只替换 profiles.yaml 顶层的 current 行，保留注释、缩进与条目顺序。
 * 找不到这行就返回 null，由调用方拒绕写，避免追加出重复键。
 */
const replaceCurrentLine = (text: string, uid: string): string | null => {
  const pattern = /^current:[^\n]*$/m
  if (!pattern.test(text)) return null
  return text.replace(pattern, `current: ${uid}`)
}

/** 原子写：同目录临时文件 → fsync → rename，正式文件不会出现半截内容。
 * 目标不存在时按默认权限新建（首次生成合并配置就是这种情况）。
 */
const writeFileAtomic = async (
  file: string,
  content: string
): Promise<void> => {
  const mode = await lstat(file)
    .then((info) => info.mode & 0o777)
    .catch(() => 0o644)
  const temp = path.join(
    path.dirname(file),
    `.profiles.${randomUUID().replace(/-/g, "").slice(0, 16)}.tmp`
  )
  try {
    const handle = await open(temp, "wx", mode)
    try {
      await handle.writeFile(content, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(temp, mode)
    await rename(temp, file)
  } finally {
    await rm(temp, { force: true })
  }
}

/**
 * 重启 Clash Verge：它只在启动时按 current 重建 config.yaml 并加载。
 * 退出迟迟不完成（例如弹了确认框）直接报错，不谎称已重启。
 * 未运行时不动它，下次启动自己生效。
 */
const restartClashVerge = async (): Promise<boolean> => {
  if (!(await isClashVergeRunning())) return false
  await runCommand("/usr/bin/osascript", [
    "-e",
    `quit app "${CLASH_VERGE_APP_NAME}"`,
  ])
  for (let step = 0; step < RESTART_STEPS; step += 1) {
    if (!(await isClashVergeRunning())) break
    await delay(RESTART_STEP_MS)
  }
  if (await isClashVergeRunning()) {
    throw new PublicOperationError(
      409,
      "current 已改写，但 Clash Verge 没有退出（可能在等确认）；手动重启 App 后生效"
    )
  }
  await runCommand("/usr/bin/open", ["-a", CLASH_VERGE_APP_NAME])
  for (let step = 0; step < RESTART_STEPS; step += 1) {
    if (await isClashVergeRunning()) break
    await delay(RESTART_STEP_MS)
  }
  return true
}

/**
 * 切换当前订阅：只改 profiles.yaml 的 current，再重启 Clash Verge 让它重新
 * 生成并加载配置（重启期系统代理与 TUN 短暂中断）。
 *
 * 不在服务端自己合成 config.yaml：Clash Verge 的「订阅 + 全局 Merge + Script」
 * 合成逻辑含 JS 沙箱，复刻不了，强写会弄丢全局规则。
 */
export const setClashVergeCurrentProfile = async (
  uid: string
): Promise<string> => {
  let text: string
  try {
    text = await readFile(CLASH_VERGE_PROFILES_FILE, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PublicOperationError(
        404,
        `找不到 Clash Verge 订阅清单：${CLASH_VERGE_PROFILES_FILE}`
      )
    }
    throw error
  }
  const document = parseYamlRecord(text)
  const target = profileEntries(document.items).find(
    (entry) => entry.uid === uid
  )
  if (!target) {
    throw new PublicOperationError(
      404,
      "订阅不存在：只能切到清单里的 remote 订阅"
    )
  }
  const currentUid =
    typeof document.current === "string" ? document.current : ""
  if (currentUid === uid) {
    throw new PublicOperationError(
      409,
      `「${target.name}」已经是当前启用的订阅`
    )
  }
  const updated = replaceCurrentLine(text, uid)
  if (updated === null) {
    throw new PublicOperationError(409, "订阅清单里没有 current 行，拒绝改写")
  }
  await writeFileAtomic(CLASH_VERGE_PROFILES_FILE, updated)
  const restarted = await restartClashVerge()
  // 回读核实：Clash Verge 启动时有可能写回订阅清单，不核实不报成功。
  const after = await readFile(CLASH_VERGE_PROFILES_FILE, "utf8").catch(
    () => ""
  )
  if (parseYamlRecord(after).current !== uid) {
    throw new PublicOperationError(
      500,
      "已改写 current，但回读不一致；请在 Clash Verge 内确认当前订阅"
    )
  }
  return restarted
    ? `已切换到「${target.name}」，Clash Verge 正在重启；代理会短暂中断`
    : `已切换到「${target.name}」；Clash Verge 未运行，下次启动生效`
}

/* ---------- 合并订阅设置（本应用自己的库） ---------- */

/** 读合并设置：从未保存时给空配置，页面按空态渲染。 */
export const readClashMergeConfig = (): ClashMergeConfig =>
  getClashMergeStore().read() ?? {
    rules: [],
    geositeRules: [],
    customRules: [],
    template: DEFAULT_MERGE_TEMPLATE,
    healthCheck: DEFAULT_HEALTH_CHECK,
    selectedProfiles: [],
    includeFallback: true,
    updatedAt: null,
  }

/** 保存合并设置；整份替换，不做局部合并。 */
export const saveClashMergeConfig = (
  input: SaveClashMergeConfigBody
): string => {
  const updatedAt = getClashMergeStore().save(input)
  return `已保存 ${input.rules.length} 条分组规则（${new Date(updatedAt * 1000).toLocaleString()}）`
}

/* ---------- 生成合并配置 ---------- */

/** 合并结果的固定文件名与展示名：重复合并只覆盖文件，不重复登记。 */
const MERGED_FILE = "freewind-merged.yaml"
const MERGED_NAME = "freewind-merged"
/** 兑底分组名：与页面上的兑底行保持一致。 */
const MERGED_FALLBACK_GROUP = "其他"
/** 规则出口统一指向的总组：在它里可再选具体地区组。 */
const MERGED_PRIMARY_GROUP = "节点选择"
/** 直连开关组：默认 DIRECT，可切到总组或拦截。 */
const MERGED_DIRECT_GROUP = "直连"
/** 拦截开关组：默认 REJECT，可切到直接直连或总组。 */
const MERGED_REJECT_GROUP = "拒绝"

/**
 * 解析基座模板：必须是 YAML 对象，语法错要直接报出原因。
 *
 * proxies 与 proxy-groups 只是占位：保留键的位置，值在组装时被页面生成的内容替换。
 */
const parseMergeTemplate = (
  text: string
): { base: Record<string, unknown>; rules: string[] } => {
  let document: unknown
  try {
    document = parseYaml(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new PublicOperationError(400, `基座模板不是合法 YAML：${detail}`)
  }
  if (!isRecord(document)) {
    throw new PublicOperationError(400, "基座模板必须是一个 YAML 对象")
  }
  const { rules, ...base } = document
  return {
    base,
    rules: (Array.isArray(rules) ? rules : []).filter(
      (rule): rule is string => typeof rule === "string"
    ),
  }
}

/** 编译正则：非法或为空都返回 null，由调用方跳过这条规则。 */
const compileRule = (pattern: string): RegExp | null => {
  const trimmed = pattern.trim()
  if (trimmed === "") return null
  try {
    return new RegExp(trimmed)
  } catch {
    return null
  }
}

/** 生成一个不与现有 uid 冲突的短 id，与 Clash Verge 的 uid 长度一致。 */
const newProfileUid = (existing: Set<string>): string => {
  for (;;) {
    const uid = randomUUID().replace(/-/g, "").slice(0, 12)
    if (!existing.has(uid)) return uid
  }
}

/**
 * 在 items 列表末尾追加一条 local 条目。
 * 只做文本追加，保留原有缩进与注释；items 之后还有其它顶层键时拒绕，不自作主张。
 */
const appendLocalItem = (text: string, uid: string): string => {
  const lines = text.split("\n")
  const itemsLine = lines.findIndex((line) => line.startsWith("items:"))
  if (itemsLine === -1) {
    throw new PublicOperationError(
      409,
      "订阅清单里没有 items 段落，拒绝自动登记"
    )
  }
  const hasLaterKey = lines
    .slice(itemsLine + 1)
    .some((line) => /^[A-Za-z_][\w-]*:/.test(line))
  if (hasLaterKey) {
    throw new PublicOperationError(
      409,
      "订阅清单 items 之后还有其它字段，拒绝自动登记"
    )
  }
  const block = [
    `- uid: ${uid}`,
    "  type: local",
    `  name: ${MERGED_NAME}`,
    `  file: ${MERGED_FILE}`,
    `  updated: ${Math.floor(Date.now() / 1000)}`,
  ].join("\n")
  return `${text.replace(/\n+$/, "")}\n${block}\n`
}

/**
 * 生成合并配置：把选中订阅的节点合到一份新配置里，按分组规则建 select 组。
 *
 * 规则按传入顺序生效，一个节点只归第一个命中它的组；命中 0 个节点的组跳过；
 * 没被任何规则命中的节点归到最后的「其他」组（也是 0 个就不建）。
 * 结果写到 profiles/freewind-merged.yaml，并在订阅清单里登记为 local 配置。
 */
export const mergeClashProfiles = async (
  input: MergeClashProfilesBody
): Promise<string> => {
  let indexText: string
  try {
    indexText = await readFile(CLASH_VERGE_PROFILES_FILE, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PublicOperationError(
        404,
        `找不到 Clash Verge 订阅清单：${CLASH_VERGE_PROFILES_FILE}`
      )
    }
    throw error
  }
  const document = parseYamlRecord(indexText)
  const entries = profileEntries(document.items)
  // 按用户勾选顺序处理：第一个订阅同时提供要继承的通用字段与分流规则。
  const ordered = input.selected
    .map((uid) => entries.find((entry) => entry.uid === uid))
    .filter((entry): entry is ProfileEntry => entry !== undefined)
  if (ordered.length === 0) {
    throw new PublicOperationError(400, "没有选中可合并的订阅")
  }

  // 收集节点：名字前带上订阅名，跨订阅同名靠前缀区分。
  const proxies: Record<string, unknown>[] = []
  const usedNames = new Set<string>()
  /** 新名字 → 订阅里的原名：分组规则里的正则按原名匹配，带 `^` 锚定也不会失效。 */
  const originalNameOf = new Map<string, string>()
  for (const entry of ordered) {
    if (entry.file === "" || path.basename(entry.file) !== entry.file) continue
    let text: string
    try {
      text = await readFile(
        path.join(CLASH_VERGE_PROFILE_DIR, entry.file),
        "utf8"
      )
    } catch {
      continue
    }
    const source = parseYamlRecord(text)
    const items = source.proxies
    for (const proxy of Array.isArray(items) ? items : []) {
      if (!isRecord(proxy) || typeof proxy.name !== "string") continue
      // 节点名前面挂上订阅名：跨订阅同名靠前缀区分，不再做去重。
      const name = `${entry.name} · ${proxy.name}`
      usedNames.add(name)
      originalNameOf.set(name, proxy.name)
      proxies.push({ ...proxy, name })
    }
  }
  if (proxies.length === 0) {
    throw new PublicOperationError(400, "选中的订阅里没有可用节点")
  }

  // 分组：按规则顺序先匹配先归属，命中 0 个的组跳过。
  const assigned = new Set<string>()
  const groups: {
    name: string
    members: string[]
    type: ClashMergeGroupType
  }[] = []
  const groupIndex = new Map<string, number>()
  for (const rule of input.rules) {
    // 页面上未勾选的规则不参与合并；这里再挡一次，不靠前端保证。
    if (!rule.enabled) continue
    const target = rule.target.trim()
    if (target === "") continue
    const regex = compileRule(rule.pattern)
    if (regex === null) continue
    const matches = (name: string): boolean =>
      regex.exec(name) !== null ||
      regex.exec(originalNameOf.get(name) ?? "") !== null
    const members = [...usedNames].filter(
      (name) => !assigned.has(name) && matches(name)
    )
    if (members.length === 0) continue
    for (const name of members) assigned.add(name)
    const existing = groupIndex.get(target)
    if (existing === undefined) {
      groupIndex.set(target, groups.length)
      groups.push({ name: target, members, type: rule.type })
    } else {
      groups[existing].members.push(...members)
    }
  }
  // 「其余」排在最后一组；用户不勾兜底、或没有剩余节点就不建。
  const rest = [...usedNames].filter((name) => !assigned.has(name))
  if (
    input.includeFallback &&
    rest.length > 0 &&
    !groupIndex.has(MERGED_FALLBACK_GROUP)
  ) {
    groups.push({
      name: MERGED_FALLBACK_GROUP,
      members: rest,
      type: "select",
    })
  }
  if (groups.length === 0) {
    throw new PublicOperationError(400, "所有规则都没命中节点，未生成配置")
  }

  // 三个固定组名都可能与地区组撞名，撞上就加后缀，规则跟着用新名。
  const takenNames = new Set(groups.map((group) => group.name))
  const uniqueGroupName = (base: string): string => {
    if (!takenNames.has(base)) {
      takenNames.add(base)
      return base
    }
    let index = 2
    while (takenNames.has(`${base}-${index}`)) index += 1
    const name = `${base}-${index}`
    takenNames.add(name)
    return name
  }
  const outlets = {
    primary: uniqueGroupName(MERGED_PRIMARY_GROUP),
    direct: uniqueGroupName(MERGED_DIRECT_GROUP),
    reject: uniqueGroupName(MERGED_REJECT_GROUP),
  }

  // 基座模板：所有手写配置都从这里来，订阅只提供节点。
  const template = parseMergeTemplate(input.template)
  /** 三个内置出口别名：自定义规则不指定具体分组时用它。 */
  const outletOf: Record<string, string> = {
    proxy: outlets.primary,
    direct: outlets.direct,
    reject: outlets.reject,
  }
  /** 本次生成的全部分组名：自定义规则可以直接把域名指向其中一个。 */
  const outletNames = new Set(groups.map((group) => group.name))
  /**
   * 解析自定义规则的出口：内置别名映射到固定组，其余必须是本次生成的分组名。
   * 写一个不存在的组会让内核拒绕整份配置，所以在合并前就拦下。
   */
  const resolveOutlet = (target: string): string => {
    const alias = outletOf[target]
    if (alias !== undefined) return alias
    if (outletNames.has(target)) return target
    throw new PublicOperationError(
      400,
      `自定义规则的出口分组不存在：${target}（请先在分组规则里加一条同名分组）`
    )
  }
  const healthCheck = input.healthCheck

  // 自定义规则：优先级最高，排在最前面；值为空的行不写进配置。
  const customRules = input.customRules
    .map((rule) => ({ ...rule, value: rule.value.trim() }))
    .filter((rule) => rule.value !== "")
    .map((rule) => `${rule.type},${rule.value},${resolveOutlet(rule.target)}`)

  // GEO 分类分流：用户自定义的在前，固定三条在后，都排在模板规则与 MATCH 之前。
  // 分类名先在本机 geosite.dat 里核实：写错的分类会让内核拒绝整份配置。
  // 数据库本身读不到就直接报错：固定三条是分流的骨架，静默跳过等于生成一份没分流的配置。
  const geositeRules: string[] = []
  const geositeOutletOf = outletOf
  let geositeCodeOf: Map<string, string>
  try {
    const { categories } = await loadGeosite()
    geositeCodeOf = new Map(
      categories.map((category) => [category.code.toUpperCase(), category.code])
    )
  } catch {
    throw new PublicOperationError(
      404,
      `找不到 geosite 数据库，无法校验 GEO 分类：${CLASH_VERGE_GEOSITE_FILE}`
    )
  }
  for (const rule of input.geositeRules) {
    const code = geositeCodeOf.get(rule.code.trim().toUpperCase())
    if (code === undefined) {
      throw new PublicOperationError(
        400,
        `GEO 分类不存在：${rule.code}（写进配置会让内核拒绝加载，已在合并前拦下）`
      )
    }
    geositeRules.push(`GEOSITE,${code},${geositeOutletOf[rule.target]}`)
  }
  // 固定规则：分类已经不在 geosite.dat 里就跳过，不让它挡住合并。
  for (const rule of DEFAULT_GEOSITE_RULES) {
    const code = geositeCodeOf.get(rule.code.toUpperCase())
    if (code === undefined) continue
    geositeRules.push(`GEOSITE,${code},${geositeOutletOf[rule.target]}`)
  }

  // 生成规则骨架：自定义 → GEO → 固定三条 → 代码里的默认规则 → 模板里的规则 → MATCH。
  const rules = [
    ...customRules,
    ...geositeRules,
    ...DEFAULT_MERGE_RULES,
    ...template.rules,
  ]
  // 没有 MATCH 收尾就补一条，否则最后一段流量会落到不存在的组。
  if (!rules.some((rule) => rule.startsWith("MATCH"))) {
    rules.push(`MATCH,${outlets.primary}`)
  }

  // 页面生成的两块：模板里写了对应键就按它的位置填充，没写就追加到末尾。
  const proxyGroups = [
    {
      name: outlets.primary,
      type: "select",
      proxies: groups.map((group) => group.name),
    },
    // 地区组按用户选的类型生成：非 select 的要带测速参数，否则内核用自身默认值。
    ...groups.map((group) => ({
      name: group.name,
      type: group.type,
      ...(group.type === "select"
        ? {}
        : { url: healthCheck.url, interval: healthCheck.interval }),
      ...(group.type === "url-test"
        ? { tolerance: MERGED_URL_TEST_TOLERANCE }
        : {}),
      proxies: group.members,
    })),
    // 两个开关组：默认与写死一致，需要时在面板上一键改道。
    // 两个组不能互相引用：内核会以 ProxyGroup 环路直接拒绝加载，
    // 所以彼此那两个选项都用内置的 DIRECT / REJECT 表示。
    {
      name: outlets.direct,
      type: "select",
      proxies: ["DIRECT", outlets.primary, "REJECT"],
    },
    {
      name: outlets.reject,
      type: "select",
      proxies: ["REJECT", "DIRECT", outlets.primary],
    },
  ]

  /**
   * 按模板的键顺序组装：模板里写到的 proxies / proxy-groups 就填在它原来的位置，
   * 这样模板上看到的占位位置与产物一致；没写就追加在末尾。
   */
  const merged: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(template.base)) {
    if (key === "proxies") merged.proxies = proxies
    else if (key === "proxy-groups") merged["proxy-groups"] = proxyGroups
    else merged[key] = value
  }
  merged.proxies ??= proxies
  merged["proxy-groups"] ??= proxyGroups
  merged.rules = rules

  const mergedText = toYaml(merged, { lineWidth: 0 })
  await writeFileAtomic(
    path.join(CLASH_VERGE_PROFILE_DIR, MERGED_FILE),
    mergedText
  )

  // 登记：已有同名 local 条目就复用 uid，不再重复追加。
  const existingEntry = (
    Array.isArray(document.items) ? document.items : []
  ).find((item) => isRecord(item) && item.name === MERGED_NAME)
  const existingUid =
    isRecord(existingEntry) && typeof existingEntry.uid === "string"
      ? existingEntry.uid
      : null
  if (existingUid === null) {
    const uids = new Set(
      profileEntries(document.items).map((entry) => entry.uid)
    )
    await writeFileAtomic(
      CLASH_VERGE_PROFILES_FILE,
      appendLocalItem(indexText, newProfileUid(uids))
    )
  }

  const summary = groups
    .map((group) => `${group.name}(${group.members.length})`)
    .join("、")
  return `已生成 ${MERGED_FILE}：${proxies.length} 个节点、${groups.length} 个分组（${summary}）；回到订阅列表即可看到「${MERGED_NAME}」`
}
