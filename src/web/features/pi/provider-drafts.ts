/** 新增或修改 Provider 的表单草稿；modelsJson 只在新增时整段粘贴，编辑不改模型列表。 */
export type ProviderDraft = {
  providerId: string
  name: string
  baseUrl: string
  api: string
  apiKey: string
  clearApiKey: boolean
  modelsJson: string
}

/** 新增或修改模型的表单：粘上 JSON 时以 JSON 为准，否则用下面的字段拼。 */
export type ModelDraft = {
  providerId: string
  /** 非空表示在改已有模型（值为原 id），空表示新增。 */
  editingModelId: string | null
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  /** 粘贴的模型 JSON；非空时优先于下面的字段。 */
  json: string
  reasoning: boolean
  inputText: boolean
  inputImage: boolean
  /** 各 thinking 档位的映射，留空表示不声明。 */
  thinkingLevelMapJson: string
}

export const emptyDraft = (): ProviderDraft => ({
  providerId: "",
  name: "",
  baseUrl: "",
  api: "openai-completions",
  apiKey: "",
  clearApiKey: false,
  modelsJson: JSON.stringify(
    [
      {
        id: "",
        name: "",
        reasoning: false,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
    null,
    2
  ),
})

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** thinkingLevelMap 必须是 JSON 对象；留空表示不声明这个字段。 */
export const parseThinkingLevelMap = (
  text: string
): Record<string, string | null> | null => {
  if (text.trim() === "") return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("thinkingLevelMap 不是合法 JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("thinkingLevelMap 必须是 JSON 对象")
  return parsed as Record<string, string | null>
}

/** 粘贴的模型 JSON：必须是对象且带非空 id，其余字段原样保留。 */
export const parseModelJson = (text: string): Record<string, unknown> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("模型 JSON 不是合法 JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("模型 JSON 必须是对象")
  const id = (parsed as { id?: unknown }).id
  if (typeof id !== "string" || id.trim() === "")
    throw new Error("模型 JSON 需要非空的 id")
  return { ...(parsed as Record<string, unknown>), id: id.trim() }
}

/** 数字输入转成可选字段：空串或非法值不写入，避免把可选字段写成 0。 */
export const optionalNumber = (
  key: "contextWindow" | "maxTokens",
  value: string
): Record<string, number> => {
  const text = value.trim()
  if (text === "") return {}
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed <= 0) return {}
  return { [key]: Math.trunc(parsed) }
}
