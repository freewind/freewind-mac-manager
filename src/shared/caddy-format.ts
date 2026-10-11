/**
 * Caddyfile 的识别与校验。
 *
 * 前后端共用同一份纯函数：本任务只做只读识别，后续写入任务也用这里的校验器，
 * 避免页面校验与真正写盘时的判断各写一套而漂移。
 *
 * 识别的形状是刻意收窄的：只认「本功能自己会写出去的那几种写法」，其余一律
 * 计为无法识别并带上行号，绝不猜测语义，也绝不静默丢弃——读错一条转发规则的
 * 代价是用户以为某条规则不存在，比报错更危险。
 */

/** 托管区域的起止标记，成对出现时其中的规则才算本功能管理。 */
export const CADDY_MANAGED_START = "# mac-manager:rules:start"
export const CADDY_MANAGED_END = "# mac-manager:rules:end"

export type CaddyMatchKind = "host" | "path"
export type CaddyRuleOrigin = "managed" | "external"

/** 从配置文件里识别到的一条转发规则；id 由匹配条件派生，不用随机值。 */
export type ParsedCaddyRule = {
  id: string
  matchKind: CaddyMatchKind
  host: string | null
  pathPrefix: string | null
  stripPrefix: boolean
  upstream: string
  origin: CaddyRuleOrigin
  line: number
}

export type CaddyFileParse = {
  siteAddresses: string[]
  hasGlobalOptionsBlock: boolean
  managedRegion: { startLine: number; endLine: number } | null
  rules: ParsedCaddyRule[]
  unsupported: { line: number; text: string }[]
}

/** 去掉行尾的 \r，兼容 CRLF 文件；行号一律按 1-based 交付。 */
const splitLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))

const isIgnorable = (trimmed: string): boolean =>
  trimmed === "" || trimmed.startsWith("#")

/** 数花括号时要先去掉行内注释，注释里的花括号不能改变块的边界。 */
const stripComment = (line: string): string => {
  const index = line.indexOf("#")
  return index < 0 ? line : line.slice(0, index)
}

/** 找出与开括号所在行配对的 `}` 行；文件被截断时返回 null。 */
const findBlockEnd = (lines: string[], startIndex: number): number | null => {
  let depth = 0
  for (let index = startIndex; index < lines.length; index++) {
    for (const character of stripComment(lines[index] ?? "")) {
      if (character === "{") depth += 1
      else if (character === "}") {
        depth -= 1
        if (depth === 0) return index
      }
    }
  }
  return null
}

/** 取出块内部的有效行；空行与注释行不算内容。 */
const blockBodyLines = (
  lines: string[],
  openIndex: number,
  endIndex: number | null
): { line: number; text: string }[] => {
  if (endIndex === null) return []
  const body: { line: number; text: string }[] = []
  for (let index = openIndex + 1; index < endIndex; index++) {
    const text = (lines[index] ?? "").trim()
    if (isIgnorable(text)) continue
    body.push({ line: index + 1, text })
  }
  return body
}

