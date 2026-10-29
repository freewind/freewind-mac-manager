import { useCallback, useState } from "react"

/**
 * 浏览器里跑 whisper 做语音识别。
 *
 * 为什么不放服务端：服务端要装 onnxruntime 原生包（一百多 MB），这台机器
 * 上 x64 Node 跑在 arm64 Mac 里，那个包直接找不到匹配的二进制，整个后端
 * 都会起不来。浏览器里 onnxruntime-web 走 WASM，任何设备都能用，而且
 * 省掉了把音频传到外网的流量。
 *
 * 代价是模型要在第一次通话时下载一次（几十 MB），之后走浏览器缓存。
 */

/** 用多语言版而不是 .en 版：中文识别必须用多语言模型。 */
const MODEL_ID = "Xenova/whisper-base"

/**
 * 只依赖确实要用到的调用签名，避免把整条 pipeline 的类型拖进来。
 * 识别结果是 `{ text }`，其余字段（分块时间戳等）这里不需要。
 */
type Transcriber = (
  audio: Float32Array,
  options: { language: string; task: string }
) => Promise<{ text: string }>

/** 模块级单例：多个组件共用同一份已加载模型，不必各自再下一遍。 */
let loading: Promise<Transcriber> | null = null

const loadTranscriber = (
  onProgress: (ratio: number) => void
): Promise<Transcriber> => {
  if (loading) return loading
  loading = (async () => {
    const { pipeline } = await import("@huggingface/transformers")
    const created = await pipeline("automatic-speech-recognition", MODEL_ID, {
      // 量化版体积约为 fp32 的四分之一，中文日常对话的质量损失很小。
      dtype: "q8",
      progress_callback: (report: unknown) => {
        const progress = (report as { progress?: unknown }).progress
        if (typeof progress === "number") onProgress(progress)
      },
    })
    return created as unknown as Transcriber
  })().catch((error: unknown) => {
    // 失败不缓存：网络恢复后下一次点开通话应该还能重试。
    loading = null
    throw error
  })
  return loading
}

export type SpeechRecognizer = {
  /** 识别一段 16kHz 单声道音频；返回空串表示没听出内容。 */
  recognize: (samples: Float32Array) => Promise<string>
  /** 模型正在下载或初始化。 */
  warming: boolean
  /** 模型下载进度 0-1。 */
  progress: number
  error: string | null
}

export const useSpeechRecognition = (): SpeechRecognizer => {
  const [warming, setWarming] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recognize = useCallback(async (samples: Float32Array) => {
    setError(null)
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
    return output.text.trim()
  }, [])

  return { recognize, warming, progress, error }
}
