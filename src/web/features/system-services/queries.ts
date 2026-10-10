import type { ActionResponse, ServiceDomain } from "@shared/api-contract"
import type { Execution } from "@shared/client-api"
import {
  fetchSystemServices,
  loadSystemService,
  restartSystemService,
  setSystemServiceEnabled,
  startSystemService,
  stopSystemService,
  uninstallSystemService,
} from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"
import type { ServiceAction } from "@web/features/system-services/actions"

/** 远程状态统一走 TanStack Query，数据来源是后端 /api/system-services。 */
export const systemServiceKeys = {
  list: ["system-services", "list"] as const,
}

export const useServicesQuery = () =>
  useQuery({
    queryKey: systemServiceKeys.list,
    queryFn: fetchSystemServices,
  })

export type ServiceActionInput = {
  label: string
  domain: ServiceDomain
  action: ServiceAction
}

/**
 * 发起一次 launchctl 动作：请求标识由动作编排生成，服务端据此复用任务。
 * 完成只代表命令执行完，真实状态由列表重新读取确认。
 */
export const callServiceAction = (
  requestId: string,
  input: ServiceActionInput
): Promise<Execution<ActionResponse>> => {
  const target = { label: input.label, domain: input.domain }
  switch (input.action) {
    case "start":
      return startSystemService(requestId, target)
    case "stop":
      return stopSystemService(requestId, target)
    case "restart":
      return restartSystemService(requestId, target)
    case "load":
      return loadSystemService(requestId, target)
    case "unload":
      return uninstallSystemService(requestId, target)
    case "disable":
      return setSystemServiceEnabled(requestId, { ...target, disabled: true })
    case "enable":
      return setSystemServiceEnabled(requestId, { ...target, disabled: false })
  }
}
