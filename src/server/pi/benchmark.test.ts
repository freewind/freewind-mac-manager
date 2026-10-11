import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  type BenchmarkRuntime,
  createPiBenchmarkService,
  PI_BENCHMARK_HISTORY_LIMIT,
  PI_BENCHMARK_OUTPUT_LIMIT_BYTES,
} from "./benchmark"

const requestId = "req_pi_benchmark_0001"
const basePayload = {
  providerId: "test-provider",
  modelId: "test-model",
  thinkingLevel: "off" as const,
  timeoutMs: 1000,
  prompt: "只回答数字 2",
  requestId,
  maxTokens: 64,
}
const usage = {
  input: 5,
  output: 8,
  cacheRead: 2,
  cacheWrite: 1,
  totalTokens: 13,
  reasoning: 3,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

let directory: string
let databaseFile: string
let monotonic: number
let wall: number
let timers: Map<number, () => void>
let nextTimerId: number
let signal: AbortSignal | undefined
let maxRetries: number | undefined
let service: ReturnType<typeof createPiBenchmarkService>
let events: unknown[]
let hangUntilAbort = false

const makeRuntime = (): BenchmarkRuntime => ({
  getModel: (providerId, modelId) =>
    providerId === basePayload.providerId && modelId === basePayload.modelId
      ? ({} as never)
      : undefined,
  streamSimple: (_model, _context, options) => {
    signal = options?.signal
    maxRetries = options?.maxRetries
    return {
      async *[Symbol.asyncIterator]() {
        if (hangUntilAbort) {
          await new Promise<void>((resolve) =>
            options?.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            })
          )
          yield {
            type: "error",
            reason: "aborted",
            error: assistantMessage({ stopReason: "aborted" }),
          } as never
          return
        }
        for (const event of events) {
          monotonic += 10
          wall += 10
          yield event as never
        }
      },
    } as unknown as ReturnType<BenchmarkRuntime["streamSimple"]>
  },
})

const assistantMessage = (overrides: Record<string, unknown> = {}) => ({
  role: "assistant",
  content: [],
  api: "openai-completions",
  provider: basePayload.providerId,
  model: basePayload.modelId,
  usage,
  stopReason: "stop",
  timestamp: wall,
  ...overrides,
})

const stream = (
  body: string,
  stopReason = "stop",
  messageUsage: unknown = usage
) => [
  { type: "start", partial: assistantMessage() },
  ...(body
    ? [
        {
          type: "text_delta",
          contentIndex: 0,
          delta: body,
          partial: assistantMessage(),
        },
      ]
    : []),
  {
    type: "done",
    reason: stopReason,
    message: assistantMessage({ usage: messageUsage, stopReason }),
  },
]

const run = (payload = basePayload) =>
  service.run(payload, { report: () => undefined })

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "pi-benchmark-test-"))
  databaseFile = path.join(directory, "application.sqlite3")
  monotonic = 100
  wall = 1000
  timers = new Map()
  nextTimerId = 0
  hangUntilAbort = false
  signal = undefined
  maxRetries = undefined
  events = stream("2")
  const db = new DatabaseSync(databaseFile)
  db.exec("CREATE TABLE task_record (request_id TEXT, status TEXT, error TEXT)")
  db.close()
  service = createPiBenchmarkService({
    databaseFile,
    readModels: async () => ({
      signature: "a".repeat(64),
      updatedAt: wall,
      providers: [
        {
          id: basePayload.providerId,
          hasApiKey: true,
          modelCount: 1,
          provider: {
            name: "fake",
            baseUrl: "https://example.invalid/v1",
            api: "openai-completions",
            models: [{ id: basePayload.modelId, maxTokens: 64 }],
          },
        },
      ],
    }),
    createRuntime: async () => makeRuntime(),
    clock: {
      monotonic: () => monotonic,
      wall: () => wall,
      setTimeout: (callback) => {
        const id = ++nextTimerId
        timers.set(id, callback)
        return id as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout: (id) => timers.delete(id as unknown as number),
    },
  })
})

afterEach(() => {
  service.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("Pi benchmark service", () => {
  it("records first event, first text, SDK usage, and configured token cap", async () => {
    const result = await run()
    expect(result).toMatchObject({
      status: "done",
      configuredMaxTokens: 64,
      metrics: {
        firstEventMs: 10,
        firstTextMs: 20,
        inputTokens: 5,
        outputTokens: 8,
        textOutputTokens: 5,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        thinkingTokens: 3,
      },
    })
    expect(maxRetries).toBe(0)
    expect(signal?.aborted).toBe(false)
  })

  it("keeps absent usage null and reports a length stop as partial", async () => {
    events = stream("", "length", null)
    const result = await run()
    expect(result.status).toBe("partial")
    expect(result.stopReason).toBe("length")
    expect(result.metrics.inputTokens).toBeNull()
    expect(result.metrics.outputTokensPerSecond).toBeNull()
  })

  it("aborts the model request at timeout and returns an unknown result", async () => {
    hangUntilAbort = true
    const pending = run()
    for (let spin = 0; spin < 5 && !signal; spin += 1) await Promise.resolve()
    const timeout = timers.values().next().value as (() => void) | undefined
    timeout?.()
    await pending
    expect(signal?.aborted).toBe(true)
    expect((await service.list())[0]).toMatchObject({
      status: "unknown",
      error: "timeout",
    })
  })

  it("retains no answer text and stops when the output byte budget is exceeded", async () => {
    events = stream("x".repeat(PI_BENCHMARK_OUTPUT_LIMIT_BYTES + 1))
    const result = await run()
    expect(result).toMatchObject({ status: "partial", error: "output_limit" })
    expect(JSON.stringify(await service.list())).not.toContain("x".repeat(100))
  })

  it("maps TaskRunner unknown to history and does not repeat a request id", async () => {
    await run()
    const db = new DatabaseSync(databaseFile)
    db.exec(
      `INSERT INTO task_record VALUES ('${requestId}', 'unknown', '结果未知')`
    )
    const history = await service.list()
    expect(history[0].status).toBe("unknown")
    db.close()
  })

  it("bounds retained history", async () => {
    for (let index = 0; index < PI_BENCHMARK_HISTORY_LIMIT + 1; index += 1) {
      const id = `req_history_${String(index).padStart(20, "0")}`
      await run({ ...basePayload, requestId: id })
    }
    expect((await service.list()).length).toBe(PI_BENCHMARK_HISTORY_LIMIT)
  })
})
