import type { ServiceDomain } from "@shared/api-contract"
import {
  fetchSystemServices,
  loadSystemService,
  restartSystemService,
  setSystemServiceEnabled,
  startSystemService,
  stopSystemService,
  uninstallSystemService,
} from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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

const callAction = (
  input: ServiceActionInput
): Promise<{ message: string }> => {
  const target = { label: input.label, domain: input.domain }
  switch (input.action) {
    case "start":
      return startSystemService(target)
    case "stop":
      return stopSystemService(target)
    case "restart":
      return restartSystemService(target)
    case "load":
      return loadSystemService(target)
    case "unload":
      return uninstallSystemService(target)
    case "disable":
      return setSystemServiceEnabled({ ...target, disabled: true })
    case "enable":
      return setSystemServiceEnabled({ ...target, disabled: false })
  }
}

/** 执行一次 launchctl 操作，成功后让列表重新拉取真实状态。 */
export const useServiceAction = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: callAction,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: systemServiceKeys.list }),
  })
}
