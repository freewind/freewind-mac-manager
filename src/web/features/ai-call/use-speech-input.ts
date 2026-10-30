import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 采集麦克风、切出一整句话、交给上层去识别。
 *
 * 三件事：
 * 1. 采集：AudioWorklet 拿到原始采样，重采样到 16kHz；
 * 2. 分段：能量判断「开始说话」与「说完了」；
 * 3. 交付：把一整段 PCM 编成 base64 交出去（识别在服务端做）。
 *
 * 为什么用能量判断而不是模型 VAD：模型要多下几 MB，而打断只需要一个
 * 粗糙的「是不是有人在说话」；误触发靠最小持续时长兜住，咳嗽和关门声
 * 撑不到 150ms。
 *
 * 为什么识别放服务端：手机上跑 whisper 要先下几十 MB 模型、每次识别
 * 还要好几秒；Mac 上只下一遍。代价是上行要传音频，好在只在整句话说完
 * 时才发一次（16kHz 16 位 = 32KB/s）。
 */

/** whisper 要求的采样率。 */
const TARGET_RATE = 16_000
/** 连续超过阈值这么久才算真的开口：咳嗽、关门声不会这么长。 */
const SPEECH_ONSET_MS = 150
/** 静音超过这么久算一句话说完。 */
const SPEECH_END_MS = 900
/** 通话开始先听这么久的环境声，用它定阈值。 */
const NOISE_FLOOR_MS = 400
/** 单段录音上限：超过就强制切段，避免一句话攒成一大坨。 */
const MAX_UTTERANCE_MS = 30_000
/** 阈值下限：完全安静的环境里底噪接近 0，不留下限会被风吹草动触发。 */
const MIN_THRESHOLD = 0.006
/** 开头预留的音频：确认开口前也先留着，否则第一个字会被削掉。 */
const PREROLL_MS = 300

/** 阈值相对底噪的倍数。 */
const THRESHOLD_RATIO = 2.5

/**
 * 采集用的 AudioWorklet。
 *
 * 直接每帧（128 采样，2.7ms）postMessage 太频繁，所以在 worklet 里先攒到
 * 2048 个采样再发一次，主线程每秒只需要处理二十来次。
 */
const WORKLET_SOURCE = `
class CallCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunks = []
    this.size = 0
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    this.chunks.push(channel.slice(0))
    this.size += channel.length
    if (this.size < 2048) return true
    const merged = new Float32Array(this.size)
    let offset = 0
    for (const chunk of this.chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.port.postMessage(merged, [merged.buffer])
    this.chunks = []
    this.size = 0
    return true
  }
}
registerProcessor("call-capture", CallCaptureProcessor)
`

/** 线性插值重采样；手机 AudioContext 常见 48kHz，whisper 只吃 16kHz。 */
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
    const position = index * ratio
    const low = Math.floor(position)
    const high = Math.min(low + 1, input.length - 1)
    const weight = position - low
    output[index] = input[low] * (1 - weight) + input[high] * weight
  }
  return output
}

const rootMeanSquare = (samples: Float32Array): number => {
  let total = 0
  for (const sample of samples) total += sample * sample
  return Math.sqrt(total / samples.length)
}

