import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { processName } from "./identity"

const execFileAsync = promisify(execFile)

const MAX_BUFFER = 32 * 1024 * 1024

export type ProcessDetails = {
  pid: number
  parentPid: number
  command: string
  parentName: string
}

/** 一行 `ps -axo pid,ppid,command` 输出：前两列是数字，其余整段是命令行。 */
export const parsePsLine = (
  line: string
): { pid: number; parentPid: number; command: string } | null => {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(trimmed)
  if (!match) {
    return null
  }

  const command = match[3]
  if (command === undefined) {
    return null
  }

  return {
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    command: command.trim(),
  }
}

export const parsePsOutput = (output: string): Map<number, ProcessDetails> => {
  const commands = new Map<number, { parentPid: number; command: string }>()

  for (const line of output.split("\n")) {
    const record = parsePsLine(line)
    if (!record) {
      continue
    }
    commands.set(record.pid, {
      parentPid: record.parentPid,
      command: record.command,
    })
  }

  const result = new Map<number, ProcessDetails>()
  for (const [pid, record] of commands) {
    const parentCommand = commands.get(record.parentPid)?.command
    result.set(pid, {
      pid,
      parentPid: record.parentPid,
      command: record.command,
      parentName: parentCommand ? processName(parentCommand) : "",
    })
  }

  return result
}

/** 取本机进程的命令行与父进程，用于把重名进程（大量 node）区分开。 */
export const snapshotProcesses = async (): Promise<
  Map<number, ProcessDetails>
> => {
  const { stdout } = await execFileAsync(
    "/bin/ps",
    ["-axo", "pid,ppid,command"],
    {
      maxBuffer: MAX_BUFFER,
    }
  )
  return parsePsOutput(stdout)
}
