import {
  addPiProvider,
  deletePiProvider,
  fetchPiProviderApiKey,
  unwrap,
  updatePiProvider,
} from "@shared/client-api"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  asRecord,
  type ModelDraft,
  optionalNumber,
  type ProviderDraft,
  parseModelJson,
  parseThinkingLevelMap,
} from "./provider-drafts"
import { piKeys, type usePiModels } from "./queries"
import type { ProviderEntry } from "./types"

export type PiProviderActionsInput = {
  /** models 查询的当前结果：mutation 需要最新 providers 与 signature。 */
  query: ReturnType<typeof usePiModels>
  /** Provider 表单草稿；null 表示弹窗关闭。 */
  draft: ProviderDraft | null
  /** 非空表示在编辑该 provider。 */
  editingId: string | null
  /** provider 保存成功后由页面关闭弹窗并复位编辑态。 */
  onProviderFormClosed: () => void
  /** provider 删除成功后由页面关闭确认弹窗。 */
  onProviderDeleted: () => void
  /** 模型删除成功后由页面关闭确认弹窗。 */
  onModelDeleted: () => void
  /** 模型保存成功后由页面关闭弹窗。 */
  onModelFormClosed: () => void
}

/**
 * Pi 页 Provider/模型域的全部写动作：新增/编辑/删除 provider、增删改模型、
 * 复制 provider 与复制密钥/模型 JSON。页面只消费这里的动作，不再散落 mutation。
 */
