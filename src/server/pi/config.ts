import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { PublicOperationError } from "@server/common/public-error"
import { PI_AGENT_DIR } from "@server/env"
import type {
  PiModelsResponse,
  PiProviderInput,
  PiSettingsResponse,
} from "@shared/api-contract"
import {
  PiModelsResponseSchema,
  PiProviderDeleteSchema,
  PiProviderMutationSchema,
  PiProviderSchema,
  PiSettingsMutationSchema,
  PiSettingsResponseSchema,
} from "@shared/api-contract/schemas/pi"

const MAX_CONFIG_BYTES = 8 * 1024 * 1024
const CONFIG_MODELS = "models.json"
const CONFIG_SETTINGS = "settings.json"
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
const settingsPath = (): string => path.join(PI_AGENT_DIR, CONFIG_SETTINGS)

const sign = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex")

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error

const withFileLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const key = PI_AGENT_DIR
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

const withModelLock = <T>(operation: () => Promise<T>): Promise<T> =>
  withFileLock(operation)

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

const settingsDefaults = {
  defaultThinkingLevel: "medium",
  theme: "system",
  retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000 },
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
}

const loadSettingsDocument = async (): Promise<{
  raw: string
  signature: string
  mode: number
  settings: Record<string, unknown>
  exists: boolean
}> => {
  const file = settingsPath()
  try {
    const stat = await fs.lstat(file)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) {
      throw new PublicOperationError(
        403,
        "拒绝访问非普通或过大的 settings.json"
      )
    }
    const raw = await fs.readFile(file, "utf8")
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new PublicOperationError(
        400,
        "settings.json 不是合法 JSON，未修改文件"
      )
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new PublicOperationError(400, "settings.json 必须是 JSON 对象")
    }
    return {
      raw,
      signature: sign(raw),
      mode: stat.mode,
      settings: parsed as Record<string, unknown>,
      exists: true,
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        raw: "",
        signature: sign(""),
        mode: 0o600,
        settings: {},
        exists: false,
      }
    }
    throw error
  }
}

const publicSettingsResponse = (loaded: {
  settings: Record<string, unknown>
  signature: string
}): PiSettingsResponse =>
  PiSettingsResponseSchema.parse({
    settings: redactHeaders(loaded.settings),
    signature: loaded.signature,
    updatedAt: Date.now(),
    defaults: settingsDefaults,
  })

const writeSettings = async (
  loaded: Awaited<ReturnType<typeof loadSettingsDocument>>,
  settings: Record<string, unknown>
): Promise<void> => {
  const current = await loadSettingsDocument()
  if (current.signature !== loaded.signature) {
    throw new PublicOperationError(
      409,
      "settings.json 已被其他程序修改，请刷新后重试"
    )
  }
  const file = settingsPath()
  if (loaded.exists) {
    const backup = `${file}.bak-${Date.now()}-${randomBytes(4).toString("hex")}`
    try {
      await fs.copyFile(file, backup, 1)
      await fs.chmod(backup, loaded.mode & 0o777)
    } catch {
      throw new PublicOperationError(
        500,
        "无法建立配置备份，未修改 settings.json"
      )
    }
  } else {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  }
  try {
    await atomicWrite(
      file,
      `${JSON.stringify(settings, null, 2)}\n`,
      loaded.mode
    )
  } catch {
    throw new PublicOperationError(500, "Pi 设置写入失败，请重新读取核实")
  }
}

export const getPiSettings = async (): Promise<PiSettingsResponse> =>
  publicSettingsResponse(await loadSettingsDocument())

export const savePiSettings = async (
  input: unknown
): Promise<PiSettingsResponse> =>
  withFileLock(async () => {
    const mutation = PiSettingsMutationSchema.safeParse(input)
    if (!mutation.success)
      throw new PublicOperationError(400, "Pi 设置未通过校验")
    const loaded = await loadSettingsDocument()
    if (loaded.signature !== mutation.data.signature) {
      throw new PublicOperationError(
        409,
        "settings.json 已被其他程序修改，请刷新后重试"
      )
    }
    const modelsFile = await readDocument()
    if (modelsFile.signature !== mutation.data.modelsSignature) {
      throw new PublicOperationError(
        409,
        "Pi 模型配置已变化，请重新读取设置后重试"
      )
    }
    const providers = modelsFile.document.providers
    const defaultProvider = mutation.data.settings.defaultProvider
    const defaultModel = mutation.data.settings.defaultModel
    if (
      typeof defaultProvider === "string" &&
      typeof defaultModel === "string" &&
      providers[defaultProvider]
    ) {
      const models = providers[defaultProvider].models
      if (
        Array.isArray(models) &&
        !models.some(
          (model) =>
            typeof model === "object" &&
            model !== null &&
            (model as { id?: unknown }).id === defaultModel
        )
      ) {
        throw new PublicOperationError(400, "默认模型不属于所选 Provider")
      }
    }
    const settings = mergeSecrets(
      loaded.settings,
      mutation.data.settings
    ) as Record<string, unknown>
    for (const field of mutation.data.clearFields) delete settings[field]
    for (const field of mutation.data.clearSubfields) {
      const [group, key] = field.split(".")
      const value = settings[group]
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        delete (value as Record<string, unknown>)[key]
        if (Object.keys(value).length === 0) delete settings[group]
      }
    }
    await writeSettings(loaded, settings)
    const raw = `${JSON.stringify(settings, null, 2)}\n`
    return publicSettingsResponse({ settings, signature: sign(raw) })
  })

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
  withModelLock(async () => {
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
  withModelLock(async () => {
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
  withModelLock(async () => {
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
