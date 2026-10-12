import http from "node:http"
import { env } from "@server/env"

/**
 * 与 Clash 内核控制接口之间的传输层。
 *
 * 内核有两种暴露方式：回环 TCP（http://127.0.0.1:9097）与服务模式下的
 * unix socket（-ext-ctl-unix 指定的路径）。两者共用同一套限长、限时与
 * 解析逻辑，差别只在怎么发出请求：TCP 用 fetch，socket 用 node:http
 * （全局 fetch 不支持 socketPath，项目也没有 undici 依赖）。
 */

const MAX_JSON_BYTES = 4 * 1024 * 1024
const MAX_STREAM_SAMPLE_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 2500

export type ControllerTarget =
  | { kind: "unix"; socketPath: string }
  | { kind: "tcp"; baseUrl: URL }

export type ControllerErrorKind =
  | "not_configured"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "invalid_response"

export class ControllerError extends Error {
  constructor(
    message: string,
    readonly kind: ControllerErrorKind
  ) {
    super(message)
    this.name = "ControllerError"
  }
}

/** 只用于日志与错误文案：socket 路径本身不含凭据。 */
export const describeTarget = (target: ControllerTarget): string =>
  target.kind === "unix" ? target.socketPath : target.baseUrl.href

/**
 * 认证头：secret 只在显式配置时发送。
 * 服务模式下 root 侧的运行时配置普通用户读不到，所以「没有 secret」是正常情形，
 * 不能因此报错；真需要 secret 的内核会返回 401，由上层落成 unauthorized。
 */
const authHeaders = (): Record<string, string> => {
  const secret = env.CLASH_VERGE_SECRET
  return {
    Accept: "application/json",
    ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
  }
}

const statusError = (status: number): ControllerError | null => {
  if (status === 401 || status === 403) {
    return new ControllerError("Clash Verge 控制接口认证失败", "unauthorized")
  }
  if (status === 404) {
    return new ControllerError(
      "Clash Verge 控制接口没有这个路径（内核版本可能不支持）",
      "not_found"
    )
  }
  if (status === 429) {
    return new ControllerError(
      "Clash Verge 控制接口请求过于频繁，请稍后重试",
      "rate_limited"
    )
  }
  if (status < 200 || status >= 300) {
    return new ControllerError(
      `Clash Verge 控制接口返回错误（HTTP ${status}）`,
      "unavailable"
    )
  }
  return null
}

const isTimeout = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "TimeoutError" || error.name === "AbortError")

const timeoutError = (): ControllerError =>
  new ControllerError("Clash Verge 控制接口响应超时", "unavailable")

const unreachable = (error: unknown): ControllerError =>
  new ControllerError(
    isTimeout(error)
      ? "Clash Verge 控制接口响应超时"
      : "Clash Verge 控制接口暂不可达",
    "unavailable"
  )

/** 按需拉取的响应字节流：TCP 与 socket 都适配成这一种形状。 */
type Chunk = { done: true } | { done: false; value: Uint8Array }

type ChunkSource = {
  status: number
  contentLength: number
  read: () => Promise<Chunk>
  cancel: () => Promise<void>
}

const toChunkSource = (response: Response): ChunkSource => {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new ControllerError("Clash Verge 未返回数据", "invalid_response")
  }
  return {
    status: response.status,
    contentLength: Number(response.headers.get("content-length")),
    read: async () => {
      const result = await reader.read()
      return result.done ? { done: true } : { done: false, value: result.value }
    },
    cancel: async () => {
      await reader.cancel()
    },
  }
}

/**
 * node:http 的响应流：暂停着等待读取，避免 /traffic 这种不会结束的流
 * 在解析器处理期间继续堆积。
 */
const toNodeChunkSource = (response: http.IncomingMessage): ChunkSource => {
  const queue: Uint8Array[] = []
  let ended = false
  let notify: (() => void) | null = null
  const wake = () => {
    const resolve = notify
    notify = null
    resolve?.()
  }
  response.pause()
  response.on("data", (chunk: Buffer) => {
    response.pause()
    queue.push(new Uint8Array(chunk))
    wake()
  })
  response.on("end", () => {
    ended = true
    wake()
  })
  response.on("error", () => {
    ended = true
    wake()
  })
  return {
    status: response.statusCode ?? 0,
    contentLength: Number(response.headers["content-length"] ?? Number.NaN),
    read: async () => {
      for (;;) {
        const queued = queue.shift()
        if (queued) return { done: false as const, value: queued }
        if (ended) return { done: true as const }
        response.resume()
        await new Promise<void>((resolve) => {
          notify = resolve
        })
        response.pause()
      }
    },
    cancel: async () => {
      response.destroy()
    },
  }
}

