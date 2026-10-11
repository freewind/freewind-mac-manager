import type { CaddyRuleInput } from "@shared/api-contract"
import {
  createCaddyRule as createCaddyRuleApi,
  deleteCaddyRule as deleteCaddyRuleApi,
  fetchCaddyRules,
  fetchCaddyVersions,
  importCaddyRules as importCaddyRulesApi,
  updateCaddyRule as updateCaddyRuleApi,
} from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

/**
 * Caddy 页的远程状态：规则与应用历史都走 TanStack Query。
 *
 * 规则增删改与导入是快速本地写（只改数据库），因此直接 useMutation；
 * 应用与恢复会改真实配置文件，必须走 useTaskAction（在 useCaddy 里）。
 */
export const caddyKeys = {
  rules: ["caddy", "rules"] as const,
  versions: ["caddy", "versions"] as const,
}

/** 状态、规则与预览来自同一次读取，5 秒内复用，不做无意义轮询。 */
export const useCaddyRulesQuery = () =>
  useQuery({
    queryKey: caddyKeys.rules,
    queryFn: () => fetchCaddyRules(),
    staleTime: 5000,
  })

export const useCaddyVersionsQuery = () =>
  useQuery({
    queryKey: caddyKeys.versions,
    queryFn: () => fetchCaddyVersions(),
    staleTime: 5000,
  })

/** 写入成功后等规则真正重新读取完再结束，界面不会显示过期数据。 */
const useInvalidateRules = () => {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: caddyKeys.rules })
}

export const useCreateCaddyRule = () => {
  const invalidate = useInvalidateRules()
  return useMutation({
    mutationFn: (input: CaddyRuleInput) => createCaddyRuleApi(input),
    onSuccess: async () => {
      await invalidate()
    },
  })
}

export const useUpdateCaddyRule = () => {
  const invalidate = useInvalidateRules()
  return useMutation({
    mutationFn: (input: { id: string; rule: CaddyRuleInput }) =>
      updateCaddyRuleApi(input.id, input.rule),
    onSuccess: async () => {
      await invalidate()
    },
  })
}

export const useDeleteCaddyRule = () => {
  const invalidate = useInvalidateRules()
  return useMutation({
    mutationFn: (id: string) => deleteCaddyRuleApi(id),
    onSuccess: async () => {
      await invalidate()
    },
  })
}

export const useImportCaddyRules = () => {
  const invalidate = useInvalidateRules()
  return useMutation({
    mutationFn: () => importCaddyRulesApi(),
    onSuccess: async () => {
      await invalidate()
    },
  })
}
