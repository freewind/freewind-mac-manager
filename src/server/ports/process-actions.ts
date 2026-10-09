import type { KillPortProcessResult } from "@shared/api-contract"
import { collectPortBindings } from "./scanner"

/**
 * 结束指定端口上的进程。
 *
 * 先重新采集一次，只结束「此刻确实占用该端口」的 PID；其余 PID 跳过并说明，
 * 避免把已经释放端口、或 PID 被复用给别的进程的情况误杀。
 */
export const killPortProcesses = async (
  port: number,
  pids: number[]
): Promise<KillPortProcessResult[]> => {
  const bindings = await collectPortBindings()
  const holders = new Map<number, string>()
  for (const binding of bindings) {
    if (binding.port === port) holders.set(binding.pid, binding.processName)
  }

  const results: KillPortProcessResult[] = []
  for (const pid of pids) {
    const name = holders.get(pid)
    if (!name) {
      results.push({
        pid,
        succeeded: false,
        message: `PID ${pid} 当前没有占用端口 ${port}，已跳过`,
      })
      continue
    }
    if (pid === process.pid) {
      results.push({
        pid,
        succeeded: false,
        message: `PID ${pid} 是服务自身，已跳过`,
      })
      continue
    }
    try {
      process.kill(pid, "SIGTERM")
      results.push({
        pid,
        succeeded: true,
        message: `已向 ${name}（PID ${pid}）发送 SIGTERM`,
      })
    } catch (error) {
      results.push({
        pid,
        succeeded: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}
