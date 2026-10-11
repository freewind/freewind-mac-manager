import { createHash } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import {
  ModelRuntime,
  readStoredCredential,
} from "@earendil-works/pi-coding-agent"
import { PublicOperationError } from "@server/common/public-error"
import { DATABASE_FILE, PI_AGENT_DIR } from "@server/env"
import type {
  PiBenchmarkResult,
  PiBenchmarkTaskPayload,
  TaskProgress,
} from "@shared/api-contract"
import {
  PiBenchmarkDeleteSchema,
  PiBenchmarkResultSchema,
  PiBenchmarkTaskPayloadSchema,
} from "@shared/api-contract/schemas/pi"
import { listPiModels } from "./config"

export const PI_BENCHMARK_HISTORY_LIMIT = 100
export const PI_BENCHMARK_OUTPUT_LIMIT_BYTES = 64 * 1024
export const MAX_BENCHMARK_TIMEOUT_MS = 60_000
const STALE_GRACE_MS = 5_000
const TABLE = "pi_benchmark_record"

export type BenchmarkRuntime = Pick<
  Awaited<ReturnType<typeof ModelRuntime.create>>,
  "getModel" | "streamSimple"
>
type BenchmarkClock = {
  monotonic: () => number
  wall: () => number
  setTimeout: (
    callback: () => void,
    ms: number
  ) => ReturnType<typeof setTimeout>
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void
}
type BenchmarkDependencies = {
  databaseFile: string
  readModels: typeof listPiModels
  createRuntime: (signal: AbortSignal) => Promise<BenchmarkRuntime>
  clock: BenchmarkClock
}
type MutableMetrics = {
  firstEventMs: number | null
  firstTextMs: number | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  textOutputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  totalTokens: number | null
  outputTokensPerSecond: number | null
  thinkingTokens: number | null
}
type Failure = "timeout" | "cancelled" | "provider_error" | "output_limit"
type BenchmarkStatus = "done" | "partial" | "failed" | "unknown"

type UsageSummary = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  reasoning?: number
}

const emptyMetrics = (): MutableMetrics => ({
  firstEventMs: null,
  firstTextMs: null,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  textOutputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  totalTokens: null,
  outputTokensPerSecond: null,
  thinkingTokens: null,
})

export const createPiModelRuntime = async (
  signal: AbortSignal
): Promise<BenchmarkRuntime> => {
  const rawModels: unknown = JSON.parse(
    readFileSync(path.join(PI_AGENT_DIR, "models.json"), "utf8")
  )
  const rejectCommands = (value: unknown): void => {
    if (typeof value === "string" && value.trimStart().startsWith("!")) {
      throw new PublicOperationError(403, "测试台不执行配置中的凭据命令")
    }
    if (Array.isArray(value)) value.forEach(rejectCommands)
    else if (value && typeof value === "object")
      Object.values(value).forEach(rejectCommands)
  }
  rejectCommands(rawModels)
  const authPath = path.join(PI_AGENT_DIR, "auth.json")
  const credentialCache = new Map<
    string,
    Awaited<ReturnType<typeof readStoredCredential>>
  >()
  const credentials = {
    read: async (providerId: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal?.aborted) return undefined
      if (!credentialCache.has(providerId)) {
        credentialCache.set(
          providerId,
          readStoredCredential(providerId, authPath)
        )
      }
      return credentialCache.get(providerId)
    },
    list: async () => [],
    modify: async (
      providerId: string,
      fn: (
        current: Awaited<ReturnType<typeof readStoredCredential>>
      ) => Promise<Awaited<ReturnType<typeof readStoredCredential>>>,
      options?: { signal?: AbortSignal }
    ) => {
      if (options?.signal?.aborted) return undefined
      const current = credentialCache.has(providerId)
        ? credentialCache.get(providerId)
        : readStoredCredential(providerId, authPath)
      const next = await fn(current)
      if (next !== undefined) credentialCache.set(providerId, next)
      return credentialCache.get(providerId) ?? current
    },
    delete: async () => undefined,
  }
  const modelsStore = {
    read: async () => undefined,
    write: async () => undefined,
    delete: async () => undefined,
  }
  return ModelRuntime.create({
    credentials,
    modelsStore,
    authPath,
    modelsPath: path.join(PI_AGENT_DIR, "models.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
    signal,
  })
}