const mergeChunks = (chunks: Float32Array[], length: number): Float32Array => {
  const merged = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

type Phase = "calibrating" | "idle" | "recording"

type DetectorState = {
  phase: Phase
  noiseTotal: number
  noiseCount: number
  noiseFloor: number
  speechMs: number
  silentMs: number
  chunks: Float32Array[]
  length: number
  /** 最近一珰音频：确认开口时整段带上，避免首个字被截断。 */
  preroll: Float32Array[]
  prerollLength: number
}

const initialState = (): DetectorState => ({
  phase: "calibrating",
  noiseTotal: 0,
  noiseCount: 0,
  noiseFloor: 0,
  speechMs: 0,
  silentMs: 0,
  chunks: [],
  length: 0,
  preroll: [],
  prerollLength: 0,
})

export type SpeechInput = {
  /** 开始采集。必须在用户手势里调用，否则浏览器不给麦克风权限。 */
  start: () => Promise<void>
  stop: () => void
  /** 麦克风已就绪：可以开始说话。 */
  listening: boolean
  /** 正在录这句话。 */
  recording: boolean
  /** 启动失败的原因（权限被拒、没有设备等）。 */
  error: string | null
}

export const useSpeechInput = (options: {
  /** 检测到用户开口：上层据此立刻打断正在播放的回答。 */
  onSpeechStart: () => void
  /** 一整句话说完：交出 16kHz 单声道 float32 采样。 */
  onUtterance: (samples: Float32Array) => void
  /**
   * 每块音频的电平（0-1，已放大）。界面拿它做波动反馈。
   *
   * 不走 state：每秒二十多次的更新会让整棵树重渲染，长列表会卡。
   */
  onLevel?: (level: number) => void
}): SpeechInput => {
  const startRef = useRef(options.onSpeechStart)
  startRef.current = options.onSpeechStart
  const utteranceRef = useRef(options.onUtterance)
  utteranceRef.current = options.onUtterance
  const levelRef = useRef(options.onLevel)
  levelRef.current = options.onLevel

  const contextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const stateRef = useRef<DetectorState>(initialState())
  const [listening, setListening] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finishUtterance = useCallback(() => {
    const state = stateRef.current
    const samples = mergeChunks(state.chunks, state.length)
    stateRef.current = {
      ...initialState(),
      phase: "idle",
      noiseFloor: state.noiseFloor,
    }
    setRecording(false)
    // 太短的录音不值得识别：多半是环境噪音，白跑一次模型还会换回一句空话。
    if (samples.length < TARGET_RATE * 0.3) return
    utteranceRef.current(samples)
  }, [])

  const handleBlock = useCallback(
    (block: Float32Array, sampleRate: number) => {
      const samples = resample(block, sampleRate, TARGET_RATE)
      if (samples.length === 0) return
      const state = stateRef.current
      const level = rootMeanSquare(samples)
      const blockMs = (samples.length / TARGET_RATE) * 1000
      // 麦克风电平给界面做波动：放大一点，安静时也有可见的呼吸感。
      levelRef.current?.(Math.min(1, level * 6))

      // 每块都先放进开头缓冲。确认开口前的那一小段也要带上：
      // 「能听到吗」的「能」往往轻而短，等超过阈值才开录就会被削掉。
      state.preroll.push(samples)
      state.prerollLength += samples.length
      while (
        state.prerollLength > (TARGET_RATE * PREROLL_MS) / 1000 &&
        state.preroll.length > 1
      ) {
        const removed = state.preroll.shift()
        if (!removed) break
        state.prerollLength -= removed.length
      }

      if (state.phase === "calibrating") {
        state.noiseTotal += level * samples.length
        state.noiseCount += samples.length
        if (state.noiseCount < (TARGET_RATE * NOISE_FLOOR_MS) / 1000) return
        state.noiseFloor = state.noiseTotal / state.noiseCount
        state.phase = "idle"
        return
      }

      const threshold = Math.max(
        MIN_THRESHOLD,
        state.noiseFloor * THRESHOLD_RATIO
      )

      if (state.phase === "idle") {
        if (level <= threshold) {
          state.speechMs = 0
          return
        }
        state.speechMs += blockMs
        if (state.speechMs < SPEECH_ONSET_MS) return
        // 确认开口：把开头缓冲整段带上，首个字也跟着进去。
        state.phase = "recording"
        state.silentMs = 0
        state.chunks = [...state.preroll]
        state.length = state.prerollLength
        state.preroll = []
        state.prerollLength = 0
        setRecording(true)
        startRef.current()
        return
      }

      state.chunks.push(samples)
      state.length += samples.length
      if (level <= threshold) {
        state.silentMs += blockMs
      } else {
        state.silentMs = 0
      }
      const tooLong = state.length / TARGET_RATE > MAX_UTTERANCE_MS / 1000
      if (state.silentMs >= SPEECH_END_MS || tooLong) finishUtterance()
    },
    [finishUtterance]
  )

  const stop = useCallback(() => {
    nodeRef.current?.disconnect()
    nodeRef.current = null
    const stream = streamRef.current
    streamRef.current = null
    for (const track of stream?.getTracks() ?? []) track.stop()
    const context = contextRef.current
    contextRef.current = null
    if (context && context.state !== "closed") void context.close()
    stateRef.current = initialState()
    setListening(false)
    setRecording(false)
  }, [])

  const start = useCallback(async () => {
    if (contextRef.current) return
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // 回声消除是打断能用的前提：不消掉自己念出去的声音，
          // 喇叭一响就会被自己的声音判定成「用户在说话」。
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      const context = new AudioContext()
      const url = URL.createObjectURL(
        new Blob([WORKLET_SOURCE], { type: "application/javascript" })
      )
      try {
        await context.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      const source = context.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(context, "call-capture")
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        handleBlock(event.data, context.sampleRate)
      }
      source.connect(node)
      // worklet 必须连到输出，否则浏览器不会驱动它；用 0 增益避免自己听自己。
      const mute = context.createGain()
      mute.gain.value = 0
      node.connect(mute)
      mute.connect(context.destination)
      streamRef.current = stream
      contextRef.current = context
      nodeRef.current = node
      stateRef.current = initialState()
      setListening(true)
    } catch (cause) {
      stop()
      setError(
        cause instanceof Error && cause.name === "NotAllowedError"
          ? "麦克风权限被拒绝，请在浏览器设置里允许后重试"
          : "无法打开麦克风，请检查设备与权限"
      )
    }
  }, [handleBlock, stop])

  useEffect(() => () => stop(), [stop])

  return { start, stop, listening, recording, error }
}
