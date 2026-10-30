import { useCallback, useRef, useState } from "react"

/**
 * 按住说话：按下开始，松手后再多录一秒才真正结束。
 *
 * 两个体验问题决定了这里的做法：
 *
 * 1. 按下那一刻不该等。麦克风与 worklet 只在第一次按下时启动，之后一直
 *    保持运行，按下只是打一个时间戳；另外取录音时往前多带 300ms，
 *    把「按下到真正开始」这段补回来，开头的字不会被削掉。
 * 2. 松手不该立刻停。人说完最后一个字才松手，这一瞬间的尾音很容易丢，
 *    所以松手后再录 1000ms 再收尾。
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
/** 环形缓冲最多留多久：够放一次说话，也不至于越攒越多。 */
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

type Block = { at: number; data: Float32Array }

export type PushToTalk = {
  /** 按下：打一个开始标记。第一次按下会顺带启动麦克风。 */
  press: () => Promise<void>
  /** 松手：再录一秒后返回这段时间的 16k 采样。 */
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
  const startAtRef = useRef<number | null>(null)
  const [holding, setHolding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 启动采集链路。只做一次，之后一直保持运行，按下时不再等待。 */
  const ensureStarted = useCallback(async () => {
    if (nodeRef.current) return
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
    const context = contextRef.current
    if (context.state === "suspended") await context.resume()
    const url = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "application/javascript" })
    )
    try {
      await context.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const source = context.createMediaStreamSource(streamRef.current)
    const node = new AudioWorkletNode(context, "call-capture")
    const cutoff = 0
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const now = Date.now()
      if (bufferRef.current === null) bufferRef.current = []
      const buffer = bufferRef.current
      buffer.push({ at: now, data: event.data })
      // 只留最近一段：太老的块对下一次说话没有用。
      while (buffer.length > 0 && now - buffer[0].at > BUFFER_MS) buffer.shift()
      void cutoff
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

  const press = useCallback(async () => {
    setError(null)
    try {
      await ensureStarted()
      startAtRef.current = Date.now()
      setHolding(true)
    } catch (cause) {
      setHolding(false)
      setError(
        cause instanceof Error && cause.name === "NotAllowedError"
          ? "麦克风权限被拒绝，请在浏览器设置里允许后重试"
          : "无法打开麦克风，请检查设备与权限"
      )
    }
  }, [ensureStarted])

  const release = useCallback(async (): Promise<Float32Array | null> => {
    setHolding(false)
    const startAt = startAtRef.current
    startAtRef.current = null
    if (startAt === null) return null
    const from = startAt - PREROLL_MS
    const until = Date.now() + TAIL_MS
    // 松手后再多收一段：最后一个字的尾音通常就在这时。
    await new Promise((resolve) => setTimeout(resolve, TAIL_MS))
    const context = contextRef.current
    if (!context) return null
    const buffer = bufferRef.current ?? []
    const blocks = buffer.filter(
      (block) => block.at >= from && block.at <= until
    )
    // 只丢掉已经取走的块：剩下的让下一句继续用，连说几句不会互相吃掉。
    bufferRef.current = buffer.filter((block) => block.at > until)
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
