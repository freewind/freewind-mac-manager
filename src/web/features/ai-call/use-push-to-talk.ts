import { useCallback, useRef, useState } from "react"

/**
 * 按住说话：按下开始录音，松手交出一段 16k 单声道采样。
 *
 * 与之前的自动断句不同，这里不猜「什么时候说完了」——手指就是开关。
 * 微信语音就是这套交互：按住、说、松手。
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
  /** 按下：开始录音。必须在用户手势里调用，否则拿不到麦克风。 */
  press: () => Promise<void>
  /** 松手：停止录音，返回 16k 采样；没录到东西返回 null。 */
  release: () => Float32Array | null
  /** 正在录。界面据此显示按住状态。 */
  holding: boolean
  error: string | null
}

export const usePushToTalk = (): PushToTalk => {
  const contextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const chunksRef = useRef<Float32Array[] | null>(null)
  const moduleLoadedRef = useRef<boolean | null>(null)
  const [holding, setHolding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 断开上一次的节点。
   *
   * 不断开源节点的话，旧 worklet 会继续往缓冲区里推数据，新一段录音就会
   * 混进上一段的声音，听上去像重叠的胡话。
   */
  const teardown = useCallback(() => {
    const node = nodeRef.current
    if (node) {
      node.port.onmessage = null
      node.disconnect()
    }
    sourceRef.current?.disconnect()
    sourceRef.current = null
    nodeRef.current = null
  }, [])

  const press = useCallback(async () => {
    setError(null)
    teardown()
    chunksRef.current = []
    try {
      streamRef.current ??= await navigator.mediaDevices.getUserMedia({
        audio: {
          // 只留回声消除：不然朗读会被录进来。
          // 降噪与自动增益会把语音削碎，听上去失真，模型也认不准——
          // 宁可留点环境噪声，也别把字削掉。
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      contextRef.current ??= new AudioContext()
      const context = contextRef.current
      if (context.state === "suspended") await context.resume()
      if (moduleLoadedRef.current !== true) {
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
      const source = context.createMediaStreamSource(streamRef.current)
      const node = new AudioWorkletNode(context, "call-capture")
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        chunksRef.current?.push(event.data)
      }
      // worklet 必须连到输出，否则浏览器不会驱动它；用 0 增益避免自己听自己。
      const mute = context.createGain()
      mute.gain.value = 0
      source.connect(node)
      node.connect(mute)
      mute.connect(context.destination)
      sourceRef.current = source
      nodeRef.current = node
      setHolding(true)
    } catch (cause) {
      teardown()
      setHolding(false)
      setError(
        cause instanceof Error && cause.name === "NotAllowedError"
          ? "麦克风权限被拒绝，请在浏览器设置里允许后重试"
          : "无法打开麦克风，请检查设备与权限"
      )
    }
  }, [teardown])

  const release = useCallback((): Float32Array | null => {
    teardown()
    setHolding(false)
    const context = contextRef.current
    const chunks = chunksRef.current ?? []
    chunksRef.current = null
    if (!context || chunks.length === 0) return null
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const merged = new Float32Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    return resample(merged, context.sampleRate, 16_000)
  }, [teardown])

  return { press, release, holding, error }
}
