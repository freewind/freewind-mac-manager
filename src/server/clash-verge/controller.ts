import { env } from "@server/env"

const MAX_JSON_BYTES = 4 * 1024 * 1024
const MAX_STREAM_SAMPLE_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 2500
const MAX_CONNECTIONS = 200

export type ControllerEndpoint =
  | "version"
  | "configs"
  | "proxies"
  | "traffic"
  | "connections"

export class ControllerError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "not_configured"
      | "unauthorized"
      | "unavailable"
      | "invalid_response"
  ) {
    super(message)
    this.name = "ControllerError"
  }
}

const controllerConfig = (): { baseUrl: URL; secret: string } => {
  const address = env.CLASH_VERGE_CONTROLLER_URL
  const secret = env.CLASH_VERGE_SECRET
  if (!address || !secret) {
    throw new ControllerError("Clash Verge 控制接口尚未配置", "not_configured")
  }

  let baseUrl: URL
  try {
    baseUrl = new URL(address)
  } catch {
    throw new ControllerError("Clash Verge 控制接口地址无效", "not_configured")
  }

  if (
    baseUrl.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(baseUrl.hostname) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new ControllerError(
      "Clash Verge 控制接口必须使用本机 HTTP 回环地址",
      "not_configured"
    )
  }

  return { baseUrl, secret }
}

const parseFirstJsonObject = async (
  reader: ReadableStreamDefaultReader<Uint8Array>
) => {
  const decoder = new TextDecoder()
  let text = ""
  let depth = 0
  let inString = false
  let escaped = false
  let started = false
  let scannedLength = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    if (Buffer.byteLength(text) > MAX_STREAM_SAMPLE_BYTES) {
      await reader.cancel()
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
        await reader.cancel()
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

export const requestControllerJson = async (
  endpoint: ControllerEndpoint,
  signal?: AbortSignal
): Promise<unknown> => {
  const { baseUrl, secret } = controllerConfig()
  const url = new URL(
    endpoint,
    baseUrl.href.endsWith("/") ? baseUrl : `${baseUrl}/`
  )
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: requestSignal,
    })
  } catch {
    throw new ControllerError("Clash Verge 控制接口暂不可达", "unavailable")
  }

  if (response.status === 401 || response.status === 403) {
    throw new ControllerError("Clash Verge 控制接口认证失败", "unauthorized")
  }
  if (!response.ok) {
    throw new ControllerError("Clash Verge 控制接口返回错误", "unavailable")
  }

  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    throw new ControllerError(
      "Clash Verge 返回内容超出大小限制",
      "invalid_response"
    )
  }

  if (!response.body) {
    throw new ControllerError("Clash Verge 未返回数据", "invalid_response")
  }

  const reader = response.body.getReader()
  if (endpoint === "traffic") {
    try {
      return await parseFirstJsonObject(reader)
    } catch (error) {
      if (error instanceof ControllerError) throw error
      throw new ControllerError(
        "Clash Verge 返回了无效流量样本",
        "invalid_response"
      )
    } finally {
      reader.releaseLock()
    }
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_JSON_BYTES) {
        await reader.cancel()
        throw new ControllerError(
          "Clash Verge 返回内容超出大小限制",
          "invalid_response"
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  try {
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    if (error instanceof ControllerError) throw error
    throw new ControllerError("Clash Verge 返回了无效 JSON", "invalid_response")
  }
}

export const readControllerJson = requestControllerJson
export const connectionLimit = MAX_CONNECTIONS