/** 站点块头按空白或逗号切分地址，块头自身的花括号不参与。 */
const splitSiteAddresses = (header: string): string[] =>
  header
    .replace(/\{$/, "")
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

/** 两个标记行都在、且顺序正确时才算一个托管区域；否则按「没有」处理。 */
const findManagedRegion = (
  lines: string[]
): { startLine: number; endLine: number } | null => {
  const startLine =
    lines.findIndex((line) => line.trim() === CADDY_MANAGED_START) + 1
  const endLine =
    lines.findIndex((line) => line.trim() === CADDY_MANAGED_END) + 1
  if (startLine === 0 || endLine === 0 || endLine <= startLine) return null
  return { startLine, endLine }
}

const REVERSE_PROXY_PATTERN = /^reverse_proxy\s+(\S+)$/
const HANDLE_PATH_PATTERN = /^handle_path\s+(\S+)\s*\{$/
const HANDLE_PATTERN = /^handle\s+(\S+)\s*\{$/
const HANDLE_MATCHER_PATTERN = /^handle\s+@(\S+)\s*\{$/
const MATCHER_HOST_PATTERN = /^@(\S+)\s+host\s+(\S+)$/

export const parseCaddyfile = (text: string): CaddyFileParse => {
  const lines = splitLines(text)
  const siteAddresses: string[] = []
  const rules: ParsedCaddyRule[] = []
  const unsupported: { line: number; text: string }[] = []
  /** 同一匹配条件可能出现多次，用出现次数派生唯一 id。 */
  const idCounts = new Map<string, number>()
  let hasGlobalOptionsBlock = false

  const addRule = (input: {
    matchKind: CaddyMatchKind
    host: string | null
    pathPrefix: string | null
    stripPrefix: boolean
    upstream: string
    line: number
  }): void => {
    const base =
      input.matchKind === "host"
        ? `host:${input.host ?? ""}`
        : `path:${input.pathPrefix ?? ""}`
    const count = (idCounts.get(base) ?? 0) + 1
    idCounts.set(base, count)
    rules.push({
      id: count === 1 ? base : `${base}#${count}`,
      ...input,
      // 先按区域外处理，扫描结束后再按托管区域改。
      origin: "external",
    })
  }

  /**
   * 识别 handle 家族的一块：块内必须恰好一行 reverse_proxy。
   * 少一行、多一行或写法不认识时，整块都计为无法识别并保留原文行号。
   */
  const addHandleRule = (input: {
    header: string
    line: number
    openIndex: number
    matchKind: CaddyMatchKind
    host: string | null
    pathPrefix: string | null
    stripPrefix: boolean
  }): number => {
    const end = findBlockEnd(lines, input.openIndex)
    const body = blockBodyLines(lines, input.openIndex, end)
    const single = body.length === 1 ? body[0] : undefined
    const reverseProxy =
      single === undefined ? null : REVERSE_PROXY_PATTERN.exec(single.text)
    if (reverseProxy === null) {
      unsupported.push({ line: input.line, text: input.header })
      for (const item of body) unsupported.push(item)
    } else {
      addRule({
        matchKind: input.matchKind,
        host: input.host,
        pathPrefix: input.pathPrefix,
        stripPrefix: input.stripPrefix,
        upstream: reverseProxy[1] ?? "",
        line: input.line,
      })
    }
    return end === null ? lines.length : end + 1
  }

  /** 扫描站点块内部，返回站点块闭合行之后的下一行下标。 */
  const scanSiteBody = (startIndex: number): number => {
    /**
     * 每个站点块一份 matcher 映射：同名 matcher 在不同站点块可以指向不同
     * host，共用一份会把别的站点块的 host 套进本块，凭空识别出不存在的规则。
     */
    const matcherHosts = new Map<string, string>()
    let index = startIndex
    while (index < lines.length) {
      const header = (lines[index] ?? "").trim()
      const line = index + 1
      if (isIgnorable(header)) {
        index += 1
        continue
      }
      if (header === "}") return index + 1

      const handlePath = HANDLE_PATH_PATTERN.exec(header)
      if (handlePath !== null) {
        index = addHandleRule({
          header,
          line,
          openIndex: index,
          matchKind: "path",
          host: null,
          pathPrefix: handlePath[1] ?? "",
          stripPrefix: true,
        })
        continue
      }

      const pathHandle = HANDLE_PATTERN.exec(header)
      if (pathHandle !== null && (pathHandle[1] ?? "").startsWith("/")) {
        index = addHandleRule({
          header,
          line,
          openIndex: index,
          matchKind: "path",
          host: null,
          pathPrefix: pathHandle[1] ?? "",
          stripPrefix: false,
        })
        continue
      }

      const matcher = MATCHER_HOST_PATTERN.exec(header)
      if (matcher !== null) {
        matcherHosts.set(matcher[1] ?? "", matcher[2] ?? "")
        index += 1
        continue
      }

      const matcherHandle = HANDLE_MATCHER_PATTERN.exec(header)
      if (matcherHandle !== null) {
        const name = matcherHandle[1] ?? ""
        const host = matcherHosts.get(name)
        if (host === undefined) {
          // 没记录过同名 matcher 就无法知道转发目标，不能猜。
          unsupported.push({ line, text: header })
          const end = findBlockEnd(lines, index)
          index = end === null ? lines.length : end + 1
          continue
        }
        index = addHandleRule({
          header,
          line,
          openIndex: index,
          matchKind: "host",
          host,
          pathPrefix: null,
          stripPrefix: false,
        })
        continue
      }

      // tls 是已知的站点级指令，但与转发规则无关，忽略而不算无法识别。
      if (header === "tls" || header.startsWith("tls ")) {
        index += 1
        continue
      }

      unsupported.push({ line, text: header })
      // 认不出的块整体跳过，避免把块内每一行都重复记一遍。
      if (header.endsWith("{")) {
        const end = findBlockEnd(lines, index)
        index = end === null ? lines.length : end + 1
        continue
      }
      index += 1
    }
    return lines.length
  }

  let index = 0
  while (index < lines.length) {
    const header = (lines[index] ?? "").trim()
    const line = index + 1
    if (isIgnorable(header)) {
      index += 1
      continue
    }
    if (header === "{") {
      // 顶层单独一行的花括号就是全局选项块，内部整块只管跳过。
      hasGlobalOptionsBlock = true
      const end = findBlockEnd(lines, index)
      index = end === null ? lines.length : end + 1
      continue
    }
    if (header.endsWith("{")) {
      siteAddresses.push(...splitSiteAddresses(header))
      index = scanSiteBody(index + 1)
      continue
    }
    unsupported.push({ line, text: header })
    index += 1
  }

  const managedRegion = findManagedRegion(lines)
  const inManagedRegion = (line: number): boolean =>
    managedRegion !== null &&
    line > managedRegion.startLine &&
    line < managedRegion.endLine

  return {
    siteAddresses,
    hasGlobalOptionsBlock,
    managedRegion,
    rules: rules.map((rule) => ({
      ...rule,
      origin: inManagedRegion(rule.line) ? "managed" : "external",
    })),
    unsupported,
  }
}

const FORBIDDEN_CHARACTERS = /[\s{}#`"']/

/** 校验一条 host 匹配条件；合法返回 null，非法返回中文原因。 */
export const validateCaddyHost = (value: string): string | null => {
  if (value.length === 0) return "域名不能为空"
  if (value.length > 253) return "域名长度不能超过 253 个字符"
  if (
    FORBIDDEN_CHARACTERS.test(value) ||
    value.includes("/") ||
    value.includes(":")
  ) {
    return "域名不能包含空白、斜杠、冒号、引号、花括号、井号或反引号"
  }
  if (!/^[A-Za-z0-9.*-]+$/.test(value)) {
    return "域名只能包含字母、数字、点、连字符和通配符"
  }
  if (/^[.-]/.test(value) || /[.-]$/.test(value)) {
    return "域名不能以点或连字符开头或结尾"
  }
  return null
}

/** 校验一条路径前缀；合法返回 null，非法返回中文原因。 */
export const validateCaddyPathPrefix = (value: string): string | null => {
  if (value.length === 0) return "路径不能为空"
  if (value.length > 512) return "路径长度不能超过 512 个字符"
  if (!value.startsWith("/")) return "路径必须以 / 开头"
  if (FORBIDDEN_CHARACTERS.test(value)) {
    return "路径不能包含空白、引号、花括号、井号或反引号"
  }
  return null
}

const isIpv4 = (value: string): boolean =>
  /^(\d{1,3})(\.\d{1,3}){3}$/.test(value) &&
  value.split(".").every((part) => Number(part) <= 255)

const isBracketedIpv6 = (value: string): boolean =>
  /^\[[0-9A-Fa-f:.]+\]$/.test(value)

/** 常规域名：标签以字母或数字开头结尾，不允许下划线。 */
const DOMAIN_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/

/** 校验转发目标；合法返回 null，非法返回中文原因。 */
export const validateCaddyUpstream = (value: string): string | null => {
  if (value.length === 0) return "上游地址不能为空"
  if (/\s/.test(value)) return "上游地址不能包含空白"
  if (/[{}#`"']/.test(value)) {
    return "上游地址不能包含引号、花括号、井号或反引号"
  }
  const match = /^(?:https?:\/\/)?(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(value)
  if (match === null) {
    return "上游地址必须是 host:port、http://host:port 或 https://host:port"
  }
  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "端口必须是 1 到 65535 之间的整数"
  }
  const host = match[1] ?? ""
  if (isIpv4(host) || isBracketedIpv6(host) || DOMAIN_PATTERN.test(host)) {
    return null
  }
  return "主机名必须是 IPv4、[IPv6] 或合法域名"
}

/** 归一化路径前缀，供后续判断两条规则是否重叠；只去掉结尾的 * 与多余的 /。 */
export const normalizeCaddyPathPrefix = (value: string): string => {
  const withoutWildcard = value.replace(/\*+$/, "")
  if (withoutWildcard.length <= 1) return withoutWildcard
  return withoutWildcard.replace(/\/+$/, "")
}
