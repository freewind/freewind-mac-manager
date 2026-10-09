import {
  FRP_PROXY_TYPES,
  type FrpConfigInput,
  type FrpProxy,
  type FrpProxyType,
  type FrpServer,
} from "@shared/api-contract"
import { parse, stringify } from "smol-toml"

/**
 * frpc 配置文本的解析与序列化。
 *
 * 前后端共用同一份实现：页面预览与真正写盘的内容由同一函数产出，不会各写一套而漂移。
 */

/** 会被写进配置文件的字段；pid / state 等运行态不参与比对。 */
export type FrpPersistedConfig = {
  server: Pick<
    FrpServer,
    "serverAddr" | "serverPort" | "authMethod" | "authToken"
  >
  proxies: FrpProxy[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asText = (value: unknown): string =>
  typeof value === "string" ? value : ""

const asInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null

/** 只覆盖会写进文件的字段，用于判断「是否有未保存的改动」。 */
export const configSignature = (config: FrpPersistedConfig): string =>
  JSON.stringify({
    serverAddr: config.server.serverAddr,
    serverPort: config.server.serverPort,
    authMethod: config.server.authMethod,
    authToken: config.server.authToken,
    proxies: config.proxies,
  })

const toProxy = (value: unknown, index: number): FrpProxy => {
  const label = `第 ${index + 1} 条 [[proxies]]`
  if (!isRecord(value)) throw new Error(`${label} 不是 TOML 表`)
  const name = asText(value.name)
  if (!name) throw new Error(`${label} 缺少 name`)
  const type = asText(value.type) as FrpProxyType
  if (!FRP_PROXY_TYPES.includes(type)) {
    throw new Error(
      `${label}（${name}）的 type 不是 ${FRP_PROXY_TYPES.join(" / ")}`
    )
  }
  const localPort = asInteger(value.localPort)
  const remotePort = asInteger(value.remotePort)
  if (localPort === null || remotePort === null) {
    throw new Error(`${label}（${name}）的 localPort / remotePort 必须是整数`)
  }
  return {
    name,
    type,
    localIP: asText(value.localIP) || "127.0.0.1",
    localPort,
    remotePort,
  }
}

/**
 * 解析 frpc 配置文本。
 * 读不懂的段落直接报错，不静默跳过：跳过会在下一次保存时把它从文件里删掉。
 */
export const parseFrpcConfig = (text: string): FrpConfigInput => {
  let document: unknown
  try {
    document = parse(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`frpc 配置不是合法的 TOML：${reason}`, { cause: error })
  }
  if (!isRecord(document)) throw new Error("frpc 配置不是 TOML 表")

  const serverAddr = asText(document.serverAddr)
  if (!serverAddr) throw new Error("frpc 配置缺少 serverAddr")
  const serverPort = asInteger(document.serverPort)
  if (serverPort === null) throw new Error("frpc 配置缺少 serverPort")
  const auth = isRecord(document.auth) ? document.auth : {}

  return {
    server: {
      serverAddr,
      serverPort,
      authMethod: asText(auth.method) || "token",
      authToken: asText(auth.token),
    },
    proxies: (Array.isArray(document.proxies) ? document.proxies : []).map(
      toProxy
    ),
  }
}

type FrpcDocument = {
  serverAddr: string
  serverPort: number
  auth: { method: string; token: string }
  proxies: FrpProxy[]
}

/** 建模字段构成的 TOML 文档对象。 */
const toDocument = (input: FrpConfigInput): FrpcDocument => ({
  serverAddr: input.server.serverAddr,
  serverPort: input.server.serverPort,
  auth: { method: input.server.authMethod, token: input.server.authToken },
  proxies: input.proxies.map((proxy) => ({ ...proxy })),
})

/**
 * 序列化成 frpc 的 TOML 文本。
 * 传入磁盘上的原文档做底时，未建模的键会原样保留；不传则只输出建模字段。
 */
export const serializeFrpcToml = (
  input: FrpConfigInput,
  base?: Record<string, unknown>
): string => {
  const document = toDocument(input)
  if (!base) return stringify(document)

  const previous = (Array.isArray(base.proxies) ? base.proxies : []).filter(
    isRecord
  )
  return stringify({
    ...base,
    ...document,
    auth: { ...(isRecord(base.auth) ? base.auth : {}), ...document.auth },
    proxies: document.proxies.map((proxy) => ({
      ...(previous.find((item) => item.name === proxy.name) ?? {}),
      ...proxy,
    })),
  })
}
