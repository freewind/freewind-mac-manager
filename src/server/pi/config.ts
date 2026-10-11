import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { PublicOperationError } from "@server/common/public-error"
import { PI_AGENT_DIR } from "@server/env"
import type { PiModelsResponse, PiProviderInput } from "@shared/api-contract"
import {
  PiModelsResponseSchema,
  PiProviderDeleteSchema,
  PiProviderMutationSchema,
  PiProviderSchema,
} from "@shared/api-contract/schemas/pi"

const MAX_CONFIG_BYTES = 8 * 1024 * 1024
const CONFIG_MODELS = "models.json"
const locks = new Map<string, Promise<void>>()

type ProviderRecord = Record<string, unknown>
type ModelsDocument = {
  providers: Record<string, ProviderRecord>
  [key: string]: unknown
}
type LoadedDocument = {
  document: ModelsDocument
  raw: string
  signature: string
  mode: number
}

const modelsPath = (): string => path.join(PI_AGENT_DIR, CONFIG_MODELS)

const sign = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex")

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error

const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const key = modelsPath()
  const previous = locks.get(key) ?? Promise.resolve()
  let release = (): void => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  locks.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (locks.get(key) === current) locks.delete(key)
  }
}

const parseDocument = (raw: string): ModelsDocument => {
  if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
    throw new PublicOperationError(400, "models.json 超过允许大小")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PublicOperationError(400, "models.json 不是合法 JSON，未修改文件")
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { providers?: unknown }).providers !== "object" ||
    (parsed as { providers?: unknown }).providers === null ||
    Array.isArray((parsed as { providers?: unknown }).providers)
  ) {
    throw new PublicOperationError(400, "models.json 缺少有效的 providers 对象")
  }
  return parsed as ModelsDocument
}

const readDocument = async (): Promise<LoadedDocument> => {
  const file = modelsPath()
  let stat: Awaited<ReturnType<typeof fs.lstat>>
  try {
    stat = await fs.lstat(file)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new PublicOperationError(404, "Pi models.json 不存在")
    }
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new PublicOperationError(403, "拒绝访问非普通 models.json 文件")
  }
  const raw = await fs.readFile(file, "utf8")
  return {
    document: parseDocument(raw),
    raw,
    signature: sign(raw),
    mode: stat.mode,
  }
}

const redactHeaders = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactHeaders)
  if (typeof value !== "object" || value === null) return value
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (/api.?key|authorization|token|secret|credential|password/i.test(key)) {
      result[key] = typeof entry === "string" && entry ? "••••••" : entry
    } else {
      result[key] = redactHeaders(entry)
    }
  }
  return result
}

const publicProvider = (provider: ProviderRecord) => {
  const { apiKey, ...withoutApiKey } = provider
  const safeProvider = redactHeaders(withoutApiKey)
  const parsed = PiProviderSchema.safeParse(safeProvider)
  if (!parsed.success) {
    throw new PublicOperationError(400, "Pi provider 配置无效，拒绝读改写")
  }
  return parsed.data
}

const toResponse = (loaded: LoadedDocument): PiModelsResponse => {
  const providers = Object.entries(loaded.document.providers).map(
    ([id, provider]) => ({
      id,
      provider: publicProvider(provider),
      hasApiKey:
        typeof provider.apiKey === "string" && Boolean(provider.apiKey),
      modelCount: Array.isArray(provider.models) ? provider.models.length : 0,
    })
  )
  return PiModelsResponseSchema.parse({
    providers,
    signature: loaded.signature,
    updatedAt: Date.now(),
  })
}

const validateProviderId = (providerId: string): void => {
  if (
    providerId.length > 256 ||
    providerId.trim() !== providerId ||
    providerId === "__proto__" ||
    !/^[\p{L}\p{N}_.:@/-]+$/u.test(providerId)
  ) {
    throw new PublicOperationError(400, "provider 名称格式无效")
  }
}

const readSettings = async (): Promise<Record<string, unknown> | null> => {
  const file = path.join(PI_AGENT_DIR, "settings.json")
  let stat: Awaited<ReturnType<typeof fs.lstat>>
  try {
    stat = await fs.lstat(file)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) {
    throw new PublicOperationError(403, "拒绝读取非普通或过大的 settings.json")
  }
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"))
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("invalid")
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new PublicOperationError(
      409,
      "settings.json 无法解析，拒绝修改 provider"
    )
  }
}

const validateDefaultReference = async (
  providers: Record<string, ProviderRecord>,
  oldId: string | null,
  newId: string | null
): Promise<void> => {
  const settings = await readSettings()
  if (settings === null) return
  if (typeof settings.defaultProvider !== "string") return
  if (oldId === null || settings.defaultProvider !== oldId) return
  if (newId === null || !providers[newId]) {
    throw new PublicOperationError(
      409,
      "该 provider 是默认项，请先更换默认 provider"
    )
  }
  if (typeof settings.defaultModel !== "string") return
  const models = providers[newId].models
  if (
    Array.isArray(models) &&
    !models.some(
      (model) =>
        typeof model === "object" &&
        model !== null &&
        (model as { id?: unknown }).id === settings.defaultModel
    )
  ) {
    throw new PublicOperationError(
      409,
      "新 provider 不包含默认模型，请先更换默认模型"
    )
  }
}

