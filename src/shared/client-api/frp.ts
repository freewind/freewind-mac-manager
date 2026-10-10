import type {
  ActionResponse,
  FrpConfig,
  FrpConfigInput,
  FrpProbe,
  FrpProbeBody,
} from "@shared/api-contract"
import { apiClient, taskRequestHeaders, unwrap } from "./client"
import { type Execution, runExecution } from "./execution"

/** 读取 frpc 配置文件与 launchd 运行态。 */
export const fetchFrpConfig = async (): Promise<FrpConfig> =>
  unwrap<FrpConfig>(await apiClient.getFrpConfig())

/** 把整份配置写回 frpc 配置文件。 */
/** 保存配置同样是写操作：请求标识由服务端用来复用任务。 */
export const saveFrpConfig = async (
  requestId: string,
  input: FrpConfigInput
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.saveFrpConfig({
      body: input,
      headers: taskRequestHeaders(requestId),
    })
  )

/** 探测某条隧道的远程端口是否可连接。 */
export const probeFrpProxy = async (input: FrpProbeBody): Promise<FrpProbe> =>
  unwrap<FrpProbe>(await apiClient.probeFrpProxy({ body: input }))
