import type { ExecFileException } from "node:child_process"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { command } = vi.hoisted(() => ({ command: vi.fn() }))
vi.mock("node:child_process", () => ({ execFile: command }))

import { snapshotPorts } from "./ports"

beforeEach(() => command.mockReset())
const reply = (error: ExecFileException | null, stdout = "", stderr = "") => {
  command.mockImplementationOnce((_file, _args, _options, callback) =>
    callback(error, stdout, stderr)
  )
}
describe("traffic port collection", () => {
  it("uses command limits and accepts an explicit empty match", async () => {
    reply(Object.assign(new Error("no matches"), { code: 1 }))
    expect(await snapshotPorts([123])).toEqual(new Map())
    expect(command.mock.calls[0][2]).toMatchObject({
      timeout: 5000,
      maxBuffer: 16 * 1024 * 1024,
    })
  })
  it.each([
    {
      error: Object.assign(new Error("timeout"), { code: 1, killed: true }),
      stderr: "",
      message: "端口采集超时",
    },
    {
      error: Object.assign(new Error("denied"), { code: 1 }),
      stderr: "permission denied",
      message: "端口采集失败",
    },
    {
      error: Object.assign(new Error("exit"), { code: 2 }),
      stderr: "",
      message: "端口采集失败",
    },
    {
      error: Object.assign(new Error("signal"), { code: 1, signal: "SIGTERM" }),
      stderr: "",
      message: "端口采集失败",
    },
  ])(
    "rejects failed commands instead of reporting empty ports ($message)",
    async ({ error, stderr, message }) => {
      reply(error as ExecFileException, "", stderr)
      await expect(snapshotPorts([123])).rejects.toThrow(message)
    }
  )
  it("reports only completed batches and stops at a failed batch", async () => {
    const reports: [number, number][] = []
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 1 user 1u IPv4 1 0t0 TCP *:3000 (LISTEN)\n"
      )
      .mockRejectedValueOnce(new Error("timeout"))
    await expect(
      snapshotPorts(
        Array.from({ length: 257 }, (_, index) => index + 1),
        { run, onProgress: (done, total) => reports.push([done, total]) }
      )
    ).rejects.toThrow("timeout")
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0][0]).toHaveLength(128)
    expect(reports).toMatchInlineSnapshot(`
      [
        [
          128,
          257,
        ],
      ]
    `)
  })
  it("collects ports, deduplicates targets and reports final progress", async () => {
    const onProgress = vi.fn()
    const run = vi.fn(
      async () =>
        "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 123 user 1u IPv4 1 0t0 TCP *:3000 (LISTEN)\n"
    )
    expect([
      ...(await snapshotPorts([123, 123, -1], { run, onProgress })).entries(),
    ]).toMatchInlineSnapshot(`
      [
        [
          123,
          [
            3000,
          ],
        ],
      ]
    `)
    expect(run).toHaveBeenCalledWith([123])
    expect(onProgress).toHaveBeenCalledWith(1, 1)
  })
})
