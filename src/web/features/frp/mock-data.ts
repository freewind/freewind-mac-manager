/**
 * FRP 内网穿透页面使用的演示数据。
 *
 * 字段与 `~/.config/frp/frpc-xianyu.toml` 一一对应：服务端连接信息 + 若干 [[proxies]]。
 * 目前 queryFn / mutationFn 直接操作这里的演示数据；接后端时只需把导出的异步函数
 * 换成 `@shared/client-api` 的调用，页面与本地状态都不用动。
 */

export type FrpProxyType = "tcp" | "udp" | "http" | "https"

export const FRP_PROXY_TYPES: FrpProxyType[] = ["tcp", "udp", "http", "https"]

/** 一条隧道，即 frpc 配置里的一段 [[proxies]]。 */
export type FrpProxy = {
  name: string
  type: FrpProxyType
  localIP: string
  localPort: number
  remotePort: number
}

/** frpc 服务端连接信息与运行环境。 */
export type FrpServer = {
  serverAddr: string
  serverPort: number
  authMethod: string
  authToken: string
  configPath: string
  binaryPath: string
  launchdLabel: string
  state: "running" | "stopped"
  pid: number | null
  startedAt: number | null
}

/** 页面持有的完整配置；savedSignature 表示磁盘上已保存内容的指纹。 */
export type FrpConfig = {
  server: FrpServer
  proxies: FrpProxy[]
  savedSignature: string
}

/** 一次连通性探测的结果。 */
export type FrpProbe = {
  reachable: boolean
  latencyMs: number
  message: string
  checkedAt: number
}

const MOCK_SERVER: FrpServer = {
  serverAddr: "hm.wwszxc.tax",
  serverPort: 34080,
  authMethod: "token",
  authToken: "325270",
  configPath: "/Users/peng.li/.config/frp/frpc-xianyu.toml",
  binaryPath: "/Users/peng.li/.local/bin/frpc",
  launchdLabel: "com.pengli.frpc-xianyu",
  state: "running",
  pid: 41892,
  startedAt: Math.floor(Date.now() / 1000) - 3600,
}

const MOCK_PROXIES: FrpProxy[] = [
  {
    name: "mac-xianyu-34085",
    type: "tcp",
    localIP: "127.0.0.1",
    localPort: 8443,
    remotePort: 34085,
  },
  {
    name: "mac-xianyu-34082",
    type: "tcp",
    localIP: "127.0.0.1",
    localPort: 6767,
    remotePort: 34082,
  },
]

/**
 * 只覆盖会被写进配置文件的字段，用于判断「是否有未保存的改动」。
 * 运行态字段（pid / state / startedAt）不参与比对。
 */
export const configSignature = (config: {
  server: FrpServer
  proxies: FrpProxy[]
}): string =>
  JSON.stringify({
    serverAddr: config.server.serverAddr,
    serverPort: config.server.serverPort,
    authMethod: config.server.authMethod,
    authToken: config.server.authToken,
    proxies: config.proxies,
  })

/** 把内存里的配置渲染成 frpc 的 TOML 文本，用于预览与保存。 */
export const serializeFrpcToml = (config: {
  server: FrpServer
  proxies: FrpProxy[]
}): string => {
  const { server, proxies } = config
  const lines = [
    `serverAddr = "${server.serverAddr}"`,
    `serverPort = ${server.serverPort}`,
    `auth.method = "${server.authMethod}"`,
    `auth.token = "${server.authToken}"`,
  ]
  for (const proxy of proxies) {
    lines.push(
      "",
      "[[proxies]]",
      `name = "${proxy.name}"`,
      `type = "${proxy.type}"`,
      `localIP = "${proxy.localIP}"`,
      `localPort = ${proxy.localPort}`,
      `remotePort = ${proxy.remotePort}`
    )
  }
  return `${lines.join("\n")}\n`
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const freshConfig = (): FrpConfig => {
  const base = { server: MOCK_SERVER, proxies: MOCK_PROXIES }
  return { ...base, savedSignature: configSignature(base) }
}

/** 读取 frpc 配置。 */
export const fetchFrpConfig = async (): Promise<FrpConfig> => freshConfig()

/** 保存配置到 frpc 配置文件；演示模式只返回结果说明。 */
export const saveFrpcConfig = async (config: {
  server: FrpServer
  proxies: FrpProxy[]
}): Promise<{ message: string }> => {
  await delay(400)
  return {
    message: `已写入 ${MOCK_SERVER.configPath}（${config.proxies.length} 条隧道）`,
  }
}

/** 探测一条隧道：连服务端的 remotePort 是否通。 */
export const probeFrpProxy = async (proxy: FrpProxy): Promise<FrpProbe> => {
  await delay(300 + Math.random() * 500)
  const reachable = Math.random() > 0.25
  return {
    reachable,
    latencyMs: reachable ? Math.round(20 + Math.random() * 120) : 0,
    message: reachable
      ? `${MOCK_SERVER.serverAddr}:${proxy.remotePort} 可连接`
      : `${MOCK_SERVER.serverAddr}:${proxy.remotePort} 连接超时`,
    checkedAt: Math.floor(Date.now() / 1000),
  }
}
