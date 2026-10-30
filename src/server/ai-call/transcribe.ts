import { readFileSync } from "node:fs"
import path from "node:path"
import { PublicOperationError } from "@server/common/public-error"
import { env, PI_AGENT_DIR } from "@server/env"

/**
 * 语音识别：把手机录下的一段音频交给 SenseAudio 的 OpenAI 兼容接口。
 *
 * 手机只负责录音与上传，一段话几十 KB。地址与密钥不另存一份：Pi 的
 * models.json 里已经有这个模型的定义，这里按模型 id 反查所属 provider，
 * 拿它的 baseUrl 与 apiKey——换密钥、换服务商都只改那处配置。
 */

/** 没有显式指定时用的识别模型：在 Pi 配置里按这个 id 查找 provider。 */
const DEFAULT_MODEL_ID = "senseaudio/senseaudio-asr-lite-1.5-260319"
/** 识别超时：正常一句话 1-2 秒，留足网络抖动余量。 */
const TIMEOUT_MS = 25_000
/** 单段音频上限：16k 16 位 60 秒约 1.9MB，再大就不像一句话了。 */
const MAX_PCM_BYTES = 1_920_000

type AsrEndpoint = { baseUrl: string; apiKey: string; model: string }

const pickString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : ""

/** 在 Pi 配置里找识别模型的 provider；找不到或结构不对返回 null。 */
const resolveEndpoint = (): AsrEndpoint | null => {
  const model = env.ASR_MODEL || DEFAULT_MODEL_ID
  let raw: unknown
  try {
    raw = JSON.parse(
      readFileSync(path.join(PI_AGENT_DIR, "models.json"), "utf8")
    )
  } catch {
    return null
  }
  const providers = (raw as { providers?: unknown }).providers
  if (typeof providers !== "object" || providers === null) return null
  for (const provider of Object.values(providers as Record<string, unknown>)) {
    if (typeof provider !== "object" || provider === null) continue
    const entry = provider as {
      baseUrl?: unknown
      apiKey?: unknown
      models?: unknown
    }
    const baseUrl = pickString(entry.baseUrl)
    const apiKey = pickString(entry.apiKey)
    if (!baseUrl || !apiKey) continue
    // 本应用不执行配置里的命令：这类凭据交给 Pi 自己解析。
    if (apiKey.startsWith("!")) continue
    if (!Array.isArray(entry.models)) continue
    const hit = entry.models.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        pickString((item as { id?: unknown }).id) === model
    )
    if (hit) return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model }
  }
  return null
}

/** 缺少配置时给出可执行的下一步，不暴露内部路径。 */
export class TranscribeUnavailableError extends Error {
  constructor() {
    super("语音识别模型未在 Pi 配置里找到，请先配置识别模型")
    this.name = "TranscribeUnavailableError"
  }
}

/** 16k 单声道 16 位 PCM 加 WAV 头：接口按 OpenAI 约定收音频文件。 */
const buildWav = (pcm: Buffer, sampleRate: number): Buffer => {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "ascii")
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8, "ascii")
  header.write("fmt ", 12, "ascii")
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // 单声道
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36, "ascii")
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** 从接口响应里取识别文本，结构不对就当空结果。 */
const readText = (payload: unknown): string => {
  if (typeof payload !== "object" || payload === null) return ""
  const text = (payload as { text?: unknown }).text
  return typeof text === "string" ? text.trim() : ""
}

/**
 * 识别一段 16k 单声道 PCM。
 *
 * 音频只在内存里拼成 WAV 发出去，不落盘保存，与「通话内容只留在库里」
 * 的约定一致。
 */
export const transcribePcm = async (pcm: Buffer): Promise<string> => {
  const endpoint = resolveEndpoint()
  if (!endpoint) throw new TranscribeUnavailableError()
  if (pcm.length === 0) return ""
  if (pcm.length > MAX_PCM_BYTES) {
    throw new PublicOperationError(400, "这段录音太长，请分段说")
  }
  const form = new FormData()
  form.append(
    "file",
    new Blob([new Uint8Array(buildWav(pcm, 16_000))], { type: "audio/wav" }),
    "audio.wav"
  )
  form.append("model", endpoint.model)
  try {
    const response = await fetch(`${endpoint.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${endpoint.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      // 不回传响应正文：里面可能带服务商侧的内部信息。
      throw new PublicOperationError(500, "语音识别服务暂时不可用")
    }
    return readText(await response.json())
  } catch (error) {
    if (error instanceof PublicOperationError) throw error
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError"
    throw new PublicOperationError(
      500,
      timedOut ? "语音识别超时，请再说一次" : "语音识别失败，请再说一次"
    )
  }
}