const initDatabase = (file: string): DatabaseSync => {
  mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file, { timeout: 5000 })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      thinking_level TEXT NOT NULL,
      configured_max_tokens INTEGER NOT NULL,
      status TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      stop_reason TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pi_benchmark_history
      ON ${TABLE} (started_at DESC);
  `)
  return db
}

const metricsFromUsage = (
  usage: UsageSummary | null | undefined,
  metrics: MutableMetrics
): void => {
  if (!usage) return
  metrics.inputTokens = usage.input
  metrics.outputTokens = usage.output
  metrics.cacheReadTokens = usage.cacheRead
  metrics.cacheWriteTokens = usage.cacheWrite
  metrics.totalTokens = usage.totalTokens
  metrics.thinkingTokens = usage.reasoning ?? null
  metrics.textOutputTokens =
    usage.reasoning === undefined
      ? null
      : Math.max(0, usage.output - usage.reasoning)
}

const insertRunning = (
  db: DatabaseSync,
  payload: PiBenchmarkTaskPayload,
  startedAt: number
): void => {
  db.prepare(`
    INSERT INTO ${TABLE} (
      id, provider_id, model_id, thinking_level, configured_max_tokens,
      status, metrics_json, started_at
    ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)
  `).run(
    payload.requestId,
    payload.providerId,
    payload.modelId,
    payload.thinkingLevel,
    payload.maxTokens,
    JSON.stringify(emptyMetrics()),
    startedAt
  )
}

export const piBenchmarkErrorMessage = (reason: Failure | null): string => {
  switch (reason) {
    case "timeout":
      return "Pi 模型测速超时，结果未知"
    case "cancelled":
      return "Pi 模型测速已中断，结果未知"
    case "output_limit":
      return "Pi 模型输出超过安全上限"
    case "provider_error":
      return "Pi 模型服务请求失败"
    case null:
      return "Pi 模型测速结果未知，请按请求标识核实"
  }
}

const resultMessage = (status: BenchmarkStatus | "running"): string => {
  switch (status) {
    case "done":
      return "测速完成"
    case "partial":
      return "测速部分完成"
    case "failed":
      return "测速失败"
    case "unknown":
      return "测速结果未知"
    case "running":
      return "测速中"
  }
}

const updateRecord = (db: DatabaseSync, result: PiBenchmarkResult): void => {
  db.prepare(`
    UPDATE ${TABLE} SET status = ?, metrics_json = ?, stop_reason = ?,
      error = ?, finished_at = ? WHERE id = ? AND status = 'running'
  `).run(
    result.status,
    JSON.stringify(result.metrics),
    result.stopReason,
    result.error,
    result.finishedAt,
    result.id
  )
  db.prepare(`
    DELETE FROM ${TABLE}
    WHERE id NOT IN (
      SELECT id FROM ${TABLE} ORDER BY started_at DESC, id DESC LIMIT ?
    ) AND status <> 'running'
  `).run(PI_BENCHMARK_HISTORY_LIMIT)
}

const listRecords = (db: DatabaseSync, now: number): PiBenchmarkResult[] => {
  const rows = db
    .prepare(`
    SELECT benchmark.*,
      CASE
        WHEN benchmark.status = 'running' AND benchmark.started_at < ? THEN 'unknown'
        WHEN task_record.status = 'unknown' THEN 'unknown'
        WHEN task_record.status = 'failed' THEN 'failed'
        WHEN task_record.status IN ('done', 'partial') THEN task_record.status
        ELSE benchmark.status
      END AS effective_status,
      CASE
        WHEN benchmark.status = 'running' AND benchmark.started_at < ? THEN 'cancelled'
        WHEN task_record.status = 'unknown' THEN 'cancelled'
        WHEN task_record.status = 'failed' THEN 'provider_error'
        ELSE benchmark.error
      END AS effective_error
    FROM ${TABLE} AS benchmark
    LEFT JOIN task_record ON task_record.request_id = benchmark.id
    ORDER BY benchmark.started_at DESC, benchmark.id DESC LIMIT ?
  `)
    .all(
      now - MAX_BENCHMARK_TIMEOUT_MS - STALE_GRACE_MS,
      now - MAX_BENCHMARK_TIMEOUT_MS - STALE_GRACE_MS,
      PI_BENCHMARK_HISTORY_LIMIT
    ) as Record<string, unknown>[]
  return rows.map((row) => {
    const rawStatus = String(row.effective_status)
    const benchmarkStatus = (
      rawStatus === "running" ||
      rawStatus === "done" ||
      rawStatus === "partial" ||
      rawStatus === "failed" ||
      rawStatus === "unknown"
        ? rawStatus
        : "unknown"
    ) as BenchmarkStatus | "running"
    return PiBenchmarkResultSchema.parse({
      message: resultMessage(benchmarkStatus),
      id: row.id,
      requestId: row.id,
      providerId: row.provider_id,
      modelId: row.model_id,
      thinkingLevel: row.thinking_level,
      configuredMaxTokens: row.configured_max_tokens,
      status: benchmarkStatus,
      metrics: JSON.parse(String(row.metrics_json)),
      stopReason: row.stop_reason,
      error:
        row.effective_error === "timeout" ||
        row.effective_error === "output_limit" ||
        row.effective_error === "provider_error"
          ? row.effective_error
          : row.effective_error === "cancelled"
            ? "cancelled"
            : null,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      source: "pi-sdk",
    })
  })
}

const progressOf = (metrics: MutableMetrics, stage: string): TaskProgress => ({
  done: metrics.firstTextMs === null ? 0 : 1,
  total: 1,
  bytesDone: null,
  bytesTotal: null,
  stage,
  currentTarget: null,
})

export const createPiBenchmarkService = (
  overrides: Partial<BenchmarkDependencies> = {}
) => {
  const databaseFile = overrides.databaseFile ?? DATABASE_FILE
  const db = initDatabase(databaseFile)
  const dependencies: BenchmarkDependencies = {
    databaseFile,
    readModels: listPiModels,
    createRuntime: createPiModelRuntime,
    clock: {
      monotonic: () => performance.now(),
      wall: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (timer) => clearTimeout(timer),
    },
    ...overrides,
  }

  const run = async (
    rawPayload: unknown,
    options: { report: (progress: TaskProgress) => void }
  ): Promise<PiBenchmarkResult> => {
    const parsedPayload = PiBenchmarkTaskPayloadSchema.safeParse(rawPayload)
    if (!parsedPayload.success)
      throw new PublicOperationError(400, "Pi 测速载荷无效")
    const payload = parsedPayload.data
    const startedAt = dependencies.clock.wall()
    if (payload.timeoutMs > MAX_BENCHMARK_TIMEOUT_MS) {
      throw new PublicOperationError(400, "测速时限超过允许上限")
    }
    const modelConfig = await dependencies.readModels()
    const provider = modelConfig.providers.find(
      (entry) => entry.id === payload.providerId
    )
    const configuredModel = provider?.provider.models.find(
      (entry) => entry.id === payload.modelId
    )
    if (!provider || !configuredModel)
      throw new PublicOperationError(404, "Pi Provider 或模型不存在")
    const configuredMaxTokens = configuredModel.maxTokens
    if (!configuredMaxTokens || configuredMaxTokens < 1) {
      throw new PublicOperationError(
        400,
        "所选模型未声明 maxTokens，无法安全发起测速"
      )
    }
    if (Buffer.byteLength(payload.prompt, "utf8") > 4096) {
      throw new PublicOperationError(400, "测速输入超过 4096 字节")
    }
    insertRunning(db, { ...payload, maxTokens: configuredMaxTokens }, startedAt)

    let start = dependencies.clock.monotonic()
    const metrics = emptyMetrics()
    const controller = new AbortController()
    let abortReason: "timeout" | "cancelled" | null = null
    let resolveTimeout: (() => void) | undefined
    const timeoutSignal = new Promise<void>((resolve) => {
      resolveTimeout = resolve
    })
    const modelTimer = dependencies.clock.setTimeout(() => {
      abortReason = "timeout"
      controller.abort()
      resolveTimeout?.()
    }, payload.timeoutMs)
    let textBytes = 0
    let stopReason: string | null = null
    let finalStatus: BenchmarkStatus = "failed"
    let failure: Failure | null = null
    try {
      const runtime = await Promise.race([
        dependencies.createRuntime(controller.signal),
        timeoutSignal.then(() => null),
      ])
      if (!runtime) throw new Error("测速初始化超时")
      if (controller.signal.aborted) throw new Error("测速已取消")
      const model = runtime.getModel(payload.providerId, payload.modelId)
      if (!model) throw new PublicOperationError(404, "Pi SDK 未加载所选模型")
      start = dependencies.clock.monotonic()
      const effectiveModel =
        payload.thinkingLevel === "off" ? { ...model, reasoning: false } : model
      const stream = runtime.streamSimple(
        effectiveModel,
        {
          messages: [
            {
              role: "user",
              content: payload.prompt,
              timestamp: dependencies.clock.wall(),
            },
          ],
        },
        {
          maxTokens: Math.min(configuredMaxTokens, 4096),
          ...(payload.thinkingLevel === "off"
            ? {}
            : { reasoning: payload.thinkingLevel }),
          signal: controller.signal,
          timeoutMs: payload.timeoutMs,
          maxRetries: 0,
          onProviderStreamEvent: () => {
            if (metrics.firstEventMs === null) {
              metrics.firstEventMs = dependencies.clock.monotonic() - start
            }
          },
        }
      )
      const iterator = stream[Symbol.asyncIterator]()
      while (true) {
        const next = await Promise.race([
          iterator.next().then((value) => ({ type: "event" as const, value })),
          timeoutSignal.then(() => ({ type: "timeout" as const })),
        ])
        if (next.type === "timeout") {
          failure = "timeout"
          finalStatus = "unknown"
          stopReason = "timeout"
          const cleanup = iterator.return?.()
          if (cleanup) void cleanup.catch(() => undefined)
          break
        }
        if (next.value.done) break
        const event = next.value.value
        if (event.type === "thinking_delta" && event.delta.length > 0) {
          metrics.firstEventMs ??= dependencies.clock.monotonic() - start
          textBytes += Buffer.byteLength(event.delta, "utf8")
          if (textBytes > PI_BENCHMARK_OUTPUT_LIMIT_BYTES) {
            failure = "output_limit"
            finalStatus = "partial"
            stopReason = "output_limit"
            controller.abort()
            break
          }
        } else if (event.type === "text_delta" && event.delta.length > 0) {
          if (metrics.firstEventMs === null) {
            metrics.firstEventMs = dependencies.clock.monotonic() - start
          }
          if (metrics.firstTextMs === null)
            metrics.firstTextMs = dependencies.clock.monotonic() - start
          textBytes += Buffer.byteLength(event.delta, "utf8")
          if (textBytes > PI_BENCHMARK_OUTPUT_LIMIT_BYTES) {
            failure = "output_limit"
            finalStatus = "partial"
            stopReason = "output_limit"
            controller.abort()
            break
          }
          options.report(
            progressOf(
              metrics,
              `已收到正文；首事件 ${metrics.firstEventMs.toFixed(0)} ms，首正文 ${metrics.firstTextMs.toFixed(0)} ms`
            )
          )
        } else if (event.type === "done") {
          stopReason = event.reason
          metricsFromUsage(event.message.usage, metrics)
          finalStatus = event.reason === "length" ? "partial" : "done"
        } else if (event.type === "error") {
          if (event.reason === "aborted") {
            failure = abortReason ?? "cancelled"
            finalStatus = "unknown"
          } else {
            failure = "provider_error"
            finalStatus = "failed"
          }
          metricsFromUsage(event.error.usage, metrics)
          stopReason = event.error.stopReason
        }
      }
      if (failure === "output_limit") {
        finalStatus = "partial"
        stopReason = "output_limit"
      } else if (
        controller.signal.aborted &&
        finalStatus !== "done" &&
        finalStatus !== "partial"
      ) {
        failure = abortReason ?? "cancelled"
        finalStatus = "unknown"
      } else if (failure !== null && finalStatus !== "unknown") {
        finalStatus = "failed"
      }
    } catch {
      failure =
        abortReason ??
        (controller.signal.aborted ? "timeout" : "provider_error")
      finalStatus = failure === "timeout" ? "unknown" : "failed"
    } finally {
      dependencies.clock.clearTimeout(modelTimer)
    }
    metrics.durationMs = dependencies.clock.monotonic() - start
    if (
      metrics.textOutputTokens !== null &&
      metrics.firstTextMs !== null &&
      metrics.durationMs > metrics.firstTextMs
    ) {
      metrics.outputTokensPerSecond =
        metrics.textOutputTokens /
        ((metrics.durationMs - metrics.firstTextMs) / 1000)
    }
    const result = PiBenchmarkResultSchema.parse({
      message: resultMessage(finalStatus),
      id: payload.requestId,
      requestId: payload.requestId,
      providerId: payload.providerId,
      modelId: payload.modelId,
      thinkingLevel: payload.thinkingLevel,
      configuredMaxTokens,
      status: finalStatus,
      metrics,
      stopReason,
      error: failure,
      startedAt,
      finishedAt: dependencies.clock.wall(),
      source: "pi-sdk",
    })
    updateRecord(db, result)
    options.report(
      progressOf(
        metrics,
        `测速${finalStatus}；输出上限 ${configuredMaxTokens} tokens`
      )
    )
    return result
  }

  return {
    run,
    list: () => listRecords(db, dependencies.clock.wall()),
    delete: (input: unknown) => {
      const parsed = PiBenchmarkDeleteSchema.safeParse(input)
      if (!parsed.success)
        throw new PublicOperationError(400, "测速历史删除参数无效")
      const placeholders = parsed.data.ids.map(() => "?").join(",")
      return Number(
        db
          .prepare(`DELETE FROM ${TABLE} WHERE id IN (${placeholders})`)
          .run(...parsed.data.ids).changes
      )
    },
    close: () => db.close(),
  }
}

let defaultService: ReturnType<typeof createPiBenchmarkService> | null = null

const getDefaultService = (): ReturnType<typeof createPiBenchmarkService> => {
  defaultService ??= createPiBenchmarkService()
  return defaultService
}

export const runPiBenchmarkTask = (
  payload: unknown,
  options: { report: (progress: TaskProgress) => void }
): Promise<PiBenchmarkResult> => getDefaultService().run(payload, options)

export const listPiBenchmarks = (): PiBenchmarkResult[] =>
  getDefaultService().list()

export const deletePiBenchmarks = (input: unknown): number =>
  getDefaultService().delete(input)

export const piBenchmarkTarget = (
  providerId: string,
  modelId: string
): string =>
  `pi/benchmark/${createHash("sha256").update(`${providerId}\n${modelId}`).digest("hex").slice(0, 32)}`
