import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { PublicOperationError } from "@server/common/public-error"
import { MODELS_DIR } from "@server/env"

const run = promisify(execFile)

/**
 * 本机语音识别：sherpa-onnx 的 Paraformer 中文模型。
 *
 * 为什么放服务端：手机浏览器只能跑 WASM，whisper-base 一次要好几秒还占满
 * 主线程；Mac 上原生二进制识别 5 秒音频只要 0.04 秒（实测 RTF 0.008）。
 * 手机只负责录音与上传，一段话几十 KB。
 *
 * 走外部命令而不是 Node 原生绑定：与 docker / caddy / frp 一样，
 * 二进制由脚本下载到 data/models，升级与排查都不牵扯 Node 依赖。
 */

const SHERPA_DIR = path.join(MODELS_DIR, "sherpa")
const BIN = path.join(SHERPA_DIR, "bin", "sherpa-onnx-offline")
const MODEL_DIR = path.join(SHERPA_DIR, "sense-voice")
const MODEL = path.join(MODEL_DIR, "model.int8.onnx")
const TOKENS = path.join(MODEL_DIR, "tokens.txt")

/** 识别超时：正常一句话几百毫秒，留足冷启动与慢盘的余量。 */
const TIMEOUT_MS = 20_000
/** 单段音频上限：16k 16 位 60 秒约 1.9MB，再大就不像一句话了。 */
const MAX_PCM_BYTES = 1_920_000
/** 交给 onnxruntime 的线程数：手机场景单人说话，4 条足够且不吃满 CPU。 */
const NUM_THREADS = 4

export const isTranscribeAvailable = (): boolean =>
  existsSync(BIN) && existsSync(MODEL) && existsSync(TOKENS)

/** 外部命令缺失时给出可执行的下一步，不暴露内部路径。 */
export class TranscribeUnavailableError extends Error {
  constructor() {
    super("语音识别组件未安装，请先运行 pnpm models:sherpa")
    this.name = "TranscribeUnavailableError"
  }
}

/**
 * 串行执行识别：一次通话只有一个麦克风，并发只会多开进程抢 CPU。
 * 排队而不是丢弃，前一句识别完立刻处理下一句。
 */
let queue: Promise<unknown> = Promise.resolve()
const serial = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task)
  // 队列本身不能被失败打断：吞掉错误，调用方仍拿到自己的 rejection。
  queue = next.catch(() => undefined)
  return next
}

/** 16k 单声道 16 位 PCM 加 WAV 头：sherpa 只吃标准 WAV 文件。 */
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

/**
 * 从命令输出里取识别文本。
 *
 * sherpa 先打印配置与耗时，最后一行是 JSON；逐行从后往前找第一个
 * 带 text 的 JSON，避免把前面的日志误当结果。
 */
const parseText = (stdout: string): string => {
  const lines = stdout.trim().split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith("{")) continue
    try {
      const parsed = JSON.parse(line) as { text?: unknown }
      if (typeof parsed.text === "string") return parsed.text.trim()
    } catch {
      // 不是 JSON 就继续往前找。
    }
  }
  return ""
}

/**
 * 识别一段 16k 单声道 PCM。
 *
 * 临时文件用完即删：音频不落盘保留，与「通话内容只留在库里」的约定一致。
 */
export const transcribePcm = async (pcm: Buffer): Promise<string> => {
  if (!isTranscribeAvailable()) throw new TranscribeUnavailableError()
  if (pcm.length === 0) return ""
  if (pcm.length > MAX_PCM_BYTES) {
    throw new PublicOperationError(400, "这段录音太长，请分段说")
  }
  return serial(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mac-manager-asr-"))
    const wav = path.join(dir, "audio.wav")
    try {
      await writeFile(wav, buildWav(pcm, 16_000))
      const { stdout } = await run(
        BIN,
        [
          `--tokens=${TOKENS}`,
          `--sense-voice-model=${MODEL}`,
          // 中文为主：英文单词（Docker、zip）仍会按原样识别。
          "--sense-voice-language=zh",
          // 数字归一化：「三点半」变「3点半」，交给 AI 时更好理解。
          "--sense-voice-use-itn=true",
          `--num-threads=${NUM_THREADS}`,
          wav,
        ],
        { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
      )
      return parseText(stdout)
    } catch (error) {
      // 超时与崩溃都不回传命令输出：里面可能带本机路径。
      const timedOut =
        typeof error === "object" &&
        error !== null &&
        "killed" in error &&
        (error as { killed?: boolean }).killed === true
      throw new PublicOperationError(
        500,
        timedOut ? "语音识别超时，请再说一次" : "语音识别失败，请再说一次"
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
