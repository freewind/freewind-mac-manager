import { resetControllerTarget, resolveControllerTarget } from "./discovery"
import { ControllerError, requestJson } from "./transport"

export type { ControllerErrorKind } from "./transport"
export { ControllerError } from "./transport"

const MAX_CONNECTIONS = 200

export type ControllerEndpoint =
  | "version"
  | "configs"
  | "proxies"
  | "traffic"
  | "connections"

const ENDPOINT_PATHS: Record<ControllerEndpoint, string> = {
  version: "/version",
  configs: "/configs",
  proxies: "/proxies",
  traffic: "/traffic",
  connections: "/connections",
}

/**
 * 读一个控制接口端点。
 *
 * 目标地址由 discovery 决定（显式配置优先，其次自动发现），传输由 transport
 * 决定（回环 TCP 用 fetch，unix socket 用 node:http）；这里只负责把两者接起来，
 * 并在目标不可达时丢掉缓存，让下一次请求重新发现。
 */
export const requestControllerJson = async (
  endpoint: ControllerEndpoint,
  signal?: AbortSignal
): Promise<unknown> => {
  const target = await resolveControllerTarget()
  try {
    return await requestJson(target, ENDPOINT_PATHS[endpoint], {
      signal,
      streamFirstObject: endpoint === "traffic",
    })
  } catch (error) {
    if (error instanceof ControllerError && error.kind === "unavailable") {
      resetControllerTarget()
    }
    throw error
  }
}

export const readControllerJson = requestControllerJson
export const connectionLimit = MAX_CONNECTIONS
