import type {
  ActionResponse,
  FrpConfig,
  FrpConfigInput,
  FrpProbe,
  FrpProbeBody,
} from "@shared/api-contract"
import { apiClient } from "./client"

const unwrap = <T>(result: { status: number; body: unknown }): T => {
  if (result.status >= 200 && result.status < 300) return result.body as T
  const body = result.body as { message?: string } | undefined
  throw new Error(body?.message ?? `请求失败（HTTP ${result.status}）`)
}

/** 读取 frpc 配置文件与 launchd 运行态。 */
export const fetchFrpConfig = async (): Promise<FrpConfig> =>
  unwrap<FrpConfig>(await apiClient.getFrpConfig())

/** 把整份配置写回 frpc 配置文件。 */
export const saveFrpConfig = async (
  input: FrpConfigInput
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.saveFrpConfig({ body: input }))

/** 探测某条隧道的远程端口是否可连接。 */
export const probeFrpProxy = async (
  input: FrpProbeBody
): Promise<FrpProbe> =>
  unwrap<FrpProbe>(await apiClient.probeFrpProxy({ body: input }))
