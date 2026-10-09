const HOME = "/Users/peng.li"

/** 服务所属的 launchd 域。 */
export type ServiceDomain = "user" | "global" | "system"

export type ServiceState = "running" | "stopped" | "failed" | "disabled"

export type LaunchService = {
  label: string
  domain: ServiceDomain
  /** plist 文件的绝对路径 */
  filePath: string
  /** plist 文件是否还在原处（卸载后为 false） */
  exists: boolean
  /** 是否已 bootstrap 到域中 */
  loaded: boolean
  /** 是否被 launchctl disable */
  disabled: boolean
  state: ServiceState
  pid: number | null
  /** 上一次退出码，运行中为 null */
  lastExitCode: number | null
  /** 本次启动时间（秒） */
  startedAt: number | null
  program: string
  args: string[]
  runAtLoad: boolean
  keepAlive: boolean
  startInterval: number | null
  workingDirectory: string | null
  stdoutPath: string | null
  stderrPath: string | null
  environment: Record<string, string>
  processType: string | null
  throttleInterval: number | null
  /** 位于系统目录、需要 root 才能改动的服务 */
  requiresRoot: boolean
  /** plist 原文 */
  plist: string
  /** 界面上最近一次操作的结果说明 */
  lastAction: string | null
}

type PlistSpec = {
  label: string
  program: string
  args: string[]
  runAtLoad: boolean
  keepAlive: boolean
  startInterval: number | null
  workingDirectory: string | null
  stdoutPath: string | null
  stderrPath: string | null
  environment: Record<string, string>
  processType: string | null
  throttleInterval: number | null
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** 生成一份格式完整的 plist 原文。 */
const plistText = (spec: PlistSpec): string => {
  const body: string[] = [
    "\t<key>Label</key>",
    `\t<string>${escapeXml(spec.label)}</string>`,
    "\t<key>ProgramArguments</key>",
    "\t<array>",
  ]
  for (const argument of [spec.program, ...spec.args]) {
    body.push(`\t\t<string>${escapeXml(argument)}</string>`)
  }
  body.push("\t</array>")
  body.push("\t<key>RunAtLoad</key>", `\t<${spec.runAtLoad}/>`)
  body.push("\t<key>KeepAlive</key>", `\t<${spec.keepAlive}/>`)
  if (spec.processType !== null) {
    body.push(
      "\t<key>ProcessType</key>",
      `\t<string>${spec.processType}</string>`
    )
  }
  if (spec.startInterval !== null) {
    body.push(
      "\t<key>StartInterval</key>",
      `\t<integer>${spec.startInterval}</integer>`
    )
  }
  if (spec.throttleInterval !== null) {
    body.push(
      "\t<key>ThrottleInterval</key>",
      `\t<integer>${spec.throttleInterval}</integer>`
    )
  }
  if (spec.workingDirectory !== null) {
    body.push(
      "\t<key>WorkingDirectory</key>",
      `\t<string>${escapeXml(spec.workingDirectory)}</string>`
    )
  }
  const environmentKeys = Object.keys(spec.environment)
  if (environmentKeys.length > 0) {
    body.push("\t<key>EnvironmentVariables</key>", "\t<dict>")
    for (const key of environmentKeys) {
      body.push(
        `\t\t<key>${escapeXml(key)}</key>`,
        `\t\t<string>${escapeXml(spec.environment[key])}</string>`
      )
    }
    body.push("\t</dict>")
  }
  if (spec.stdoutPath !== null) {
    body.push(
      "\t<key>StandardOutPath</key>",
      `\t<string>${escapeXml(spec.stdoutPath)}</string>`
    )
  }
  if (spec.stderrPath !== null) {
    body.push(
      "\t<key>StandardErrorPath</key>",
      `\t<string>${escapeXml(spec.stderrPath)}</string>`
    )
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    ...body,
    "</dict>",
    "</plist>",
    "",
  ].join("\n")
}

type ServiceSpec = PlistSpec & {
  /** plist 所在目录；domain 由它和 requiresRoot 推出 */
  directory: string
  requiresRoot: boolean
  running: boolean
  failed?: boolean
  disabled?: boolean
  loaded: boolean
  pid?: number
  startedAt?: number
  lastExitCode?: number | null
}

const BASE_TIME = 1_791_543_600

const service = (spec: ServiceSpec): LaunchService => {
  const domain: ServiceDomain = spec.directory.includes("/LaunchDaemons")
    ? "system"
    : spec.directory.startsWith("/Library")
      ? "global"
      : "user"
  const state: ServiceState = spec.disabled
    ? "disabled"
    : spec.running
      ? "running"
      : spec.failed
        ? "failed"
        : "stopped"
  return {
    label: spec.label,
    domain,
    filePath: `${spec.directory}/${spec.label}.plist`,
    exists: true,
    loaded: spec.loaded,
    disabled: spec.disabled ?? false,
    state,
    pid: spec.running ? (spec.pid ?? null) : null,
    lastExitCode: spec.running ? null : (spec.lastExitCode ?? null),
    startedAt: spec.running ? (spec.startedAt ?? BASE_TIME) : null,
    program: spec.program,
    args: spec.args,
    runAtLoad: spec.runAtLoad,
    keepAlive: spec.keepAlive,
    startInterval: spec.startInterval,
    workingDirectory: spec.workingDirectory,
    stdoutPath: spec.stdoutPath,
    stderrPath: spec.stderrPath,
    environment: spec.environment,
    processType: spec.processType,
    throttleInterval: spec.throttleInterval,
    requiresRoot: spec.requiresRoot,
    plist: plistText(spec),
    lastAction: null,
  }
}

const USER_AGENTS = `${HOME}/Library/LaunchAgents`
const LOCAL_AGENTS = "/Library/LaunchAgents"
const LOCAL_DAEMONS = "/Library/LaunchDaemons"
const LOGS = `${HOME}/Library/Logs/freewind`

export const mockServices = (): LaunchService[] => [
  service({
    label: "com.freewind.caddy",
    directory: USER_AGENTS,
    requiresRoot: false,
    program: "/opt/homebrew/bin/caddy",
    args: ["run", "--config", `${HOME}/.config/caddy/Caddyfile`],
    runAtLoad: true,
    keepAlive: true,
    processType: "Background",
    startInterval: null,
    throttleInterval: 10,
    workingDirectory: `${HOME}/.config/caddy`,
    stdoutPath: `${LOGS}/caddy.log`,
    stderrPath: `${LOGS}/caddy.err.log`,
    environment: { HOME, PATH: "/opt/homebrew/bin:/usr/bin:/bin" },
    loaded: true,
    running: true,
    pid: 412,
    startedAt: BASE_TIME - 86_400,
  }),
  service({
    label: "com.paseo-daemon",
    directory: USER_AGENTS,
    requiresRoot: false,
    program: `${HOME}/.paseo/bin/paseo-daemon`,
    args: ["--config", `${HOME}/.paseo/config.json`],
    runAtLoad: true,
    keepAlive: true,
    processType: "Interactive",
    startInterval: null,
    throttleInterval: null,
    workingDirectory: HOME,
    stdoutPath: `${LOGS}/paseo-daemon.log`,
    stderrPath: `${LOGS}/paseo-daemon.err.log`,
    environment: { HOME, PASEO_DAEMON_PORT: "7777" },
    loaded: true,
    running: true,
    pid: 1088,
    startedAt: BASE_TIME - 2 * 86_400,
  }),
  service({
    label: "com.freewind.traffic-monitor",
    directory: USER_AGENTS,
    requiresRoot: false,
    program: "/opt/homebrew/bin/node",
    args: [
      `${HOME}/workspace/freewind-remote-shell/scripts/traffic-monitor.mjs`,
    ],
    runAtLoad: true,
    keepAlive: false,
    processType: "Background",
    startInterval: 300,
    throttleInterval: null,
    workingDirectory: `${HOME}/workspace/freewind-remote-shell`,
    stdoutPath: `${LOGS}/traffic-monitor.log`,
    stderrPath: `${LOGS}/traffic-monitor.err.log`,
    environment: { HOME, NODE_ENV: "production" },
    loaded: true,
    running: true,
    pid: 5120,
    startedAt: BASE_TIME - 1_800,
  }),
  service({
    label: "com.pengli.frpc-xianyu",
    directory: USER_AGENTS,
    requiresRoot: false,
    program: "/opt/homebrew/bin/frpc",
    args: ["-c", `${HOME}/.config/frp/frpc-xianyu.toml`],
    runAtLoad: true,
    keepAlive: true,
    processType: null,
    startInterval: null,
    throttleInterval: 5,
    workingDirectory: `${HOME}/.config/frp`,
    stdoutPath: `${LOGS}/frpc-xianyu.log`,
    stderrPath: `${LOGS}/frpc-xianyu.err.log`,
    environment: { HOME },
    loaded: true,
    running: true,
    pid: 3390,
    startedAt: BASE_TIME - 3 * 86_400,
  }),
  service({
    label: "com.freewind.droid2api",
    directory: USER_AGENTS,
    requiresRoot: false,
    program: "/opt/homebrew/bin/node",
    args: [`${HOME}/workspace/freewind-agent-hub/dist/server.js`],
    runAtLoad: true,
    keepAlive: false,
    processType: "Background",
    startInterval: null,
    throttleInterval: null,
    workingDirectory: `${HOME}/workspace/freewind-agent-hub`,
    stdoutPath: `${LOGS}/droid2api.log`,
    stderrPath: `${LOGS}/droid2api.err.log`,
    environment: { HOME, PORT: "8787" },
    loaded: true,
    running: false,
    lastExitCode: 0,
  }),
  service({
    label: "ai.openclaw.gateway",
    directory: USER_AGENTS,
    requiresRoot: false,
    program: "/opt/homebrew/bin/openclaw",
    args: ["gateway", "--config", `${HOME}/.openclaw/config.toml`],
    runAtLoad: true,
    keepAlive: false,
    processType: "Background",
    startInterval: null,
    throttleInterval: 30,
    workingDirectory: `${HOME}/.openclaw`,
    stdoutPath: `${LOGS}/openclaw-gateway.log`,
    stderrPath: `${LOGS}/openclaw-gateway.err.log`,
    environment: { HOME, OPENCLAW_HOME: `${HOME}/.openclaw` },
    loaded: true,
    running: false,
    failed: true,
    lastExitCode: 78,
  }),
  service({
    label: "com.freewind.desktop-uploader",
    directory: USER_AGENTS,
    requiresRoot: false,
    program: "/usr/local/bin/desktop-uploader",
    args: ["watch", `${HOME}/Desktop`],
    runAtLoad: false,
    keepAlive: false,
    processType: null,
    startInterval: null,
    throttleInterval: null,
    workingDirectory: HOME,
    stdoutPath: null,
    stderrPath: null,
    environment: { HOME },
    loaded: false,
    running: false,
    disabled: true,
  }),
  service({
    label: "com.netease.uuremote.agent",
    directory: LOCAL_AGENTS,
    requiresRoot: true,
    program: "/Applications/UURemote.app/Contents/MacOS/UURemoteAgent",
    args: ["--run-mode=agent"],
    runAtLoad: true,
    keepAlive: true,
    processType: "Interactive",
    startInterval: null,
    throttleInterval: null,
    workingDirectory: "/Applications/UURemote.app/Contents/MacOS",
    stdoutPath: null,
    stderrPath: null,
    environment: {},
    loaded: true,
    running: true,
    pid: 1650,
    startedAt: BASE_TIME - 5 * 86_400,
  }),
  service({
    label: "com.proxyman.NSProxy.HelperTool",
    directory: LOCAL_DAEMONS,
    requiresRoot: true,
    program: "/Applications/Proxyman.app/Contents/MacOS/ProxymanHelperTool",
    args: [],
    runAtLoad: true,
    keepAlive: true,
    processType: "Interactive",
    startInterval: null,
    throttleInterval: null,
    workingDirectory: "/",
    stdoutPath: null,
    stderrPath: null,
    environment: {},
    loaded: true,
    running: true,
    pid: 208,
    startedAt: BASE_TIME - 9 * 86_400,
  }),
  service({
    label: "com.freewind.smart-proxy",
    directory: LOCAL_DAEMONS,
    requiresRoot: true,
    program: "/usr/local/bin/smart-proxy",
    args: ["--listen", "127.0.0.1:17890"],
    runAtLoad: true,
    keepAlive: true,
    processType: "Background",
    startInterval: null,
    throttleInterval: 10,
    workingDirectory: "/usr/local/var/smart-proxy",
    stdoutPath: "/Library/Logs/smart-proxy.log",
    stderrPath: "/Library/Logs/smart-proxy.err.log",
    environment: {},
    loaded: true,
    running: false,
    failed: true,
    lastExitCode: 1,
  }),
]

export const isMockMode = (): boolean => true

/** 界面上三档筛选用的域标签。 */
export const domainLabels: Record<ServiceDomain, string> = {
  user: "用户",
  global: "全局",
  system: "系统",
}

export const stateLabels: Record<ServiceState, string> = {
  running: "运行中",
  stopped: "已停止",
  failed: "启动失败",
  disabled: "已禁用",
}

export type ServiceAction =
  "start" | "stop" | "restart" | "load" | "unload" | "disable" | "enable"

let pidSeed = 7200

const nextPid = (): number => {
  pidSeed += 1
  return pidSeed
}

/**
 * 计算某个操作执行后该服务的新状态，以及给界面的反馈文案。
 * 纯函数，供 TanStack Query 的 mutation 调用。
 */
export const applyServiceAction = (
  target: LaunchService,
  action: ServiceAction
): { next: LaunchService; message: string } => {
  const stamp = Math.round(Date.now() / 1000)
  if (action === "start" || action === "restart" || action === "load") {
    const pid = nextPid()
    const verb =
      action === "start"
        ? "已启动"
        : action === "restart"
          ? "已重启"
          : "已加载并启动"
    return {
      next: {
        ...target,
        exists: true,
        loaded: true,
        disabled: false,
        state: "running",
        pid,
        lastExitCode: null,
        startedAt: stamp,
        lastAction: `${verb}（pid ${pid}）`,
      },
      message: `${verb} ${target.label}，pid ${pid}`,
    }
  }
  if (action === "stop") {
    return {
      next: {
        ...target,
        state: "stopped",
        pid: null,
        lastExitCode: 0,
        startedAt: null,
        lastAction: "已停止（退出码 0）",
      },
      message: `已停止 ${target.label}`,
    }
  }
  if (action === "unload") {
    return {
      next: {
        ...target,
        exists: false,
        loaded: false,
        state: "stopped",
        pid: null,
        lastExitCode: 0,
        startedAt: null,
        lastAction: "已卸载，plist 已移入废纸篓",
      },
      message: `已卸载 ${target.label}：停止运行，plist 已移入废纸篓`,
    }
  }
  if (action === "disable") {
    return {
      next: {
        ...target,
        disabled: true,
        state: "disabled",
        pid: null,
        lastExitCode: 0,
        startedAt: null,
        lastAction: "已禁用，开机不再自动启动",
      },
      message: `已禁用 ${target.label}，开机不再自动启动`,
    }
  }
  return {
    next: {
      ...target,
      disabled: false,
      state: "stopped",
      pid: null,
      lastExitCode: null,
      startedAt: null,
      lastAction: "已启用，等下次登录或手动启动",
    },
    message: `已启用 ${target.label}`,
  }
}
