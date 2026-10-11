import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { PublicOperationError } from "@server/common/public-error"
import { PI_AGENT_DIR } from "@server/env"
import {
  PiModelGroupAddSchema,
  PiModelGroupDeleteSchema,
  type PiModelGroupInputSchema,
  PiModelGroupReplaceSchema,
  PiModelGroupSchema,
  PiModelGroupsResponseSchema,
} from "@shared/api-contract/schemas/pi-model-groups"
import type { z } from "zod"

type PiModelGroupsResponse = z.infer<typeof PiModelGroupsResponseSchema>
type PiModelGroupWriteResult = { groupId: string }

const PiModelGroupInputShape = PiModelGroupAddSchema
const PiModelGroupReplaceShape = PiModelGroupReplaceSchema
const SignatureShape = PiModelGroupDeleteSchema

const MAX_GROUPS_BYTES = 1024 * 1024
const CONFIG_GROUPS = "model-groups.json"
const locks = new Map<string, Promise<void>>()

type GroupRecord = {
  name: string
  contextWindow?: number
  maxTokens?: number
  members: { provider: string; modelId: string }[]
}
type GroupsDocument = Record<string, GroupRecord>
type LoadedGroups = {
  document: GroupsDocument
  signature: string
  mode: number
  exists: boolean
}
type LoadedModels = Record<string, { models?: { id?: unknown }[] }>

const groupsPath = (): string => path.join(PI_AGENT_DIR, CONFIG_GROUPS)

const sign = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex")

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error

const withFileLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const key = `${PI_AGENT_DIR}:groups`
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

const parseGroups = (raw: string): GroupsDocument => {
  if (Buffer.byteLength(raw, "utf8") > MAX_GROUPS_BYTES) {
    throw new PublicOperationError(400, "model-groups.json 超过允许大小")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PublicOperationError(
      400,
      "model-groups.json 不是合法 JSON，未修改文件"
    )
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PublicOperationError(400, "model-groups.json 必须是对象")
  }
  const result: GroupsDocument = {}
  for (const [id, group] of Object.entries(parsed as Record<string, unknown>)) {
    const checked = PiModelGroupSchema.safeParse(group)
    if (!checked.success) {
      throw new PublicOperationError(400, `模型分组 ${id} 格式无效`)
    }
    result[id] = checked.data
  }
  return result
}

const readGroupsDocument = async (): Promise<LoadedGroups> => {
  const file = groupsPath()
  let stat: Awaited<ReturnType<typeof fs.lstat>>
  try {
    stat = await fs.lstat(file)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        document: {},
        signature: sign(""),
        mode: 0o600,
        exists: false,
      }
    }
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new PublicOperationError(403, "拒绝访问非普通 model-groups.json 文件")
  }
  const raw = await fs.readFile(file, "utf8")
  return {
    document: parseGroups(raw),
    signature: sign(raw),
    mode: stat.mode,
    exists: true,
  }
}

const readModelsDocument = async (): Promise<LoadedModels> => {
  const file = path.join(PI_AGENT_DIR, "models.json")
  try {
    const stat = await fs.lstat(file)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new PublicOperationError(
        403,
        "拒绝访问非普通 models.json，无法校验分组成员"
      )
    }
    const raw = await fs.readFile(file, "utf8")
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new PublicOperationError(
        400,
        "models.json 不是合法 JSON，无法校验分组成员"
      )
    }
    const providers = (parsed as { providers?: unknown }).providers
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof providers !== "object" ||
      providers === null ||
      Array.isArray(providers)
    ) {
      throw new PublicOperationError(
        400,
        "models.json 缺少有效的 providers 对象，无法校验分组成员"
      )
    }
    return providers as LoadedModels
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new PublicOperationError(
        404,
        "Pi models.json 不存在，无法校验分组成员"
      )
    }
    throw error
  }
}

const toResponse = (loaded: LoadedGroups): PiModelGroupsResponse =>
  PiModelGroupsResponseSchema.parse({
    groups: Object.entries(loaded.document).map(([id, group]) => ({
      id,
      group,
    })),
    signature: loaded.signature,
    updatedAt: Date.now(),
  })

const validateGroupId = (groupId: string): void => {
  if (
    groupId.length > 256 ||
    groupId.trim() !== groupId ||
    groupId === "__proto__" ||
    !/^[\p{L}\p{N}_.:@/-]+$/u.test(groupId)
  ) {
    throw new PublicOperationError(400, "分组名称格式无效")
  }
}

