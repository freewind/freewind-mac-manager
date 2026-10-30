import { useCallback, useRef, useState } from "react"

/**
 * 按住说话：按下开始，松手后再多录 0.5 秒才收尾。
 *
 * 三条硬要求决定了这里的做法：
 *
 * 1. 按下就要有声音。麦克风与 worklet 常驻，按下只是记一个位置，
 *    不去重建链路。
 * 2. 开头不能丢。取录音时往前多拿 500ms，补上「按下到音频真正流动」的空隙。
 * 3. 松手不能丢尾音。松手后再录 500ms。
 *
 * 位置按「块序号」记，不用时间戳：主线程忙时消息会成批到达，
 * 时间戳会挤在一起，按时间切会把声音切碎——听起来就像变调。
 */

const WORKLET_SOURCE = `
class CallCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channel = input[0]
    if (channel && channel.length > 0) this.port.postMessage(new Float32Array(channel))
    return true
  }
}
registerProcessor("call-capture", CallCapture)
`

/** 按下之前多带的一段：补上从按下到音频真正流动的时间。 */
const PREROLL_MS = 500
/** 松手后继续录的时长：接住最后一个字的尾音。 */
const TAIL_MS = 500
/** 缓冲最多留多久：够放一次说话，也不至于越攒越多。 */
const BUFFER_MS = 15_000

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

export type PushToTalk = {
  /** 按下：记下当前位置。第一次按下会顺带启动麦克风。 */
  press: () => Promise<void>
  /** 松手：再录 500ms 后返回这段的 16k 采样。 */
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
  const bufferRef = useRef<Float32Array[] | null>(null)
  const moduleLoadedRef = useRef<boolean | null>(null)
  /** 按下那一刻已有的块数：取录音时从这里往前多拿一段。 */
  const startIndexRef = useRef<number | null>(null)
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
    // 只保留最近 15 秒的块：按块数算，不依赖主线程的时间戳。
    const maxBlocks = Math.ceil((BUFFER_MS / 1000) * (context.sampleRate / 128))
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (bufferRef.current === null) bufferRef.current = []
      const buffer = bufferRef.current
      buffer.push(event.data)
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
      startIndexRef.current = bufferRef.current?.length ?? 0
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
    const startIndex = startIndexRef.current
    startIndexRef.current = null
    if (startIndex === null) return null
    // 松手后再多收一段：最后一个字的尾音通常就在这时。
    await new Promise((resolve) => setTimeout(resolve, TAIL_MS))
    const context = contextRef.current
    if (!context) return null
    const buffer = bufferRef.current ?? []
    // 往前多带一段：按下瞬间的那几个字往往已经进了缓冲。
    const prerollBlocks = Math.ceil(
      ((PREROLL_MS / 1000) * context.sampleRate) / 128
    )
    const from = Math.max(
      0,
      Math.min(startIndex, buffer.length) - prerollBlocks
    )
    const blocks = buffer.slice(from)
    // 取完就丢，避免下一句把这些旧块也算进去。
    bufferRef.current = []
    if (blocks.length === 0) return null
    const total = blocks.reduce((sum, block) => sum + block.length, 0)
    const merged = new Float32Array(total)
    let offset = 0
    for (const block of blocks) {
      merged.set(block, offset)
      offset += block.length
    }
    return resample(merged, context.sampleRate, 16_000)
  }, [])

  return { press, release, holding, error }
}
