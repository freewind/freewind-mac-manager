import { type ActionResponse, TASK_KINDS } from "@shared/api-contract"
import { serviceTaskTarget } from "@shared/task-targets"
import { z } from "zod"
import {
  loadService,
  restartService,
  revealService,
  setServiceEnabled,
  startService,
  stopService,
  uninstallService,
} from "./service"

export const SERVICE_ACTION_KIND = TASK_KINDS.serviceAction

export type ServiceActionName =
  | "start"
  | "stop"
  | "restart"
  | "load"
  | "unload"
  | "enable"
  | "disable"
  | "reveal"

/**
 * 执行器入参：只接受动作名与服务标识，不接受命令、参数或 shell 片段；
 * 真正的 launchctl 调用由服务层按固定参数拼装。
 */
export const ServiceActionPayloadSchema = z.object({
  action: z.enum([
    "start",
    "stop",
    "restart",
    "load",
    "unload",
    "enable",
    "disable",
    "reveal",
  ]),
  label: z.string().min(1),
  domain: z.enum(["user", "global", "system"]),
})

/** 同域同 label 的服务同一时刻只做一个动作。 */
export const serviceTargetOf = (domain: string, label: string): string =>
  serviceTaskTarget(domain, label)

const runAction = async (payload: {
  action: ServiceActionName
  label: string
  domain: "user" | "global" | "system"
}): Promise<string> => {
  const target = { label: payload.label, domain: payload.domain }
  switch (payload.action) {
    case "start":
      return startService(target)
    case "stop":
      return stopService(target)
    case "restart":
      return restartService(target)
    case "load":
      return loadService(target)
    case "unload":
      return uninstallService(target)
    case "enable":
      return setServiceEnabled({ ...target, disabled: false })
    case "disable":
      return setServiceEnabled({ ...target, disabled: true })
    case "reveal":
      return revealService(target)
  }
}

export const runServiceActionTask = async (options: {
  payload: unknown
  report: (progress: {
    done: number
    total: number | null
    bytesDone: number | null
    bytesTotal: number | null
    stage: string
    currentTarget: string | null
  }) => void
}): Promise<{ result: ActionResponse; message: string }> => {
  const parsed = ServiceActionPayloadSchema.safeParse(options.payload)
  if (!parsed.success) throw new Error("系统服务动作载荷非法")
  const { action, label, domain } = parsed.data
  options.report({
    done: 0,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: `${label}：${action}`,
    currentTarget: label,
  })
  // 命令成功只代表命令执行完了；是否真的运行/停止了，由列表重新读取来确认。
  const message = await runAction({ action, label, domain })
  options.report({
    done: 1,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: "完成",
    currentTarget: null,
  })
  return { result: { message }, message }
}