/** 校验成员存在于 models.json，且组内成员不重复。 */
const validateMembers = async (
  input: z.infer<typeof PiModelGroupInputSchema>
): Promise<void> => {
  const seen = new Set<string>()
  for (const member of input.members) {
    const key = `${member.provider}/${member.modelId}`
    if (seen.has(key)) {
      throw new PublicOperationError(
        400,
        `分组成员重复：${member.provider}/${member.modelId}`
      )
    }
    seen.add(key)
  }
  const models = await readModelsDocument()
  for (const member of input.members) {
    const provider = models[member.provider]
    const modelIds = Array.isArray(provider?.models)
      ? provider.models.map((model) =>
          typeof model === "object" &&
          model !== null &&
          typeof model.id === "string"
            ? model.id
            : null
        )
      : []
    if (!provider || !modelIds.includes(member.modelId)) {
      throw new PublicOperationError(
        400,
        `分组成员不存在：${member.provider}/${member.modelId}`
      )
    }
  }
}

const atomicWrite = async (
  file: string,
  contents: string,
  mode: number
): Promise<void> => {
  const temporary = path.join(
    path.dirname(file),
    `.model-groups-${randomBytes(12).toString("hex")}.tmp`
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

const writeGroups = async (
  loaded: LoadedGroups,
  document: GroupsDocument
): Promise<PiModelGroupsResponse> => {
  const file = groupsPath()
  const latest = await readGroupsDocument()
  if (latest.signature !== loaded.signature) {
    throw new PublicOperationError(
      409,
      "model-groups.json 已被其他程序修改，请刷新后重试"
    )
  }
  if (loaded.exists) {
    const backup = `${file}.bak-${Date.now()}-${randomBytes(4).toString("hex")}`
    try {
      await fs.copyFile(file, backup, 1)
      await fs.chmod(backup, loaded.mode & 0o777)
    } catch {
      throw new PublicOperationError(
        500,
        "无法建立配置备份，未修改 model-groups.json"
      )
    }
  }
  const contents = `${JSON.stringify(document, null, 2)}\n`
  try {
    await atomicWrite(file, contents, loaded.mode)
  } catch {
    throw new PublicOperationError(500, "分组配置写入失败，请重新读取核实")
  }
  return PiModelGroupsResponseSchema.parse({
    groups: Object.entries(document).map(([id, group]) => ({ id, group })),
    signature: sign(contents),
    updatedAt: Date.now(),
  })
}

export const listPiModelGroups = async (): Promise<PiModelGroupsResponse> =>
  toResponse(await readGroupsDocument())

export const addPiModelGroup = async (
  input: unknown
): Promise<PiModelGroupWriteResult> =>
  withFileLock(async () => {
    const mutation = PiModelGroupInputShape.parse(input)
    validateGroupId(mutation.groupId)
    const loaded = await readGroupsDocument()
    if (loaded.signature !== mutation.signature) {
      throw new PublicOperationError(
        409,
        "model-groups.json 已被其他程序修改，请刷新后重试"
      )
    }
    if (loaded.document[mutation.groupId]) {
      throw new PublicOperationError(409, "分组已存在")
    }
    await validateMembers(mutation.group)
    await writeGroups(loaded, {
      ...loaded.document,
      [mutation.groupId]: mutation.group,
    })
    return { groupId: mutation.groupId }
  })

export const replacePiModelGroup = async (
  groupId: string,
  input: unknown
): Promise<PiModelGroupWriteResult> =>
  withFileLock(async () => {
    validateGroupId(groupId)
    const mutation = PiModelGroupReplaceShape.parse(input)
    const loaded = await readGroupsDocument()
    if (loaded.signature !== mutation.signature) {
      throw new PublicOperationError(
        409,
        "model-groups.json 已被其他程序修改，请刷新后重试"
      )
    }
    if (!loaded.document[groupId]) {
      throw new PublicOperationError(404, "分组不存在")
    }
    await validateMembers(mutation.group)
    const document = { ...loaded.document }
    delete document[groupId]
    document[groupId] = mutation.group
    await writeGroups(loaded, document)
    return { groupId }
  })

export const deletePiModelGroup = async (
  groupId: string,
  input: unknown
): Promise<void> =>
  withFileLock(async () => {
    validateGroupId(groupId)
    const parsed = SignatureShape.safeParse(input)
    if (!parsed.success)
      throw new PublicOperationError(400, "删除分组的入参无效")
    const loaded = await readGroupsDocument()
    if (loaded.signature !== parsed.data.signature) {
      throw new PublicOperationError(
        409,
        "model-groups.json 已被其他程序修改，请刷新后重试"
      )
    }
    if (!loaded.document[groupId]) {
      throw new PublicOperationError(404, "分组不存在")
    }
    const document = { ...loaded.document }
    delete document[groupId]
    await writeGroups(loaded, document)
  })
