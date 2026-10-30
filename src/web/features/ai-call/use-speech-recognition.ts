import { transcribeAiCallAudio } from "@shared/client-api"
import { useCallback, useState } from "react"

/**
 * 语音识别：录音在手机上做，识别交给本机的 sherpa-onnx。
 *
 * 之前是在浏览器里用 WASM 跑 whisper-base：模型 74MB、自回归解码，
 * 手机上要好几秒还占满主线程，所以又慢又卡。改成把一段 16k PCM
 * 传回服务端后，Mac 原生识别 5 秒音频只要几十毫秒（实测 RTF 0.008）。
 *
 * 代价是识别依赖服务在线；通话本来就要连服务，离线时识别出来也没处发。
 */

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

/** 峰值低于这个值就不用识别：纯静音会被模型“听”成句无意义的话。 */
const MIN_PEAK = 0.01

/** Float32（-1..1）转 16k 单声道 16 位 PCM：服务端按这个格式拼 WAV。 */
const toPcm16 = (samples: Float32Array): Uint8Array => {
  const view = new DataView(new ArrayBuffer(samples.length * 2))
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return new Uint8Array(view.buffer)
}

export type SpeechRecognizer = {
  /** 识别一段 16kHz 单声道音频；返回空文本表示没听出内容。 */
  recognize: (samples: Float32Array) => Promise<RecognitionResult>
  error: string | null
}

export const useSpeechRecognition = (): SpeechRecognizer => {
  const [error, setError] = useState<string | null>(null)

  const recognize = useCallback(async (samples: Float32Array) => {
    setError(null)
    const measured = measure(samples)
    // 静音不送服务：Paraformer 对纯静音会编出一句话，白传还添乱。
    if (measured.peak < MIN_PEAK) return { text: "", ...measured }
    try {
      const text = await transcribeAiCallAudio(toPcm16(samples))
      return { text: text.trim(), ...measured }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "语音识别失败，请再说一次"
      )
      throw cause
    }
  }, [])

  return { recognize, error }
}
