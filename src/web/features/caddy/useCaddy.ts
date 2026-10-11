import {
  type CaddyApplyResult,
  type CaddyRule,
  type CaddyRuleInput,
  TASK_KINDS,
} from "@shared/api-contract"
import { applyCaddyConfig, restoreCaddyVersion } from "@shared/client-api"
import { describeError } from "@shared/format"
import { caddyConfigTaskTarget } from "@shared/task-targets"
import { useQueryClient } from "@tanstack/react-query"
import { registerTaskCompletion } from "@web/features/tasks/completion"
import { usePwaStatus } from "@web/hooks/use-pwa-status"
import { useTaskAction } from "@web/hooks/use-task-action"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { toCaddyRuleInput } from "./format"
import {
  caddyKeys,
  useCaddyRulesQuery,
  useCaddyVersionsQuery,
  useCreateCaddyRule,
  useDeleteCaddyRule,
  useImportCaddyRules,
  useUpdateCaddyRule,
} from "./queries"

/**
 * Caddy 页的数据与动作编排。
 *
 * - 远程状态全部归 TanStack Query（规则、状态、历史版本）
 * - 规则增删改与导入是快速本地写，直接 useMutation
 * - 应用与恢复会改真实配置文件，必须走 useTaskAction（受理不等于成功）
 * - 本页没有需要跨组件共享的本地状态，因此不建 store
 */