export const usePiProviderActions = (input: PiProviderActionsInput) => {
  const queryClient = useQueryClient()
  const { query } = input
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: piKeys.all })

  const save = useMutation({
    mutationFn: async () => {
      const { draft, editingId } = input
      if (!draft || !query.data) throw new Error("请先加载配置")
      const existing = editingId
        ? query.data.providers.find((item) => item.id === editingId)?.provider
        : undefined
      /** 编辑不改模型列表：模型在卡片上逐条增删，避免整段 JSON 被误改。 */
      let models = existing?.models
      if (editingId === null) {
        let parsed: unknown
        try {
          parsed = JSON.parse(draft.modelsJson)
        } catch {
          throw new Error("模型列表不是有效 JSON")
        }
        if (!Array.isArray(parsed)) throw new Error("模型列表必须是 JSON 数组")
        models = parsed as typeof models
      }
      if (models === undefined) throw new Error("请先刷新配置后重试")
      const provider = {
        ...asRecord(existing),
        name: draft.name,
        baseUrl: draft.baseUrl,
        api: draft.api,
        models,
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      }
      const payload = {
        providerId: draft.providerId,
        signature: query.data.signature,
        clearApiKey: draft.clearApiKey,
        provider,
      }
      return editingId
        ? updatePiProvider(editingId, payload)
        : addPiProvider(payload)
    },
    onSuccess: async (result) => {
      if (result.status < 200 || result.status >= 300) {
        toast.error("保存未完成，请检查配置并刷新后重试")
        return
      }
      toast.success("provider 配置已保存")
      input.onProviderFormClosed()
      await invalidate()
    },
    onError: (error) =>
      toast.error(error.message || "保存失败，请重新读取确认"),
  })

  const remove = useMutation({
    mutationFn: async (entry: ProviderEntry) =>
      deletePiProvider({
        providerId: entry.id,
        signature: query.data?.signature ?? "",
      }),
    onSuccess: async (result) => {
      if (result.status !== 204) {
        toast.error("删除未完成，请刷新配置核实")
        return
      }
      toast.success("provider 已删除")
      input.onProviderDeleted()
      await invalidate()
    },
    onError: (error) =>
      toast.error(error.message || "删除失败，请刷新配置核实"),
  })

  /**
   * 删除单个模型：把该 provider 的 models 过滤后整体保存。
   * 少于两个模型时不动：服务端 models 至少 1 个；删中默认模型会被告知先换默认模型。
   */
  const removeModel = useMutation({
    mutationFn: async (target: { providerId: string; modelId: string }) => {
      const entry = query.data?.providers.find(
        (item) => item.id === target.providerId
      )
      if (!entry || !query.data) throw new Error("请先刷新配置后重试")
      // 用 unwrap 抛出服务端文案：删除默认模型等情况需要原话告知用户。
      return unwrap(
        await updatePiProvider(entry.id, {
          providerId: entry.id,
          signature: query.data.signature,
          provider: {
            ...entry.provider,
            name: entry.provider.name ?? entry.id,
            models: entry.provider.models.filter(
              (model) => model.id !== target.modelId
            ),
          },
        })
      )
    },
    onSuccess: async () => {
      toast.success("模型已删除")
      input.onModelDeleted()
      await invalidate()
    },
    onError: (error) => toast.error(error.message || "删除模型失败"),
  })

  /** 追加或修改一个模型：两种入口共用同一套保存逻辑。 */
  const addModel = useMutation({
    mutationFn: async (draft: ModelDraft) => {
      const entry = query.data?.providers.find(
        (item) => item.id === draft.providerId
      )
      if (!entry || !query.data) throw new Error("请先刷新配置后重试")
      const fromJson =
        draft.json.trim() === "" ? null : parseModelJson(draft.json)
      const id = fromJson ? String(fromJson.id) : draft.id.trim()
      if (id === "") throw new Error("模型 id 不能为空")
      if (
        entry.provider.models.some(
          (model) => model.id === id && model.id !== draft.editingModelId
        )
      )
        throw new Error("该 provider 已有同名模型 id")
      const thinkingLevelMap = parseThinkingLevelMap(draft.thinkingLevelMapJson)
      const inputTypes = [
        ...(draft.inputText ? ["text"] : []),
        ...(draft.inputImage ? ["image"] : []),
      ]
      const next = (fromJson ?? {
        id,
        ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
        ...(draft.reasoning ? { reasoning: true } : {}),
        ...(inputTypes.length > 0 ? { input: inputTypes } : {}),
        ...optionalNumber("contextWindow", draft.contextWindow),
        ...optionalNumber("maxTokens", draft.maxTokens),
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      }) as (typeof entry.provider.models)[number]
      const models = draft.editingModelId
        ? entry.provider.models.map((model) =>
            model.id === draft.editingModelId ? next : model
          )
        : [...entry.provider.models, next]
      return unwrap(
        await updatePiProvider(entry.id, {
          providerId: entry.id,
          signature: query.data.signature,
          provider: {
            ...entry.provider,
            name: entry.provider.name ?? entry.id,
            models,
          },
        })
      )
    },
    onSuccess: async () => {
      toast.success("模型已保存")
      input.onModelFormClosed()
      await invalidate()
    },
    onError: (error) => toast.error(error.message || "添加模型失败"),
  })

  /** 复制一个新的 provider：id 与显示名加后缀，密钥不能跟着走。 */
  const copyProvider = useMutation({
    mutationFn: async (entry: ProviderEntry) => {
      if (!query.data) throw new Error("请先刷新配置后重试")
      return unwrap(
        await addPiProvider({
          providerId: `${entry.id}-copy`,
          signature: query.data.signature,
          provider: {
            ...entry.provider,
            name: `${entry.provider.name ?? entry.id} (. copy)`,
          },
        })
      )
    },
    onSuccess: async () => {
      toast.success("已复制为新 Provider，请补充 API Key")
      await invalidate()
    },
    onError: (error) => toast.error(error.message || "复制 Provider 失败"),
  })

  /** 复制密钥：列表只有掩码，用单条接口取明文再写剪贴板。 */
  const copyApiKey = async (providerId: string): Promise<void> => {
    try {
      const { apiKey } = await fetchPiProviderApiKey(providerId)
      if (!apiKey) {
        toast.error("该 Provider 没有保存密钥")
        return
      }
      await navigator.clipboard.writeText(apiKey)
      toast.success("密钥已复制")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制密钥失败")
    }
  }

  /** 复制模型配置为 JSON：方便在另一个 provider 里直接粘贴添加。 */
  const copyModelJson = async (
    model: ProviderEntry["provider"]["models"][number]
  ): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(model, null, 2))
      toast.success("模型 JSON 已复制")
    } catch {
      toast.error("复制失败：浏览器拒绝了剪贴板访问")
    }
  }

  return {
    save,
    remove,
    removeModel,
    addModel,
    copyProvider,
    copyApiKey,
    copyModelJson,
  }
}
