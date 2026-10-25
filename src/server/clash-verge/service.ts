import { randomUUID } from "node:crypto"
import type { Stats } from "node:fs"
import { constants } from "node:fs"
import {
  chmod,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises"
import path from "node:path"
import { runCommand } from "@server/common/collect"
import { PublicOperationError } from "@server/common/public-error"
import {
  CLASH_VERGE_MERGE_FILE,
  CLASH_VERGE_PROFILE_DIR,
  CLASH_VERGE_PROFILES_FILE,
} from "@server/env"
import type {
  ClashMergeConfig,
  ClashVergeConnection,
  ClashVergeConnectionsResponse,
  ClashVergeGeosite,
  ClashVergeGeositeCategoryDetail,
  ClashVergeMergeFile,
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
  CLASH_VERGE_MERGE_MAX_CHARS,
  ClashVergeConnectionsResponseSchema,
  ClashVergeProxiesResponseSchema,
  ClashVergeStatusSchema,
} from "@shared/api-contract/schemas/clash-verge"
import { stringify as toYaml } from "yaml"
import {
  ControllerError,
  connectionLimit,
  requestControllerJson,
} from "./controller"
import { parseYamlRecord } from "./discovery"
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

/* ---------- 全局 Merge 文件（uid: Merge）读写 ---------- */

/**
 * Merge 文件字节上限：schema 按字符数挡请求体，这里按 UTF-8 字节数
 * （每字符最多 4 字节）先挡磁盘文件，读完再按字符数复核，两层都不放行超大内容。
 */
const mergeByteLimit = (): number => CLASH_VERGE_MERGE_MAX_CHARS * 4

/** 不跟随符号链接打开；竞态窗口内被换成链接时也回 403，不落成通用 500。 */
const openWithNoFollow = async (file: string) => {
  try {
    return await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new PublicOperationError(403, "Merge 文件不允许是符号链接")
    }
    throw error
  }
}

/**
 * 固定路径的目标校验：路径来自服务端配置，不接受客户端传入。
 * 先拒绝符号链接，再确认真实路径落在 profiles 目录内（防配置目录被换链越界）；
 * 文件不存在给 404，而不是让底层 ENOENT 变成通用 500。
 */
const resolveMergeTarget = async (): Promise<Stats> => {
  let info: Stats
  try {
    info = await lstat(CLASH_VERGE_MERGE_FILE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PublicOperationError(
        404,
        `找不到 Clash Verge 全局 Merge 文件：${CLASH_VERGE_MERGE_FILE}（请先在 Clash Verge 中生成 Merge 配置）`
      )
    }
    throw error
  }
  if (info.isSymbolicLink()) {
    throw new PublicOperationError(403, "Merge 文件不允许是符号链接")
  }
  const [realFile, realDir] = await Promise.all([
    realpath(CLASH_VERGE_MERGE_FILE),
    realpath(CLASH_VERGE_PROFILE_DIR).catch(() => null),
  ])
  if (realDir === null) {
    throw new PublicOperationError(
      404,
      `找不到 Clash Verge 配置目录：${CLASH_VERGE_PROFILE_DIR}`
    )
  }
  const relative = path.relative(realDir, realFile)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PublicOperationError(403, "Merge 文件不在 Clash Verge 配置目录内")
  }
  return info
}

/** 读全局 Merge：整份文本，超上限拒绝读取，不截断冒充成功。 */
export const readClashVergeMergeFile =
  async (): Promise<ClashVergeMergeFile> => {
    const info = await resolveMergeTarget()
    if (info.size > mergeByteLimit()) {
      throw new PublicOperationError(403, "Merge 文件超出大小上限，拒绝读取")
    }
    // O_NOFOLLOW：lstat 校验与打开之间目标被换成符号链接也读不进去。
    const handle = await openWithNoFollow(CLASH_VERGE_MERGE_FILE)
    let content: string
    try {
      content = await handle.readFile("utf8")
    } finally {
      await handle.close()
    }
    if (content.length > CLASH_VERGE_MERGE_MAX_CHARS) {
      throw new PublicOperationError(403, "Merge 文件超出大小上限，拒绝读取")
    }
    return {
      path: CLASH_VERGE_MERGE_FILE,
      content,
      size: info.size,
      modified: Math.floor(info.mtimeMs / 1000),
    }
  }

/**
 * 保存全局 Merge：整份替换。已知限制——本函数只落盘，不触发 Clash Verge
 * 重载，保存后需在 Clash Verge 内重载配置才生效；也不修改订阅专属 merge。
 * 原子写：同目录临时文件 → fsync → rename，正式路径不会出现半截内容，
 * 权限位沿用原文件。写前再查一次符号链接，避免校验与写入之间被换目标。
 */
