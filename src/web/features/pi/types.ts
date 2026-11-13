import type { usePiModels } from "./queries"

/** Pi 模型列表里的一条 Provider 记录（由 models 查询的返回形状派生）。 */
export type ProviderEntry = ReturnType<
  typeof usePiModels
>["data"] extends infer T
  ? T extends { providers: (infer P)[] }
    ? P
    : never
  : never

/** 待确认删除的模型：provider 与 model 标识。 */
export type DeleteModelTarget = {
  providerId: string
  modelId: string
}
