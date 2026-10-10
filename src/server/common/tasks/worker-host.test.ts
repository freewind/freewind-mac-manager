import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createProcessHost, type TaskJob } from "./worker-host"
import {
  parseWorkerJob,
  parseWorkerMessage,
  serializeWorkerMessage,
} from "./worker-protocol"

/**
 * 子进程里的脚本：按载荷里的 mode 决定行为。
 * 用真实子进程验证父进程的解析、退出检查、中止与并发上限。
 */
const WORKER_SCRIPT = `
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const job = JSON.parse(input)
  const mode = job.payload?.mode ?? "ok"
  const log = (line) => {
    if (job.payload?.logFile) {
      require("node:fs").appendFileSync(job.payload.logFile, line + "\\n")
    }
  }
  const result = (extra) => {
    process.stdout.write(
      JSON.stringify({ type: "result", result: extra, message: "完成", status: "done" }) + "\\n"
    )
  }
  if (mode === "fail") {
    process.stdout.write(JSON.stringify({ type: "failed", error: "boom" }) + "\\n")
    process.exitCode = 1
    return
  }
  if (mode === "silent") {
    process.stderr.write("no result here\\n")
    process.exitCode = 2
    return
  }
  if (mode === "result-nonzero") {
    result({ finished: true })
    process.exitCode = 1
    return
  }
  if (mode === "garbage") {
    process.stdout.write("not a worker message\\n")
    process.exitCode = 1
    return
  }
  if (mode === "slow") {
    log("start")
    setTimeout(() => { log("end"); result({ slept: true }) }, 150)
    return
  }
  process.stdout.write(
    JSON.stringify({
      type: "progress",
      progress: { done: 3, total: null, bytesDone: 30, bytesTotal: null, stage: "统计", currentTarget: null },
    }) + "\\n"
  )
  result({ echoed: job.payload })
})
`

let dir: string
let scriptPath: string

const makeHost = (maxConcurrency = 4) =>
  createProcessHost({
    command: process.execPath,
    args: [scriptPath],
    maxConcurrency,
  })

const run = (
  host: ReturnType<typeof makeHost>,
  payload: unknown,
  signal = new AbortController().signal
) => {
  const progress: unknown[] = []
  const job: TaskJob = {
    taskId: "task-1",
    kind: "test_kind",
    target: "/tmp",
    requestId: null,
    payload,
  }
  return {
    progress,
    promise: host.execute(job, {
      signal,
      onProgress: (value) => progress.push(value),
    }),
  }
}

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 2000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待子进程超时")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const hasLogLine = (file: string, line: string): boolean => {
  if (!existsSync(file)) return false
  return readFileSync(file, "utf8").split("\n").includes(line)
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-worker-"))
  scriptPath = path.join(dir, "worker.cjs")
  writeFileSync(scriptPath, WORKER_SCRIPT)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("worker protocol", () => {
  it("round-trips progress messages and rejects malformed lines", () => {
    const progress = {
      done: 1,
      total: 2,
      bytesDone: 10,
      bytesTotal: 20,
      stage: "复制中",
      currentTarget: "/tmp/a",
    }
    const line = serializeWorkerMessage({ type: "progress", progress })
    expect(parseWorkerMessage(line)).toEqual({ type: "progress", progress })
    expect(parseWorkerMessage("")).toBeNull()
    expect(parseWorkerMessage("not json")).toBeNull()
    expect(parseWorkerMessage('{"type":"unknown"}')).toBeNull()
    // 进度数字必须是真实整数，虚报的负值不接受
    expect(
      parseWorkerMessage(
        JSON.stringify({
          type: "progress",
          progress: { ...progress, done: -1 },
        })
      )
    ).toBeNull()
  })

  it("rejects a job without a registered kind", () => {
    expect(
      parseWorkerJob(JSON.stringify({ taskId: "a", payload: {} }))
    ).toBeNull()
    expect(
      parseWorkerJob(
        JSON.stringify({
          taskId: "a",
          kind: "disk_scan",
          target: "scan:/",
          requestId: null,
          payload: {},
        })
      )
    ).toMatchObject({ kind: "disk_scan" })
  })
})