export const saveClashVergeMergeFile = async (
  content: string
): Promise<string> => {
  if (content.length > CLASH_VERGE_MERGE_MAX_CHARS) {
    throw new PublicOperationError(400, "Merge 内容超出大小上限")
  }
  const info = await resolveMergeTarget()
  const mode = info.mode & 0o777
  const temp = path.join(
    path.dirname(CLASH_VERGE_MERGE_FILE),
    `.Merge.${randomUUID().replace(/-/g, "").slice(0, 16)}.tmp`
  )
  try {
    const handle = await open(temp, "wx", mode)
    try {
      await handle.writeFile(content, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    const current = await lstat(CLASH_VERGE_MERGE_FILE)
    if (current.isSymbolicLink()) {
      throw new PublicOperationError(403, "Merge 文件不允许是符号链接")
    }
    await chmod(temp, mode)
    await rename(temp, CLASH_VERGE_MERGE_FILE)
  } finally {
    await rm(temp, { force: true })
  }
  return `已写入 ${CLASH_VERGE_MERGE_FILE}（${Buffer.byteLength(content, "utf8")} 字节）；需在 Clash Verge 中重载配置后生效`
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

/** 分类条目一页的条数：页面按页翻，一次不拉十几万条。 */
const GEOSITE_PAGE_SIZE = 500

/** protobuf 里的类型枚举顺序：Plain / Regex / RootDomain / Full。 */
const GEOSITE_DOMAIN_TYPES = ["plain", "regex", "rootdomain", "full"] as const

type GeositeDomainType = (typeof GEOSITE_DOMAIN_TYPES)[number]

type GeositeCategory = {
  code: string
  domains: { type: GeositeDomainType; value: string }[]
}

/** 解析结果缓存：文件 mtime 变了才重解，否则每次请求都要重读 4 MB。 */
let geositeCache: { modified: number; categories: GeositeCategory[] } | null =
  null

/** 读一个 protobuf varint：返回数值与下一个字节位置。 */
const readVarint = (
  buffer: Buffer,
  start: number
): { value: number; next: number } => {
  let value = 0
  let shift = 0
  let offset = start
  while (offset < buffer.length) {
    const byte = buffer[offset] ?? 0
    offset += 1
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { value, next: offset }
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
            cursor = nextCursor
          } else {
            break
          }
        }
        if (value !== "") domains.push({ type: domainType, value })
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
    })),
  }
}

