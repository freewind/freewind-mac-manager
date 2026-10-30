import { useCallback, useRef, useState } from "react"

/**
 * 按住说话：按下取起点、松开取终点，两端各多带 0.5 秒。
 *
 * 时间基准是音频时钟，不是主线程的 Date.now()：
 *
 * - worklet 每块带上自己的 `currentTime`（音频硬件时钟，逐样本推进）；
 * - 按下与松开也用 `AudioContext.currentTime`，同一个时钟；
 * - 主线程再忙，也不会让消息的时间戳挤在一起，切片不会错位。
 *
 * 链路常驻：按下只是记一个时刻，不重建麦克风，也不重新要权限。
 */

const WORKLET_SOURCE = `
class CallCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channel = input[0]
    if (channel && channel.length > 0) {
      this.port.postMessage({ at: currentTime, data: new Float32Array(channel) })
    }
    return true
  }
}
registerProcessor("call-capture", CallCapture)
`

/** 前后各多带这么长：前补按下瞬间，后接最后一个字的尾音。 */
const PAD_SECONDS = 0.5
/** 松手后继续录的时长，等于「后多带 0.5 秒」。 */
const TAIL_MS = 500
/** 缓冲最多留多久：够放一次说话，也不至于越攒越多。 */
const BUFFER_SECONDS = 20

/**
 * 下采样到目标采样率：每段取平均，相当于顺带做了一个低通。
 *
 * 直接抽点会把高于 8k 的成分折到语音带里（混叠），听上去沙沙的、
 * 模型也很难认；取平均能把这部分压下去。
 */
const resample = (
  input: Float32Array,
  from: number,
  to: number
): Float32Array => {
  if (from === to) return input
  const ratio = from / to
  const length = Math.floor(input.length / ratio)
  const output = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio)
    const end = Math.min(input.length, Math.floor((index + 1) * ratio))
    let sum = 0
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor]
    output[index] = sum / Math.max(1, end - start)
  }
  return output
}

/** Float32（-1..1）转 16k 单声道 16 位 PCM。 */
export const toPcm16 = (samples: Float32Array): Uint8Array => {
  const view = new DataView(new ArrayBuffer(samples.length * 2))
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return new Uint8Array(view.buffer)
}

type Block = { at: number; data: Float32Array }

export type PushToTalk = {
  /** 按下：记下起点时刻。第一次按下会顺带启动麦克风。 */
  press: () => Promise<void>
  /** 松手：再录 0.5 秒后返回这段的 16k 采样。 */
  release: () => Promise<Float32Array | null>
  /** 正在录。界面据此显示按住状态。 */
  holding: boolean
  error: string | null
}

export const usePushToTalk = (): PushToTalk => {
  const contextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const bufferRef = useRef<Block[] | null>(null)
  const moduleLoadedRef = useRef<boolean | null>(null)
  /** 按下时的音频时钟读数（秒）。 */
  const startAtRef = useRef<number | null>(null)
  const [holding, setHolding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 建一条采集链路：source → worklet → 静音输出。 */
  const buildChain = useCallback(() => {
    const context = contextRef.current
    const stream = streamRef.current
    if (!context || !stream) return
    const old = nodeRef.current
    if (old) {
      old.port.onmessage = null
      old.disconnect()
    }
    sourceRef.current?.disconnect()
    const source = context.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(context, "call-capture")
    node.port.onmessage = (event: MessageEvent<Block>) => {
      if (bufferRef.current === null) bufferRef.current = []
      const buffer = bufferRef.current
      buffer.push(event.data)
      // 只留最近一段：块按音频时钟递增，直接丢最老的。
      const maxBlocks = Math.ceil((BUFFER_SECONDS * context.sampleRate) / 128)
      if (buffer.length > maxBlocks) buffer.splice(0, buffer.length - maxBlocks)
    }
    // worklet 必须连到输出，否则浏览器不会驱动它；用 0 增益避免自己听自己。
    const mute = context.createGain()
    mute.gain.value = 0
    source.connect(node)
    node.connect(mute)
    mute.connect(context.destination)
    sourceRef.current = source
    nodeRef.current = node
  }, [])

  /** 取麦克风与 AudioContext，只做一次（需要用户手势）。 */
  const ensureStarted = useCallback(async () => {
    streamRef.current ??= await navigator.mediaDevices.getUserMedia({
      audio: {
        // 只留回声消除：不然朗读会被录进来。
        // 降噪与自动增益会把语音削碎，听上去失真，模型也认不准。
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    contextRef.current ??= new AudioContext()
    if (moduleLoadedRef.current !== true) {
      const context = contextRef.current
      const url = URL.createObjectURL(
        new Blob([WORKLET_SOURCE], { type: "application/javascript" })
      )
      try {
        await context.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      moduleLoadedRef.current = true
    }
  }, [])

  const press = useCallback(async () => {
    setError(null)
    try {
      await ensureStarted()
      const context = contextRef.current
      if (!context) return
      // 上下文被系统挂起过就恢复；这种情况链路已经停了，必须重建。
      if (context.state !== "running") {
        await context.resume()
        buildChain()
      } else if (!nodeRef.current) {
        buildChain()
      }
      startAtRef.current = context.currentTime
      setHolding(true)
    } catch (cause) {
      setHolding(false)
      setError(
        cause instanceof Error && cause.name === "NotAllowedError"
          ? "麦克风权限被拒绝，请在浏览器设置里允许后重试"
          : "无法打开麦克风，请检查设备与权限"
      )
    }
  }, [buildChain, ensureStarted])

  const release = useCallback(async (): Promise<Float32Array | null> => {
    setHolding(false)
    const startAt = startAtRef.current
    startAtRef.current = null
    if (startAt === null) return null
    // 松手后再多收 0.5 秒：最后一个字的尾音通常就在这时。
    await new Promise((resolve) => setTimeout(resolve, TAIL_MS))
    const context = contextRef.current
    if (!context) return null
    const endAt = context.currentTime
    const from = startAt - PAD_SECONDS
    const blocks = (bufferRef.current ?? []).filter(
      (block) => block.at >= from && block.at <= endAt
    )
    // 取完就丢，避免下一句把这些旧块也算进去。
    bufferRef.current = []
    if (blocks.length === 0) return null
    const total = blocks.reduce((sum, block) => sum + block.data.length, 0)
    const merged = new Float32Array(total)
    let offset = 0
    for (const block of blocks) {
      merged.set(block.data, offset)
      offset += block.data.length
    }
    return resample(merged, context.sampleRate, 16_000)
  }, [])

  return { press, release, holding, error }
}
