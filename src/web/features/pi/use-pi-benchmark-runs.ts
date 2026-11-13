import type { PiBenchmarkResult } from "@shared/api-contract"
import {
  ApiRequestError,
  newRequestId,
  startPiBenchmark,
} from "@shared/client-api"
import { useQueryClient } from "@tanstack/react-query"
import {
  forgetPendingRequest,
  rememberPendingRequest,
} from "@web/features/tasks/pending-requests"
import { useState } from "react"
import { toast } from "sonner"
import { benchmarkRunningExpired, piKeys } from "./queries"

export type BenchmarkRunTarget = {
  providerId: string
  modelId: string
}

/**
 * Pi 页的首字测速编排：登记待核实请求、并发提交、轮询补齐终态，
 * 并派生「提交中或运行中」的目标集合供按钮禁用。
 */
export const usePiBenchmarkRuns = (options: {
  /** 最新测速历史（按开始时间倒序），用于推导运行中的目标。 */
  benchmarkRecords: PiBenchmarkResult[]
}) => {
  const queryClient = useQueryClient()
  /** 已发出但还没拿到回执的测速目标，键为 `provider/model`。 */
  const [pendingTargets, setPendingTargets] = useState<string[]>([])

  /** 提交一个目标的首字测速：先登记待核实请求，再发送。 */
  const submitBenchmark = async (target: BenchmarkRunTarget): Promise<void> => {
    const { providerId, modelId } = target
    const requestId = newRequestId()
    const label = `Pi ${providerId}/${modelId}`
    rememberPendingRequest({
      requestId,
      kind: "pi_benchmark",
      target: label,
      startedAt: Date.now(),
      taskId: null,
    })
    try {
      const result = await startPiBenchmark(
        { providerId, modelId, thinkingLevel: "medium" },
        requestId
      )
      if (result.kind === "completed") {
        forgetPendingRequest({ requestId })
        if (result.body.status !== "done") toast.error(result.body.message)
        return
      }
      // 已受理：终态由测速历史轮询补齐，待核实记录保留到确认完成。
      rememberPendingRequest({
        requestId,
        kind: "pi_benchmark",
        target: label,
        startedAt: result.body.startedAt * 1000,
        taskId: result.body.taskId,
      })
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.resultUnknown &&
        error.requestId
      ) {
        toast.error("测速响应未知，正在通过请求标识核实任务")
        return
      }
      toast.error(error instanceof Error ? error.message : "测速未完成")
    }
  }

  /** 并发提交多个目标，避免逐个等回执拖长整体时间。 */
  const runBenchmarks = async (
    targets: BenchmarkRunTarget[]
  ): Promise<void> => {
    if (targets.length === 0) return
    const keys = targets.map(
      (target) => `${target.providerId}/${target.modelId}`
    )
    setPendingTargets((current) => [...new Set([...current, ...keys])])
    await Promise.all(targets.map((target) => submitBenchmark(target)))
    await queryClient.invalidateQueries({ queryKey: piKeys.benchmarks() })
    setPendingTargets((current) => current.filter((key) => !keys.includes(key)))
  }

  const now = Date.now()
  /** 提交中或运行中的目标：这些目标的按钮不再允许重复提交。 */
  const busyBenchmarkKeys = new Set([
    ...pendingTargets,
    ...options.benchmarkRecords
      .filter(
        (record) =>
          record.status === "running" && !benchmarkRunningExpired(record, now)
      )
      .map((record) => `${record.providerId}/${record.modelId}`),
  ])

  return { pendingTargets, runBenchmarks, busyBenchmarkKeys, now }
}