/** 单个分类的域名条目：分类名大小写不敏感，查不到给 404；按 offset/limit 分页。 */
export const readClashVergeGeositeCategory = async (
  code: string,
  offset = 0,
  limit = GEOSITE_PAGE_SIZE
): Promise<ClashVergeGeositeCategoryDetail> => {
  const { categories } = await loadGeosite()
  const upper = code.toUpperCase()
  const category = categories.find((item) => item.code.toUpperCase() === upper)
  if (category === undefined) {
    throw new PublicOperationError(404, `geosite 里没有这个分类：${code}`)
  }
  return {
    code: category.code,
    total: category.domains.length,
    offset,
    domains: category.domains.slice(offset, offset + limit),
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
  getClashMergeStore().read() ?? { rules: [], updatedAt: null }

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
 * 从第一个订阅继承的字段：目前只带 rules 依赖的 rule-providers。
 * dns、端口、控制接口、TUN 这些都还没定，且端口类由 Clash Verge 自己生成。
 */
const MERGED_INHERIT_KEYS = ["rule-providers"] as const

/**
 * 原组全是特殊目标（DIRECT / REJECT / PASS）时返回对应关键字：
 * 直连组、广告拦截组不能改成代理组，否则国内流量与广告会走代理。
 * 只要组里有真实节点就返回 null，按代理组处理。
 */
const specialOutletOf = (members: string[]): string | null => {
  if (members.length === 0) return null
  const kinds = new Set<string>()
  for (const member of members) {
    const upper = member.toUpperCase()
    if (upper.startsWith("REJECT")) kinds.add("REJECT")
    else if (upper === "DIRECT") kinds.add("DIRECT")
    else if (upper === "PASS") kinds.add("PASS")
    else return null
  }
  return [...kinds][0] ?? null
}

/** 合并后出口可用的固定名字，撞名时会带后缀。 */
type MergedOutlets = {
  primary: string
  direct: string
  reject: string
}

/**
 * 把规则里指向原订阅组的出口换成合并后的出口。
 * 出口位置固定：MATCH / FINAL 在第 2 段，其余规则在第 3 段；
 * 后面的 no-resolve、resolve 是参数，不得当成出口。
 */
const rewriteRuleGroup = (
  rule: string,
  originalGroups: Map<string, string[]>,
  outlets: MergedOutlets
): string => {
  const parts = rule.split(",")
  const head = parts[0].trim().toUpperCase()
  const outletIndex = head === "MATCH" || head === "FINAL" ? 1 : 2
  if (parts.length <= outletIndex) return rule
  const outlet = parts[outletIndex].trim()
  const members = originalGroups.get(outlet)
  // 原订阅里的组：按成员性质归到总组或两个开关组。
  if (members !== undefined) {
    const special = specialOutletOf(members)
    if (special === "DIRECT") parts[outletIndex] = outlets.direct
    else if (special === "REJECT") parts[outletIndex] = outlets.reject
    else if (special === "PASS") return rule
    else parts[outletIndex] = outlets.primary
    return parts.join(",")
  }
  // 本来就是内置目标的，也接到开关组上，才能一键改道。
  const upper = outlet.toUpperCase()
  if (upper === "DIRECT") {
    parts[outletIndex] = outlets.direct
    return parts.join(",")
  }
  if (upper === "REJECT") {
    parts[outletIndex] = outlets.reject
    return parts.join(",")
  }
  return rule
}

/** 节点名必须唯一：重名时依次加 -2、-3 后缀。 */
const uniqueNodeName = (name: string, used: Set<string>): string => {
  if (!used.has(name)) return name
  let index = 2
  while (used.has(`${name}-${index}`)) index += 1
  return `${name}-${index}`
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

  // 收集节点：重名节点加后缀，否则整份配置会因重名失效。
  const proxies: Record<string, unknown>[] = []
  const usedNames = new Set<string>()
  /** 原订阅里的组名与成员：用来把 rules 的出口改成合并后的组。 */
  const originalGroups = new Map<string, string[]>()
  let baseDocument: Record<string, unknown> | null = null
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
    baseDocument ??= source
    for (const group of Array.isArray(source["proxy-groups"])
      ? source["proxy-groups"]
      : []) {
      if (isRecord(group) && typeof group.name === "string") {
        originalGroups.set(
          group.name,
          (Array.isArray(group.proxies) ? group.proxies : []).filter(
            (member): member is string => typeof member === "string"
          )
        )
      }
    }
    const items = source.proxies
    for (const proxy of Array.isArray(items) ? items : []) {
      if (!isRecord(proxy) || typeof proxy.name !== "string") continue
      const name = uniqueNodeName(proxy.name, usedNames)
      usedNames.add(name)
      proxies.push({ ...proxy, name })
    }
  }
  if (proxies.length === 0) {
    throw new PublicOperationError(400, "选中的订阅里没有可用节点")
  }

  // 分组：按规则顺序先匹配先归属，命中 0 个的组跳过。
  const assigned = new Set<string>()
  const groups: { name: string; members: string[] }[] = []
  const groupIndex = new Map<string, number>()
  for (const rule of input.rules) {
    const target = rule.target.trim()
    if (target === "") continue
    const regex = compileRule(rule.pattern)
    if (regex === null) continue
    const members = [...usedNames].filter(
      (name) => !assigned.has(name) && regex.exec(name) !== null
    )
    if (members.length === 0) continue
    for (const name of members) assigned.add(name)
    const existing = groupIndex.get(target)
    if (existing === undefined) {
      groupIndex.set(target, groups.length)
      groups.push({ name: target, members })
    } else {
      groups[existing].members.push(...members)
    }
  }
  // 「其余」始终排在最后一组；没有剩余节点就不建。
  const rest = [...usedNames].filter((name) => !assigned.has(name))
  if (rest.length > 0 && !groupIndex.has(MERGED_FALLBACK_GROUP)) {
    groups.push({ name: MERGED_FALLBACK_GROUP, members: rest })
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
  const outlets: MergedOutlets = {
    primary: uniqueGroupName(MERGED_PRIMARY_GROUP),
    direct: uniqueGroupName(MERGED_DIRECT_GROUP),
    reject: uniqueGroupName(MERGED_REJECT_GROUP),
  }

  // 继承第一个订阅的通用字段与分流规则（rule-providers 等靠它才完整）。
  const inherited: Record<string, unknown> = {}
  for (const key of MERGED_INHERIT_KEYS) {
    const value = baseDocument === null ? undefined : baseDocument[key]
    if (value !== undefined) inherited[key] = value
  }
  const rawRules = baseDocument === null ? undefined : baseDocument.rules
  const rules = (Array.isArray(rawRules) ? rawRules : [])
    .filter((rule): rule is string => typeof rule === "string")
    .map((rule) => rewriteRuleGroup(rule, originalGroups, outlets))
  // 没有 MATCH 收尾就补一条，否则最后一段流量会落到不存在的组。
  if (!rules.some((rule) => rule.startsWith("MATCH"))) {
    rules.push(`MATCH,${outlets.primary}`)
  }

  const mergedText = toYaml(
    {
      ...inherited,
      proxies,
      "proxy-groups": [
        {
          name: outlets.primary,
          type: "select",
          proxies: groups.map((group) => group.name),
        },
        ...groups.map((group) => ({
          name: group.name,
          type: "select",
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
      ],
      rules,
    },
    { lineWidth: 0 }
  )
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