const openFetchSource = async (
  target: Extract<ControllerTarget, { kind: "tcp" }>,
  path: string,
  signal: AbortSignal
): Promise<ChunkSource> => {
  const url = new URL(
    path.replace(/^\//, ""),
    target.baseUrl.href.endsWith("/")
      ? target.baseUrl
      : `${target.baseUrl.href}/`
  )
  let response: Response
  try {
    response = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
      redirect: "error",
      signal,
    })
  } catch (error) {
    throw unreachable(error)
  }
  return toChunkSource(response)
}

const openUnixSource = (
  target: Extract<ControllerTarget, { kind: "unix" }>,
  path: string,
  signal: AbortSignal
): Promise<ChunkSource> =>
  new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: target.socketPath,
        path,
        method: "GET",
        headers: authHeaders(),
      },
      (response) => resolve(toNodeChunkSource(response))
    )
    request.on("error", (error) => reject(unreachable(error)))
    signal.addEventListener("abort", () => {
      request.destroy(new Error("aborted"))
    })
    request.end()
  })

/** 从流里取第一个完整 JSON 对象：/traffic 是持续推送的流，读到一个就够。 */
const parseFirstJsonObject = async (source: ChunkSource) => {
  const decoder = new TextDecoder()
  let text = ""
  let depth = 0
  let inString = false
  let escaped = false
  let started = false
  let scannedLength = 0

  for (;;) {
    const chunk = await source.read()
    if (chunk.done) break
    text += decoder.decode(chunk.value, { stream: true })
    if (Buffer.byteLength(text) > MAX_STREAM_SAMPLE_BYTES) {
      await source.cancel()
      throw new ControllerError(
        "Clash Verge 流量样本超出大小限制",
        "invalid_response"
      )
    }
    for (let index = scannedLength; index < text.length; index += 1) {
      const char = text[index]
      if (!started) {
        if (char === "{") {
          started = true
          depth = 1
        }
        continue
      }
      if (inString) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === "{") depth += 1
      else if (char === "}") depth -= 1
      if (started && depth === 0) {
        await source.cancel()
        return JSON.parse(text.slice(text.indexOf("{"), index + 1)) as unknown
      }
    }
    scannedLength = text.length
  }
  throw new ControllerError(
    "Clash Verge 未返回完整流量样本",
    "invalid_response"
  )
}

const readWholeBody = async (source: ChunkSource): Promise<string> => {
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  for (;;) {
    const chunk = await source.read()
    if (chunk.done) break
    totalBytes += chunk.value.byteLength
    if (totalBytes > MAX_JSON_BYTES) {
      await source.cancel()
      throw new ControllerError(
        "Clash Verge 返回内容超出大小限制",
        "invalid_response"
      )
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export const requestJson = async (
  target: ControllerTarget,
  path: string,
  options: {
    signal?: AbortSignal
    timeoutMs?: number
    /** /traffic 这类持续流：只取第一个 JSON 对象后取消连接。 */
    streamFirstObject?: boolean
  } = {}
): Promise<unknown> => {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout

  const source = await (async () => {
    try {
      return target.kind === "unix"
        ? await openUnixSource(target, path, signal)
        : await openFetchSource(target, path, signal)
    } catch (error) {
      // socket 分支被超时中断时是普通 Error，用超时信号区分「超时」与「拒连」
      if (timeout.aborted) throw timeoutError()
      throw error
    }
  })()

  const failure = statusError(source.status)
  if (failure) {
    await source.cancel()
    throw failure
  }
  if (
    Number.isFinite(source.contentLength) &&
    source.contentLength > MAX_JSON_BYTES
  ) {
    await source.cancel()
    throw new ControllerError(
      "Clash Verge 返回内容超出大小限制",
      "invalid_response"
    )
  }

  if (options.streamFirstObject) {
    try {
      return await parseFirstJsonObject(source)
    } catch (error) {
      if (error instanceof ControllerError) throw error
      throw new ControllerError(
        "Clash Verge 返回了无效流量样本",
        "invalid_response"
      )
    }
  }

  const text = await readWholeBody(source)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ControllerError("Clash Verge 返回了无效 JSON", "invalid_response")
  }
}

export const controllerTimeoutMs = REQUEST_TIMEOUT_MS
