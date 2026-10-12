/**
 * 助手上下文是「页面快照」：只把页面上已经显示出来的真实数据整理成一段文字，
 * 交给用户检查后再手动发送。这里不做任何取数（不请求接口、不读 DOM），
 * 也不复制远程数据到全局 store。
 *
 * 三条硬约束：
 * - 不捏造：没拿到的数据就写「尚未获取」或「读取失败」，不猜数值。
 * - 不塞满：总量与条数都有上限，超出时明确标出截断。
 * - 不带秘密：疑似凭据的行统一替换，不外传密码、token、API key。
 */

export const AI_CONTEXT_MAX_CHARS = 4000
export const AI_CONTEXT_MAX_ITEMS_PER_LIST = 10

/** 固定的收尾说明：上下文只是快照，最新状态要用 API 核实。 */
export const AI_CONTEXT_NOTICE =
  "优先调用本应用 API 核实最新状态；本上下文为页面快照，不代表实时状态。"

export type AiAssistantContextStatus = "loading" | "error" | "ready"

export type AiAssistantContextList = {
  /** 列表名称，例如「容器」。 */
  label: string
  /** 页面上已显示的条目，一行一条。 */
  items: string[]
  /** 该列表的总条数；大于已列条数时说明被截断。 */
  total?: number
}

export type AiAssistantContextInput = {
  /** 功能名称，例如「流量监控」。 */
  feature: string
  /** 本页正在查看的对象或范围。 */
  subject?: string | null
  /** 数据的采集时间（毫秒）。 */
  collectedAt?: number | null
  /** 前端缓存时间（毫秒）。 */
  cachedAt?: number | null
  status: AiAssistantContextStatus
  /** 读取失败时的说明，原样来自页面，不加工。 */
  errorMessage?: string | null
  /** 页面上已显示的指标摘要行。 */
  summary?: string[]
  /** 页面上已显示的列表摘要。 */
  lists?: AiAssistantContextList[]
}

const REDACTED = "（已省略疑似凭据内容）"
const TRUNCATION_MARKER = "…（上下文已截断，省略了部分内容）"
const SECRET_PATTERN =
  /(api[_-]?key|access[_-]?key|secret|token|password|passwd|authorization|bearer|credential|private[_-]?key)/i

/** 每个输出字段（功能名、对象、错误说明、摘要、列表名与条目）都过同一道脱敏。 */
const sanitize = (line: string): string =>
  SECRET_PATTERN.test(line) ? REDACTED : line

/** `new Date` 的合法范围：超出就会抛 RangeError。 */
const MAX_TIME_MS = 8.64e15

/** 固定 UTC 文本，避免同一份快照在不同时区/语言下输出不同内容。 */
const formatTime = (value: number | null | undefined): string | null => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_TIME_MS
  ) {
    return null
  }
  return `${new Date(value)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "")} UTC`
}

const statusLines = (input: AiAssistantContextInput): string[] => {
  if (input.status === "loading") {
    return ["数据状态：尚未获取（页面仍在加载，未拿到可摘录的数据）"]
  }
  if (input.status === "error") {
    const reason = input.errorMessage?.trim()
    return [
      `数据状态：读取失败（${
        reason ? sanitize(reason) : "页面未提供失败原因"
      }）`,
    ]
  }
  const times: string[] = []
  const collected = formatTime(input.collectedAt)
  const cached = formatTime(input.cachedAt)
  if (collected) times.push(`采集时间 ${collected}`)
  if (cached) times.push(`缓存时间 ${cached}`)
  return [
    times.length > 0
      ? `数据状态：正常（${times.join("，")}）`
      : "数据状态：正常（未提供时间）",
  ]
}

const listLines = (list: AiAssistantContextList): string[] => {
  const items = list.items.slice(0, AI_CONTEXT_MAX_ITEMS_PER_LIST)
  const total = list.total ?? list.items.length
  const header =
    total > items.length
      ? `${sanitize(list.label)}（共 ${total} 条，仅列前 ${items.length} 条）：`
      : `${sanitize(list.label)}（${items.length} 条）：`
  if (items.length === 0) return [`${sanitize(list.label)}：页面尚未展示条目。`]
  return [header, ...items.map((item) => `- ${sanitize(item)}`)]
}

/**
 * 生成预填上下文。输出稳定：同样的入参永远得到同样的文本。
 *
 * 长度预算作用于**整体输出**（含功能名、对象、状态行与收尾说明），
 * 所以不论哪个字段超长，结果都不会突破 AI_CONTEXT_MAX_CHARS；
 * 截断时保留收尾说明并补上明确的截断标记。
 */
export const buildAiAssistantContext = (
  input: AiAssistantContextInput
): string => {
  const feature = sanitize(input.feature.trim() || "未命名功能")
  const subject = input.subject?.trim() ? sanitize(input.subject.trim()) : null
  const heading = subject
    ? `【AI 助手上下文 · ${feature}】${subject}`
    : `【AI 助手上下文 · ${feature}】`

  const header = [heading, ...statusLines(input).map(sanitize)]

  const body: string[] = []
  const summary = (input.summary ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (summary.length > 0) {
    body.push("已显示的指标：", ...summary.map((line) => `- ${sanitize(line)}`))
  }
  for (const list of input.lists ?? []) {
    const lines = listLines(list)
    if (lines.length === 0) continue
    if (body.length > 0) body.push("")
    body.push(...lines)
  }
  if (body.length === 0 && input.status === "ready") {
    body.push("页面尚未展示可摘录的数据，请先在页面上完成一次读取。")
  }

  const bodyText = body.join("\n")
  const full =
    bodyText.length > 0
      ? [header.join("\n"), bodyText, AI_CONTEXT_NOTICE].join("\n\n")
      : [header.join("\n"), AI_CONTEXT_NOTICE].join("\n\n")
  if (full.length <= AI_CONTEXT_MAX_CHARS) return full

  // 超出上限：从头部保留能放下的内容，末尾补截断标记与固定收尾说明。
  const suffix = `\n\n${TRUNCATION_MARKER}\n\n${AI_CONTEXT_NOTICE}`
  const keep = Math.max(0, AI_CONTEXT_MAX_CHARS - suffix.length)
  const cut = full.slice(0, keep).trimEnd()
  // 按 UTF-16 切可能把代理对切成半个字符，这里回退一位。
  const safe = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
  return `${safe}${suffix}`
}
