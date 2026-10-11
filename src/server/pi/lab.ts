import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { PublicOperationError } from "@server/common/public-error"
import { DATABASE_FILE } from "@server/env"
import {
  type PiLabPayload,
  PiLabPayloadSchema,
  type PiLabResult,
  PiLabResultSchema,
} from "@shared/api-contract/schemas/pi-lab"
import { createPiModelRuntime } from "./benchmark"
import { listPiModels } from "./config"

const MAX_BYTES = 64 * 1024
const RETENTION_MS = 24 * 60 * 60 * 1000
let database: DatabaseSync | null = null
const db = (): DatabaseSync => {
  if (database) return database
  mkdirSync(path.dirname(DATABASE_FILE), { recursive: true })
  database = new DatabaseSync(DATABASE_FILE, { timeout: 5000 })
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS pi_lab_run (
      id TEXT PRIMARY KEY, session_id TEXT, result TEXT NOT NULL, updated_at INTEGER NOT NULL
    );`)
  return database
}

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /key|token|secret|authorization|signature|password/i.test(key) &&
      !/max.*tokens|output.*tokens|input.*tokens/i.test(key)
        ? "[已隐藏]"
        : redact(item),
    ])
  )
}
const stringify = (value: unknown): string =>
  JSON.stringify(redact(value), null, 2).slice(0, 16000)
const save = (run: PiLabResult): void => {
  db()
    .prepare(`INSERT INTO pi_lab_run(id,session_id,result,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET result=excluded.result,updated_at=excluded.updated_at`)
    .run(run.id, run.sessionId, JSON.stringify(run), run.updatedAt)
}
export const readLabRun = (id: string): PiLabResult => {
  const row = db().prepare("SELECT result FROM pi_lab_run WHERE id=?").get(id)
  if (!row) throw new PublicOperationError(404, "没有找到测试台记录")
  const run = PiLabResultSchema.parse(JSON.parse(String(row.result)))
  if (run.status === "running" && Date.now() - run.updatedAt > 70_000) {
    run.status = "unknown"
    run.message = "服务中断或请求超过时限，结果未知"
  }
  return run
}
export const listLabRuns = (): PiLabResult[] => {
  return db()
    .prepare("SELECT id FROM pi_lab_run ORDER BY updated_at DESC LIMIT 50")
    .all()
    .map((row) => readLabRun(String(row.id)))
}
export const cancelLabRun = (id: string): void => {
  const run = readLabRun(id)
  if (run.status !== "running") return
  run.status = "unknown"
  run.message = "已请求中止；上游是否计费无法确认"
  run.updatedAt = Date.now()
  save(run)
}
export const clearLabSession = (sessionId: string): void => {
  const active = listLabRuns().some(
    (run) => run.sessionId === sessionId && run.status === "running"
  )
  if (active)
    throw new PublicOperationError(409, "请先中止活动响应，再清空会话")
  const taskActive = db()
    .prepare(
      "SELECT id FROM task_record WHERE target=? AND status='running' LIMIT 1"
    )
    .get(`pi/session/${sessionId}`)
  if (taskActive)
    throw new PublicOperationError(409, "后台任务仍在结束，请稍后清空会话")
  db().prepare("DELETE FROM pi_lab_run WHERE session_id=?").run(sessionId)
}

export const runPiLab = async (input: unknown): Promise<PiLabResult> => {
  const payload = PiLabPayloadSchema.parse(input)
  const configured = await listPiModels()
  const entry = configured.providers.find(
    (item) => item.id === payload.providerId
  )
  if (!entry?.provider.models.some((item) => item.id === payload.modelId)) {
    throw new PublicOperationError(404, "所选模型不属于配置中的 Provider")
  }
  const sessionId =
    payload.mode === "chat" ? (payload.sessionId ?? randomUUID()) : null
  const run: PiLabResult = {
    id: payload.requestId,
    sessionId,
    mode: payload.mode,
    providerId: payload.providerId,
    modelId: payload.modelId,
    status: "running",
    message: "执行中",
    text: "",
    thinking: "",
    input: stringify({ system: payload.systemPrompt, prompt: payload.prompt }),
    payload: null,
    samples: [],
    updatedAt: Date.now(),
  }
  db()
    .prepare("DELETE FROM pi_lab_run WHERE updated_at < ?")
    .run(Date.now() - RETENTION_MS)
  db()
    .prepare(`DELETE FROM pi_lab_run WHERE id NOT IN (
    SELECT id FROM pi_lab_run ORDER BY updated_at DESC LIMIT 49
  ) AND json_extract(result,'$.status') <> 'running'`)
    .run()
  save(run)
  const controller = new AbortController()
  let resolveAbort: () => void = () => {}
  const aborted = new Promise<null>((resolve) => {
    resolveAbort = () => resolve(null)
  })
  controller.signal.addEventListener("abort", resolveAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), 60_000)
  const cancelTimer = setInterval(() => {
    try {
      if (readLabRun(run.id).status !== "running") controller.abort()
    } catch {
      controller.abort()
    }
  }, 500)
  let lastWrite = 0
  const publish = () => {
    if (Date.now() - lastWrite < 300) return
    lastWrite = Date.now()
    run.updatedAt = Date.now()
    if (readLabRun(run.id).status === "running") save(run)
  }
  try {
    const runtime = await Promise.race([
      createPiModelRuntime(controller.signal),
      aborted,
    ])
    if (!runtime) throw new Error("请求已中止")
    const model = runtime.getModel(payload.providerId, payload.modelId)
    if (!model) throw new PublicOperationError(404, "SDK 中找不到所选模型")
    const history = sessionId
      ? listLabRuns()
          .filter(
            (item) =>
              item.sessionId === sessionId &&
              item.id !== run.id &&
              item.status === "done" &&
              item.providerId === payload.providerId &&
              item.modelId === payload.modelId
          )
          .reverse()
          .slice(-8)
      : []
    const previous = history
      .map((item) => `${item.input}\n助手：${item.text}`)
      .join("\n")
    if (Buffer.byteLength(previous, "utf8") > 24_000) {
      throw new PublicOperationError(400, "会话过长，请清空会话后继续")
    }
    if (
      payload.thinking === "off" &&
      model.thinkingLevelMap?.off === null &&
      payload.mode === "chat"
    ) {
      throw new PublicOperationError(400, "该模型声明不支持关闭 thinking")
    }
    const requests =
      payload.mode === "probe"
        ? [...new Set(payload.tokenCandidates)]
            .slice(0, 2)
            .flatMap((maxTokens) =>
              [...new Set(payload.thinkingCandidates)]
                .slice(0, 2)
                .map((thinking) => ({ maxTokens, thinking }))
            )
        : [{ maxTokens: payload.maxTokens, thinking: payload.thinking }]
    let remainingTokens = 4096
    for (const request of requests) {
      if (controller.signal.aborted || remainingTokens < 16) break
      const maxTokens = Math.min(
        request.maxTokens,
        model.maxTokens,
        remainingTokens
      )
      if (request.thinking === "off" && model.thinkingLevelMap?.off === null) {
        run.samples.push({
          requestedThinking: request.thinking,
          requestedMaxTokens: request.maxTokens,
          sentParameters: null,
          status: "rejected",
          stopReason: "configured_unsupported",
          outputTokens: null,
        })
        continue
      }
      remainingTokens -= maxTokens
      let bytes = 0
      const selected =
        request.thinking === "off" ? { ...model, reasoning: false } : model
      const sample: PiLabResult["samples"][number] = {
        requestedThinking: request.thinking,
        requestedMaxTokens: request.maxTokens,
        sentParameters: null,
        status: "unknown",
        stopReason: null,
        outputTokens: null,
      }
      run.samples.push(sample)
      const stream = runtime.streamSimple(
        selected,
        {
          systemPrompt: payload.systemPrompt,
          messages: [
            {
              role: "user",
              timestamp: Date.now(),
              content: `${previous ? `${previous}\n` : ""}${payload.prompt}`,
            },
          ],
        },
        {
          maxTokens,
          maxRetries: 0,
          timeoutMs: 30_000,
          signal: controller.signal,
          ...(request.thinking === "off"
            ? {}
            : { reasoning: request.thinking }),
          onPayload: (body) => {
            if (controller.signal.aborted) return
            run.payload = stringify(body)
            const parameters =
              body && typeof body === "object"
                ? Object.fromEntries(
                    Object.entries(body).filter(
                      ([key]) =>
                        !["messages", "input", "system", "tools"].includes(key)
                    )
                  )
                : body
            sample.sentParameters = stringify(parameters)
            publish()
          },
        }
      )
      const iterator = stream[Symbol.asyncIterator]()
      while (true) {
        const next = await Promise.race([iterator.next(), aborted])
        if (next === null || next.done) break
        const event = next.value
        if (controller.signal.aborted) break
        if (event.type === "text_delta" || event.type === "thinking_delta") {
          bytes += Buffer.byteLength(event.delta, "utf8")
          if (bytes > MAX_BYTES) {
            controller.abort()
            break
          }
          if (payload.mode === "chat") {
            if (event.type === "text_delta") run.text += event.delta
            else run.thinking += event.delta
          }
          publish()
        } else if (event.type === "done") {
          sample.status = "accepted"
          sample.stopReason = event.reason
          sample.outputTokens = event.message.usage?.output ?? null
        } else if (event.type === "error") {
          sample.status = event.reason === "aborted" ? "unknown" : "rejected"
          sample.stopReason = event.reason
        }
      }
      publish()
      if (sample.status !== "accepted") break
    }
    const truncated = run.samples.some(
      (sample) => sample.stopReason === "length"
    )
    run.status =
      controller.signal.aborted ||
      run.samples.some((sample) => sample.status === "unknown")
        ? "unknown"
        : run.samples.length === requests.length &&
            run.samples.every((sample) => sample.status === "accepted")
          ? truncated
            ? "partial"
            : "done"
          : run.samples.some((sample) => sample.status === "accepted")
            ? "partial"
            : "failed"
    run.message =
      payload.mode === "probe"
        ? "仅核验参数是否发送和请求是否接受；不证明最大生成长度或 thinking 效果"
        : run.status === "done"
          ? "回答完成"
          : "响应未完成或结果未知"
  } catch {
    run.status = controller.signal.aborted ? "unknown" : "failed"
    run.message = controller.signal.aborted
      ? "请求已中止，结果未知"
      : "模型请求未完成，请核对参数与凭据"
  } finally {
    clearTimeout(timer)
    clearInterval(cancelTimer)
    controller.abort()
  }
  run.updatedAt = Date.now()
  const persisted = readLabRun(run.id)
  if (persisted.status === "unknown") {
    run.status = "unknown"
    run.message = persisted.message
  }
  save(run)
  return run
}
export const labTarget = (
  payload: Pick<PiLabPayload, "sessionId" | "providerId" | "modelId">
): string =>
  payload.sessionId
    ? `pi/session/${payload.sessionId}`
    : `pi/lab/${payload.providerId}/${payload.modelId}`
