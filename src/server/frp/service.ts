import net from "node:net"
import type {
  FrpConfig,
  FrpConfigInput,
  FrpProbe,
  FrpProbeBody,
  FrpServer,
} from "@shared/api-contract"
import { configSignature, parseFrpcConfig } from "@shared/frp-format"
import { readConfigText, writeConfigText } from "./config-file"
import { LAUNCHD_LABEL, readProgram, readRuntime } from "./launchd"

/** 探测超时：连不通时不能让页面一直转。 */
const PROBE_TIMEOUT_MS = 3000

/** 读配置：真实文件内容 + launchd 里的运行状态。 */
export const readFrpConfig = async (): Promise<FrpConfig> => {
  const { binaryPath, configPath } = await readProgram()
  const [text, runtime] = await Promise.all([
    readConfigText(configPath),
    readRuntime(),
  ])
  const persisted = parseFrpcConfig(text)
  const server: FrpServer = {
    ...persisted.server,
    configPath,
    binaryPath,
    launchdLabel: LAUNCHD_LABEL,
    ...runtime,
  }
  return {
    server,
    proxies: persisted.proxies,
    savedSignature: configSignature(persisted),
  }
}

/** 写配置：写回后 frpc 需重载才会生效，这里只负责落盘。 */
export const saveFrpConfig = async (input: FrpConfigInput): Promise<string> => {
  const { configPath } = await readProgram()
  const original = await readConfigText(configPath)
  await writeConfigText(configPath, input, original)
  return `已写入 ${configPath}（${input.proxies.length} 条隧道）`
}

/** 探测一条隧道：由服务端发起 TCP 连接，浏览器建不了裸连接。 */
export const probeFrpProxy = (target: FrpProbeBody): Promise<FrpProbe> =>
  new Promise((resolve) => {
    const address = `${target.serverAddr}:${target.remotePort}`
    const startedAt = Date.now()
    const socket = net.connect({
      host: target.serverAddr,
      port: target.remotePort,
    })
    let settled = false
    const finish = (reachable: boolean, message: string): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({
        reachable,
        latencyMs: reachable ? Date.now() - startedAt : 0,
        message,
        checkedAt: Math.floor(Date.now() / 1000),
      })
    }

    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once("connect", () => finish(true, `${address} 可连接`))
    socket.once("timeout", () =>
      finish(false, `${address} 连接超时（${PROBE_TIMEOUT_MS / 1000} 秒）`)
    )
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish(false, `${address} ${error.code ?? error.message}`)
    )
  })
