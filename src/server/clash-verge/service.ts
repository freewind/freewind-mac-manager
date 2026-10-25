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
import { PublicOperationError } from "@server/common/public-error"
import {
  CLASH_VERGE_MERGE_FILE,
  CLASH_VERGE_PROFILE_DIR,
  CLASH_VERGE_PROFILES_FILE,
} from "@server/env"
import type {
  ClashVergeConnection,
  ClashVergeConnectionsResponse,
  ClashVergeMergeFile,
  ClashVergeProfileNode,
  ClashVergeProfilesResponse,
  ClashVergeProxiesResponse,
  ClashVergeProxy,
  ClashVergeStatus,
} from "@shared/api-contract"
import {
  CLASH_VERGE_MERGE_MAX_CHARS,
  ClashVergeConnectionsResponseSchema,
  ClashVergeProxiesResponseSchema,
  ClashVergeStatusSchema,
} from "@shared/api-contract/schemas/clash-verge"
import {
  ControllerError,
  connectionLimit,
  requestControllerJson,
} from "./controller"
import { parseYamlRecord } from "./discovery"

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

type RemoteProfileEntry = {
  uid: string
  name: string
  url: string
  /** 订阅在 profiles 目录里的配置文件名（如 R9qx7MBAX2DY.yaml），用来读节点。 */
  file: string
}

/**
 * 从 profiles.yaml 的 items 里挑出订阅条目。只认 type 为 remote 的记录，
 * 其余 merge / script / rules 等都是内部配置项，不是订阅。
 * 名称缺失时退回文件名，再退回固定文案，不让界面出现空标题。
 */
const remoteProfiles = (items: unknown): RemoteProfileEntry[] => {
  const result: RemoteProfileEntry[] = []
  for (const item of Array.isArray(items) ? items : []) {
    if (!isRecord(item)) continue
    const url = item.url
    if (item.type !== "remote" || typeof url !== "string") continue
    const file = typeof item.file === "string" ? item.file : ""
    const trimmedName = typeof item.name === "string" ? item.name.trim() : ""
    result.push({
      uid: typeof item.uid === "string" ? item.uid : "",
      name: trimmedName || file || "未命名订阅",
      url,
      file,
    })
  }
  return result
}

/** 单个订阅能回显的节点上限：订阅动辄上百节点，超过只回前面的。 */
const PROFILE_NODES_LIMIT = 300

/**
 * 读单个订阅的节点：节点就在 profiles/<file> 的 proxies 里。
 * 文件名来自 profiles.yaml 而非客户端，仍要求是单纯文件名（不含路径分隔符），
 * 避免异常数据把读取路径带出 profiles 目录；读不到按空列表返回，不报错。
 */
const profileNodes = async (
  file: string
): Promise<{ nodes: ClashVergeProfileNode[]; nodesTruncated: boolean }> => {
  if (file === "" || path.basename(file) !== file) {
    return { nodes: [], nodesTruncated: false }
  }
  let text: string
  try {
    text = await readFile(path.join(CLASH_VERGE_PROFILE_DIR, file), "utf8")
  } catch {
    return { nodes: [], nodesTruncated: false }
  }
  const proxies = parseYamlRecord(text).proxies
  const nodes: ClashVergeProfileNode[] = []
  for (const item of Array.isArray(proxies) ? proxies : []) {
    if (!isRecord(item) || typeof item.name !== "string") continue
    nodes.push({
      name: item.name,
      type: typeof item.type === "string" ? item.type : "未知",
      server: typeof item.server === "string" ? item.server : "",
      port: typeof item.port === "number" ? item.port : null,
    })
  }
  return {
    nodes: nodes.slice(0, PROFILE_NODES_LIMIT),
    nodesTruncated: nodes.length > PROFILE_NODES_LIMIT,
  }
}

/**
 * 读订阅清单：Clash Verge 不对外提供订阅 API，只能解析 profiles.yaml。
 * 这里回显磁盘上的配置内容，不是内核运行状态；文件不存在给 404，
 * 解析不出条目时返回空列表，不伪造订阅。
 */
export const readClashVergeProfiles =
  async (): Promise<ClashVergeProfilesResponse> => {
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
    const entries = remoteProfiles(parseYamlRecord(text).items)
    const profiles = await Promise.all(
      entries.map(async (entry) => ({
        uid: entry.uid,
        name: entry.name,
        url: entry.url,
        ...(await profileNodes(entry.file)),
      }))
    )
    return {
      path: CLASH_VERGE_PROFILES_FILE,
      sampledAt: Math.floor(Date.now() / 1000),
      profiles,
    }
  }
