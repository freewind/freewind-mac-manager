import { useCallback, useState } from "react"

/**
 * 浏览器里跑 whisper 做语音识别。
 *
 * 为什么不放服务端：服务端要装 onnxruntime 原生包（一百多 MB），这台机器
 * 上 x64 Node 跑在 arm64 Mac 里，那个包直接找不到匹配的二进制，整个后端
 * 都会起不来。浏览器里 onnxruntime-web 走 WASM，任何设备都能用。
 *
 * 模型文件由本应用自己提供（/models），不再从 HuggingFace 下载：
 * 局域网传几十 MB 比外网稳定得多，也不依赖手机能否访问外网。
 */

/** 用多语言版而不是 .en 版：中文识别必须用多语言模型。 */
const MODEL_ID = "Xenova/whisper-base"

/**
 * 模型放在应用自己的静态目录下，路径与 scripts/fetch-whisper-model.ts
 * 下载的目录结构一致：<MODELS_DIR>/Xenova/whisper-base/...
 */
const LOCAL_MODEL_PATH = "/models/"

/**
 * 只依赖确实要用到的调用签名，避免把整条 pipeline 的类型拖进来。
 * 识别结果是 `{ text }`，其余字段（分块时间戳等）这里不需要。
 */
type Transcriber = (
  audio: Float32Array,
  options: { language?: string; task: string }
) => Promise<{ text: string }>

/** 模块级单例：多个组件共用同一份已加载模型，不必各自再下一遍。 */
let loading: Promise<Transcriber> | null = null

/** transformers.js 上报的下载进度；`progress` 是 0-100，不是 0-1。 */
type ProgressReport = {
  status?: string
  file?: string
  loaded?: number
  total?: number
  progress?: number
}

/**
 * 逐文件聚合下载进度。
 *
 * 每个文件各报 0-100，直接拿来当总进度会超过 100%（实测到过 1220%）；
 * 这里按「已下载字节 / 总字节」算，并把结果夹在 0-1。
 */
const createProgressMeter = (onProgress: (ratio: number) => void) => {
  const files = new Map<string, { loaded: number; total: number }>()
  return (report: ProgressReport): void => {
    if (report.status !== "progress" || !report.file) return
    const total = typeof report.total === "number" ? report.total : 0
    if (total <= 0) return
    files.set(report.file, {
      loaded: Math.min(report.loaded ?? 0, total),
      total,
    })
    let loaded = 0
    let sum = 0
    for (const item of files.values()) {
      loaded += item.loaded
      sum += item.total
    }
    if (sum > 0) onProgress(Math.min(1, loaded / sum))
  }
}

const loadTranscriber = (
  onProgress: (ratio: number) => void
): Promise<Transcriber> => {
  if (loading) return loading
  loading = (async () => {
    const { env, pipeline } = await import("@huggingface/transformers")
    // 只用本应用提供的模型文件：下载失败时立刻报错，不会悄悄回退到外网。
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = LOCAL_MODEL_PATH
    const created = await pipeline("automatic-speech-recognition", MODEL_ID, {
      // 量化版体积约为 fp32 的四分之一，中文日常对话的质量损失很小。
      dtype: "q8",
      progress_callback: createProgressMeter(onProgress),
    })
    return created as unknown as Transcriber
  })().catch((error: unknown) => {
    // 失败不缓存：模型补好后下一次点开通话应该还能重试。
    loading = null
    throw error
  })
  return loading
}

/** 一次识别的结果：文本加上音频本身的情况，便于判断「没听清」是谁的问题。 */
export type RecognitionResult = {
  text: string
  /** 这段音频的时长（秒）。 */
  seconds: number
  /** 峰值振幅 0-1：接近 0 说明麦克风基本没收到声音。 */
  peak: number
}

const measure = (samples: Float32Array): { seconds: number; peak: number } => {
  let peak = 0
  for (const sample of samples) {
    const value = Math.abs(sample)
    if (value > peak) peak = value
  }
  return { seconds: samples.length / 16_000, peak }
}

export type SpeechRecognizer = {
  /** 识别一段 16kHz 单声道音频；返回空文本表示没听出内容。 */
  recognize: (samples: Float32Array) => Promise<RecognitionResult>
  /** 模型正在下载或初始化。 */
  warming: boolean
  /** 模型加载进度 0-1。 */
  progress: number
  error: string | null
}

export const useSpeechRecognition = (): SpeechRecognizer => {
  const [warming, setWarming] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recognize = useCallback(async (samples: Float32Array) => {
    setError(null)
    const measured = measure(samples)
    let transcriber: Transcriber
    if (loading) {
      transcriber = await loading
    } else {
      setWarming(true)
      setProgress(0)
      try {
        transcriber = await loadTranscriber(setProgress)
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `语音模型加载失败：${cause.message}`
            : "语音模型加载失败"
        )
        throw cause
      } finally {
        setWarming(false)
      }
    }
    const output = await transcriber(samples, {
      language: "chinese",
      task: "transcribe",
    })
    const text = output.text.trim()
    if (text) return { text, ...measured }
    // 指定中文却什么都没识别出来时，再用自动检测试一次：
    // 某些量化模型对强制语言 token 很敏感，换一种解码方式往往能出字。
    const fallback = await transcriber(samples, { task: "transcribe" })
    return { text: fallback.text.trim(), ...measured }
  }, [])

  return { recognize, warming, progress, error }
}