export const useCaddy = () => {
  const queryClient = useQueryClient()
  const { online } = usePwaStatus()
  const rulesQuery = useCaddyRulesQuery()
  const versionsQuery = useCaddyVersionsQuery()
  const createRule = useCreateCaddyRule()
  const updateRule = useUpdateCaddyRule()
  const deleteRule = useDeleteCaddyRule()
  const importRules = useImportCaddyRules()
  /** 表单里的持续失败原因（400/409）：留在对话框里，不用 toast 代替。 */
  const [formFailure, setFormFailure] = useState<string | null>(null)
  /** 列表动作的持续失败原因：显示在列表上方。 */
  const [actionFailure, setActionFailure] = useState<string | null>(null)

  const data = rulesQuery.data ?? null
  const currentSignature = data?.currentSignature ?? null

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: caddyKeys.rules }),
      queryClient.invalidateQueries({ queryKey: caddyKeys.versions }),
    ])
  }, [queryClient])

  // 任务在别处终结（受理后离开页面再回来）时也要把数据刷新回真实状态。
  useEffect(() => {
    registerTaskCompletion(TASK_KINDS.caddyConfigApply, async (task) => {
      if (task.status === "done") await invalidateAll()
    })
  }, [invalidateAll])

  const applyAction = useTaskAction<CaddyApplyResult, undefined>({
    kind: TASK_KINDS.caddyConfigApply,
    target: caddyConfigTaskTarget(),
    run: (requestId) =>
      applyCaddyConfig(requestId, {
        expectedSignature: currentSignature ?? "",
      }),
    onCompleted: async (result) => {
      await invalidateAll()
      toast.success(result.message)
    },
  })

  const restoreAction = useTaskAction<CaddyApplyResult, string>({
    kind: TASK_KINDS.caddyConfigApply,
    target: caddyConfigTaskTarget(),
    run: (requestId, versionId) => restoreCaddyVersion(requestId, versionId),
    onCompleted: async (result) => {
      await invalidateAll()
      toast.success(result.message)
    },
  })

  /** 新增规则：失败时把后端中文原因留在表单里。 */
  const create = async (input: CaddyRuleInput): Promise<boolean> => {
    setFormFailure(null)
    try {
      const rule = await createRule.mutateAsync(input)
      setActionFailure(null)
      toast.success(`已新增规则「${rule.name}」`)
      return true
    } catch (error) {
      setFormFailure(describeError(error))
      return false
    }
  }

  /** 修改规则：同样把 400/409 留在表单里。 */
  const update = async (
    id: string,
    input: CaddyRuleInput
  ): Promise<boolean> => {
    setFormFailure(null)
    try {
      const rule = await updateRule.mutateAsync({ id, rule: input })
      setActionFailure(null)
      toast.success(`已更新规则「${rule.name}」`)
      return true
    } catch (error) {
      setFormFailure(describeError(error))
      return false
    }
  }

  /** 启用 / 停用：只改 enabled，其余字段原样传回。 */
  const setEnabled = async (
    rule: CaddyRule,
    enabled: boolean
  ): Promise<boolean> => {
    setActionFailure(null)
    try {
      await updateRule.mutateAsync({
        id: rule.id,
        rule: toCaddyRuleInput(rule, { enabled }),
      })
      toast.success(
        enabled ? `已启用规则「${rule.name}」` : `已停用规则「${rule.name}」`
      )
      return true
    } catch (error) {
      setActionFailure(describeError(error))
      return false
    }
  }

  const remove = async (rule: CaddyRule): Promise<boolean> => {
    setActionFailure(null)
    try {
      await deleteRule.mutateAsync(rule.id)
      toast.success(`已删除规则「${rule.name}」`)
      return true
    } catch (error) {
      setActionFailure(describeError(error))
      return false
    }
  }

  /** 导入文件里尚未接管的规则：只写数据库，不改文件。 */
  const importExisting = async (): Promise<boolean> => {
    setActionFailure(null)
    try {
      const result = await importRules.mutateAsync()
      toast.success(
        `已导入 ${result.imported} 条规则；跳过 ${result.skipped} 条已存在的`
      )
      return true
    } catch (error) {
      setActionFailure(describeError(error))
      return false
    }
  }

  const refresh = async (): Promise<void> => {
    const [rules, versions] = await Promise.all([
      rulesQuery.refetch(),
      versionsQuery.refetch(),
    ])
    if (rules.isError || versions.isError) {
      toast.error("读取失败，请稍后再试")
      return
    }
    toast.info("已重新读取 Caddy 状态")
  }

  return {
    // 数据
    data,
    rules: data?.rules ?? [],
    externalRules: data?.externalRules ?? [],
    versions: versionsQuery.data?.versions ?? [],
    status: data?.status ?? null,
    changes: data?.changes ?? null,
    previewText: data?.previewText ?? "",
    writable: data?.writable ?? false,
    blockedReason: data?.blockedReason ?? null,
    hasUnappliedChanges: data?.hasUnappliedChanges ?? false,
    managedRegionDrifted: data?.managedRegionDrifted ?? false,
    unsupportedLines: data?.unsupportedLines ?? 0,
    unsupportedSamples: data?.unsupportedSamples ?? [],
    isLoading: rulesQuery.isLoading,
    isError: rulesQuery.isError,
    error: rulesQuery.isError ? describeError(rulesQuery.error) : null,
    isFetching: rulesQuery.isFetching || versionsQuery.isFetching,
    versionsLoading: versionsQuery.isLoading,
    versionsError: versionsQuery.isError
      ? describeError(versionsQuery.error)
      : null,
    online,

    // 持续展示的失败原因
    formFailure,
    clearFormFailure: (): void => setFormFailure(null),
    actionFailure,
    clearActionFailure: (): void => setActionFailure(null),

    // 规则动作
    create,
    update,
    setEnabled,
    remove,
    importExisting,
    refresh,

    // 应用与恢复
    apply: (): Promise<boolean> => applyAction.run(undefined),
    applyBusy: applyAction.busy,
    restore: (versionId: string): Promise<boolean> =>
      restoreAction.run(versionId),
    restoreBusy: restoreAction.busy,
    ruleBusy:
      createRule.isPending ||
      updateRule.isPending ||
      deleteRule.isPending ||
      importRules.isPending,
  }
}

export type CaddyPageModel = ReturnType<typeof useCaddy>
