/**
 * 通话音效：拨号、接通、挂断。
 *
 * 用 Web Audio 现场合成三个短音，不引入音频文件：几百字节的代码换三个
 * wav 资源，也省掉加载与解码。浏览器要求音频在用户手势里启动，
 * 这三处都发生在点击回调里。
 */

let context: AudioContext | null = null

const ctx = (): AudioContext | null => {
  if (typeof window === "undefined") return null
  context ??= new AudioContext()
  // 被系统挂起时恢复：切后台再回来仍要能响。
  if (context.state === "suspended") void context.resume()
  return context
}

/** 在第 at 秒发一个短音，音量线性起、指数落，听起来像电话的提示音。 */
const beep = (frequency: number, at: number, duration: number): void => {
  const audio = ctx()
  if (!audio) return
  const start = audio.currentTime + at
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  oscillator.type = "sine"
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.linearRampToValueAtTime(0.12, start + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain)
  gain.connect(audio.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

/** 拨号：两声短促的低音，像电话开始拨出去。 */
export const playDialTone = (): void => {
  beep(440, 0, 0.12)
  beep(440, 0.22, 0.12)
}

/** 接通：一声高一点的确认音。 */
export const playConnectTone = (): void => {
  beep(660, 0, 0.16)
}

/** 挂断：两声下行，与拨号区分开。 */
export const playHangUpTone = (): void => {
  beep(392, 0, 0.14)
  beep(294, 0.18, 0.2)
}
