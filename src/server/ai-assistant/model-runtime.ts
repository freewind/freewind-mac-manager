import { readFileSync } from "node:fs"
import path from "node:path"
import {
  ModelRuntime,
  readStoredCredential,
} from "@earendil-works/pi-coding-agent"
import { PublicOperationError } from "@server/common/public-error"
import { PI_AGENT_DIR } from "@server/env"

/**
 * 构造 AI 助手用的完整 ModelRuntime。
 *
 * 与 pi 测试台的实现同源，但不收窄返回类型：助手需要 runtime.getModel() 之外的
 * 完整能力（会话内部会用它解析凭据与模型目录）。
 *
 * 只读本机凭据：modelsStore 全为空实现，allowModelNetwork 与 refreshOnCreate 都关闭，
 * 保证建会话不发起任何网络请求，也不改动用户的 Pi 配置。
 */
export const createAssistantModelRuntime = async (
  signal: AbortSignal
): Promise<ModelRuntime> => {
  const modelsPath = path.join(PI_AGENT_DIR, "models.json")
  const authPath = path.join(PI_AGENT_DIR, "auth.json")
  const rawModels: unknown = JSON.parse(readFileSync(modelsPath, "utf8"))
  // 凭据字段允许写成以 ! 开头的 shell 命令，交给 pi CLI 执行；助手进程不执行配置里的命令。
  const rejectCommands = (value: unknown): void => {
    if (typeof value === "string" && value.trimStart().startsWith("!")) {
      throw new PublicOperationError(403, "AI 助手不执行配置中的凭据命令")
    }
    if (Array.isArray(value)) value.forEach(rejectCommands)
    else if (value && typeof value === "object")
      Object.values(value).forEach(rejectCommands)
  }
  rejectCommands(rawModels)

  const credentialCache = new Map<
    string,
    Awaited<ReturnType<typeof readStoredCredential>>
  >()
  const credentials = {
    read: async (providerId: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal?.aborted) return undefined
      if (!credentialCache.has(providerId)) {
        credentialCache.set(
          providerId,
          readStoredCredential(providerId, authPath)
        )
      }
      return credentialCache.get(providerId)
    },
    list: async () => [],
    modify: async (
      providerId: string,
      fn: (
        current: Awaited<ReturnType<typeof readStoredCredential>>
      ) => Promise<Awaited<ReturnType<typeof readStoredCredential>>>,
      options?: { signal?: AbortSignal }
    ) => {
      if (options?.signal?.aborted) return undefined
      const current = credentialCache.has(providerId)
        ? credentialCache.get(providerId)
        : readStoredCredential(providerId, authPath)
      const next = await fn(current)
      if (next !== undefined) credentialCache.set(providerId, next)
      return credentialCache.get(providerId) ?? current
    },
    delete: async () => undefined,
  }
  const modelsStore = {
    read: async () => undefined,
    write: async () => undefined,
    delete: async () => undefined,
  }
  return ModelRuntime.create({
    credentials,
    modelsStore,
    authPath,
    modelsPath,
    allowModelNetwork: false,
    refreshOnCreate: false,
    signal,
  })
}