describe("process worker host", () => {
  it("forwards real progress and returns the result", async () => {
    const { progress, promise } = run(makeHost(), { mode: "ok" })
    const outcome = await promise
    expect(outcome).toMatchObject({ status: "done", message: "完成" })
    expect(progress).toEqual([
      {
        done: 3,
        total: null,
        bytesDone: 30,
        bytesTotal: null,
        stage: "统计",
        currentTarget: null,
      },
    ])
  })

  it("reports a worker-declared failure with its message", async () => {
    await expect(
      run(makeHost(), { mode: "fail" }).promise
    ).rejects.toMatchObject({
      status: "failed",
      message: "boom",
    })
  })

  it("classifies a process that cannot start as a known failure", async () => {
    const host = createProcessHost({
      command: path.join(dir, "missing-executable"),
      args: [],
      maxConcurrency: 1,
    })
    await expect(run(host, { mode: "ok" }).promise).rejects.toMatchObject({
      status: "failed",
      message: expect.stringContaining("无法启动"),
    })
  })

  it("treats an exit without a result as unknown instead of success", async () => {
    await expect(
      run(makeHost(), { mode: "silent" }).promise
    ).rejects.toMatchObject({
      status: "unknown",
      message: expect.stringContaining("未返回结果"),
    })
  })

  it("does not accept a result followed by a non-zero exit as completed", async () => {
    await expect(
      run(makeHost(), { mode: "result-nonzero" }).promise
    ).rejects.toMatchObject({
      status: "unknown",
      message: expect.stringContaining("返回结果后异常结束"),
    })
  })

  it("treats malformed worker output as an unknown result", async () => {
    await expect(
      run(makeHost(), { mode: "garbage" }).promise
    ).rejects.toMatchObject({
      status: "unknown",
      message: "执行进程返回了无法识别的消息",
    })
  })

  it("kills the worker and reports an unknown result when aborted", async () => {
    const controller = new AbortController()
    const { promise } = run(makeHost(), { mode: "slow" }, controller.signal)
    setTimeout(() => controller.abort(), 30)
    await expect(promise).rejects.toMatchObject({ status: "unknown" })
  })

  it("does not spawn work when already aborted before queuing", async () => {
    const controller = new AbortController()
    controller.abort()
    const logFile = path.join(dir, "never-started.log")
    await expect(
      run(makeHost(1), { mode: "slow", logFile }, controller.signal).promise
    ).rejects.toMatchObject({ status: "unknown" })
    expect(existsSync(logFile)).toBe(false)
  })

  it("cancels a queued task before it can start after shutdown", async () => {
    const host = makeHost(1)
    const logFile = path.join(dir, "queued.log")
    const first = run(host, { mode: "slow", logFile })
    await waitFor(() => hasLogLine(logFile, "start"))

    const controller = new AbortController()
    const queued = run(host, { mode: "slow", logFile }, controller.signal)
    controller.abort()
    await expect(queued.promise).rejects.toMatchObject({ status: "unknown" })
    await first.promise

    expect(readFileSync(logFile, "utf8").trim().split("\n")).toEqual([
      "start",
      "end",
    ])
  })

  it("serializes jobs beyond the concurrency limit", async () => {
    const host = makeHost(1)
    const logFile = path.join(dir, "order.log")
    await Promise.all([
      run(host, { mode: "slow", logFile }).promise,
      run(host, { mode: "slow", logFile }).promise,
    ])
    const lines = readFileSync(logFile, "utf8").trim().split("\n")
    // 上限为 1 时必须是「开始、结束、开始、结束」，不能交错
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe("start")
    expect(lines[1]).toBe("end")
    expect(lines[2]).toBe("start")
    expect(lines[3]).toBe("end")
  })
})
