import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  applyServiceAction,
  mockServices,
  type LaunchService,
  type ServiceAction,
} from "@web/features/system-services/mock-data"

/**
 * 远程状态统一走 TanStack Query。
 *
 * 目前 queryFn / mutationFn 直接操作演示数据；接后端时只需把这里换成
 * `@shared/client-api` 的调用，页面与本地状态都不用动。
 */
export const systemServiceKeys = {
  list: ["system-services", "list"] as const,
}

const fetchServices = async (): Promise<LaunchService[]> => mockServices()

export const useServicesQuery = () =>
  useQuery({ queryKey: systemServiceKeys.list, queryFn: fetchServices })

export type ServiceActionInput = { label: string; action: ServiceAction }

/** 执行一次 launchctl 操作，并把结果写回列表缓存。 */
export const useServiceAction = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      label,
      action,
    }: ServiceActionInput): Promise<{
      label: string
      next: LaunchService
      message: string
    }> => {
      const list =
        queryClient.getQueryData<LaunchService[]>(systemServiceKeys.list) ?? []
      const target = list.find((service) => service.label === label)
      if (!target) {
        throw new Error(`找不到服务 ${label}`)
      }
      const { next, message } = applyServiceAction(target, action)
      return { label, next, message }
    },
    onSuccess: ({ label, next }) => {
      queryClient.setQueryData<LaunchService[]>(
        systemServiceKeys.list,
        (previous) =>
          previous
            ? previous.map((service) =>
                service.label === label ? next : service
              )
            : previous
      )
    },
  })
}
