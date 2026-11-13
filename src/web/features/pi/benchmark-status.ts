import type { PiBenchmarkResult } from "@shared/api-contract"
import { formatToSeconds } from "@shared/format"
import { benchmarkRunningExpired } from "./queries"

/** 失败详情：优先上游原始错误，再带错误类型、停止原因与 requestId。 */
const benchmarkFailureDetail = (record: PiBenchmarkResult): string =>
  [
    record.errorMessage ?? record.message,
    record.error === "provider_error" && record.errorMessage === null
      ? "旧记录没有保存原始错误，重新测速可拿到"
      : null,
    record.error ? `错误类型：${record.error}` : null,
    record.stopReason ? `停止原因：${record.stopReason}` : null,
    `requestId：${record.requestId}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n")

/**
 * 模型行上的测速状态：提交中、测速中、首字耗时或失败原因。
 * 超过服务端上限仍停在 running 的记录不再算「测速中」，也不再阻止重测。
 */
export const benchmarkStatusText = (
  record: PiBenchmarkResult | undefined,
  pending: boolean,
  now: number
): { text: string; failed: boolean; detail?: string } | null => {
  if (pending) return { text: "提交中…", failed: false }
  if (record === undefined) return null
  if (record.status === "running") {
    return benchmarkRunningExpired(record, now)
      ? {
          text: "结果未知",
          failed: true,
          detail: benchmarkFailureDetail(record),
        }
      : { text: "测速中…", failed: false }
  }
  if (record.status === "done") {
    const firstByteMs =
      record.metrics.firstTextMs ?? record.metrics.firstEventMs
    return { text: `首字 ${formatToSeconds(firstByteMs)}`, failed: false }
  }
  return {
    text: record.message,
    failed: true,
    detail: benchmarkFailureDetail(record),
  }
}

/** 每个目标最近一次测速记录；历史按开始时间倒序返回，第一条即最新。 */
export const buildLatestBenchmarkIndex = (
  records: PiBenchmarkResult[]
): Map<string, PiBenchmarkResult> => {
  const latest = new Map<string, PiBenchmarkResult>()
  for (const record of records) {
    const key = `${record.providerId}/${record.modelId}`
    if (!latest.has(key)) latest.set(key, record)
  }
  return latest
}
