import type { ServiceDomain, ServiceState } from "@shared/api-contract"

/** 域的展示名。 */
export const domainLabels: Record<ServiceDomain, string> = {
  user: "用户",
  global: "全局",
  system: "系统",
}

/** 状态的展示名。 */
export const stateLabels: Record<ServiceState, string> = {
  running: "运行中",
  stopped: "已停止",
  failed: "启动失败",
  disabled: "已禁用",
}
