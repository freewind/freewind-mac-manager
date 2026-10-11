import type {
  DockerContainer,
  DockerContainerState,
  DockerPortMapping,
} from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"

/** 容器运行态的中文说法；取值与契约里的 state 一一对应。 */
export const containerStateLabels: Record<DockerContainerState, string> = {
  created: "已创建",
  running: "运行中",
  paused: "已暂停",
  restarting: "重启中",
  removing: "删除中",
  exited: "已退出",
  dead: "已终止",
}

/** 界面能对单个容器执行的动作。 */
export type ContainerAction = "start" | "stop" | "restart" | "kill" | "remove"

export const containerActionLabels: Record<ContainerAction, string> = {
  start: "启动",
  stop: "停止",
  restart: "重启",
  kill: "终止",
  remove: "删除",
}

/** 动作进行中的按钮文案，避免用户重复点。 */
export const containerActionBusyLabels: Record<ContainerAction, string> = {
  start: "正在启动…",
  stop: "正在停止…",
  restart: "正在重启…",
  kill: "正在终止…",
  remove: "正在删除…",
}

/** 端口映射的可读文本；未发布到宿主机的端口只显示容器端口。 */
export const formatContainerPorts = (ports: DockerPortMapping[]): string => {
  if (ports.length === 0) return "无端口映射"
  return ports
    .map((port) =>
      port.hostPort === null
        ? `${port.containerPort}/${port.protocol}（未发布）`
        : `${port.hostIp || "0.0.0.0"}:${port.hostPort}→${port.containerPort}/${port.protocol}`
    )
    .join("、")
}

/** 最近一次启动时间；从没启动过就说明未启动，不显示 1970。 */
export const formatContainerStartedAt = (container: DockerContainer): string =>
  container.startedAt === null
    ? "未启动"
    : formatTimestamp(container.startedAt / 1000)
