import type { KillProcessesResponse } from "@shared/api-contract"

/**
 * 结束进程：只能结束当前用户有权限的进程。
 *
 * 服务自身与 pid ≤ 1 的受保护进程直接跳过，其余交给 `process.kill`，
 * 权限不足等错误按进程逐条回传，不抛给调用方。
 */
export const killProcesses = (
  pids: number[],
  force = false
): KillProcessesResponse => {
  const self = process.pid
  const results = pids.map((pid) => {
    if (pid <= 1 || pid === self) {
      return { pid, succeeded: false, message: "该进程受保护，不能结束" }
    }

    try {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM")
      return { pid, succeeded: true, message: "已发送结束信号" }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { pid, succeeded: false, message }
    }
  })

  return { results }
}