const atomicWrite = async (
  file: string,
  contents: string,
  mode: number
): Promise<void> => {
  const temporary = path.join(
    path.dirname(file),
    `.models-${randomBytes(12).toString("hex")}.tmp`
  )
  try {
    const handle = await fs.open(temporary, "wx", mode & 0o777)
    try {
      await handle.writeFile(contents, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}

const writeDocument = async (
  loaded: LoadedDocument,
  providers: Record<string, ProviderRecord>,
  oldId: string | null,
  newId: string | null
): Promise<void> => {
  await validateDefaultReference(providers, oldId, newId)
  const file = modelsPath()
  const latest = await readDocument()
  if (latest.signature !== loaded.signature) {
    throw new PublicOperationError(
      409,
      "models.json 已被其他程序修改，请刷新后重试"
    )
  }
  const backup = `${file}.bak-${Date.now()}-${randomBytes(4).toString("hex")}`
  try {
    await fs.copyFile(file, backup, 1)
    await fs.chmod(backup, loaded.mode & 0o777)
  } catch {
    throw new PublicOperationError(500, "无法建立配置备份，未修改 models.json")
  }
  const contents = `${JSON.stringify({ ...loaded.document, providers }, null, 2)}\n`
  try {
    await atomicWrite(file, contents, loaded.mode)
  } catch {
    throw new PublicOperationError(500, "Pi 配置写入失败，请重新读取核实")
  }
}

const parseMutation = (input: unknown) => {
  const result = PiProviderMutationSchema.safeParse(input)
  if (!result.success)
    throw new PublicOperationError(400, "provider 配置未通过校验")
  validateProviderId(result.data.providerId)
  return result.data
}

const mergeSecrets = (existing: unknown, input: unknown): unknown => {
  if (input === "••••••") return existing
  if (Array.isArray(input)) {
    const previous = Array.isArray(existing) ? existing : []
    return input.map((value, index) => mergeSecrets(previous[index], value))
  }
  if (typeof input !== "object" || input === null) return input
  const previous =
    typeof existing === "object" && existing !== null
      ? (existing as Record<string, unknown>)
      : {}
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      mergeSecrets(previous[key], value),
    ])
  )
}

const mergeProvider = (
  existing: ProviderRecord | undefined,
  input: PiProviderInput,
  clearApiKey: boolean
): ProviderRecord => {
  const { apiKey, ...editable } = input
  const next = mergeSecrets(existing ?? {}, editable) as ProviderRecord
  next.name = input.name
  if (clearApiKey) delete next.apiKey
  else if (apiKey && apiKey !== "••••••") next.apiKey = apiKey
  else if (existing?.apiKey !== undefined) next.apiKey = existing.apiKey
  else delete next.apiKey
  return next
}

export const listPiModels = async (): Promise<PiModelsResponse> =>
  toResponse(await readDocument())

export const addPiProvider = async (
  input: unknown
): Promise<{ providerId: string; hasApiKey: boolean }> =>
  withLock(async () => {
    const mutation = parseMutation(input)
    const loaded = await readDocument()
    if (loaded.signature !== mutation.signature) {
      throw new PublicOperationError(
        409,
        "models.json 已被其他程序修改，请刷新后重试"
      )
    }
    if (loaded.document.providers[mutation.providerId]) {
      throw new PublicOperationError(409, "provider 已存在")
    }
    const providers = { ...loaded.document.providers }
    providers[mutation.providerId] = mergeProvider(
      undefined,
      mutation.provider,
      false
    )
    await writeDocument(loaded, providers, null, null)
    return {
      providerId: mutation.providerId,
      hasApiKey: Boolean(mutation.provider.apiKey),
    }
  })

export const updatePiProvider = async (
  providerId: string,
  input: unknown
): Promise<{ providerId: string; hasApiKey: boolean }> =>
  withLock(async () => {
    validateProviderId(providerId)
    const mutation = parseMutation(input)
    const loaded = await readDocument()
    if (loaded.signature !== mutation.signature) {
      throw new PublicOperationError(
        409,
        "models.json 已被其他程序修改，请刷新后重试"
      )
    }
    const existing = loaded.document.providers[providerId]
    if (!existing) throw new PublicOperationError(404, "provider 不存在")
    if (
      mutation.providerId !== providerId &&
      loaded.document.providers[mutation.providerId]
    ) {
      throw new PublicOperationError(409, "目标 provider 名已存在")
    }
    const providers = { ...loaded.document.providers }
    delete providers[providerId]
    const next = mergeProvider(
      existing,
      mutation.provider,
      mutation.clearApiKey ?? false
    )
    providers[mutation.providerId] = next
    await writeDocument(loaded, providers, providerId, mutation.providerId)
    return {
      providerId: mutation.providerId,
      hasApiKey: Boolean(next.apiKey),
    }
  })

export const deletePiProvider = async (
  providerId: string,
  input: unknown
): Promise<void> =>
  withLock(async () => {
    const parsed = PiProviderDeleteSchema.safeParse(input)
    if (!parsed.success)
      throw new PublicOperationError(400, "删除 provider 入参无效")
    validateProviderId(providerId)
    const loaded = await readDocument()
    if (loaded.signature !== parsed.data.signature) {
      throw new PublicOperationError(
        409,
        "models.json 已被其他程序修改，请刷新后重试"
      )
    }
    if (!loaded.document.providers[providerId]) {
      throw new PublicOperationError(404, "provider 不存在")
    }
    const providers = { ...loaded.document.providers }
    delete providers[providerId]
    await writeDocument(loaded, providers, providerId, null)
  })
