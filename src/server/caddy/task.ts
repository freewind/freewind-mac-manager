import { PublicOperationError } from "@server/common/public-error"
import { TASK_KINDS, type TaskProgress } from "@shared/api-contract"
import { caddyConfigTaskTarget } from "@shared/task-targets"
import { z } from "zod"
import {
  applyCaddyRules,
  type CaddyApplyOptions,
  type CaddyApplyOutcome,
  CaddyUnknownResultError,
} from "./apply"
import { getCaddyStore } from "./store"

export const CADDY_APPLY_KIND = TASK_KINDS.caddyConfigApply

export { caddyConfigTaskTarget }

/**
 * 应用任务的载荷：只允许「按当前规则应用」或「恢复到某个历史版本」，
 * 不接受路径、命令或规则内容——规则只从数据库读。
 */
export const CaddyApplyPayloadSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("apply"), expectedSignature: z.string().min(1) }),
  z.object({ mode: z.literal("restore"), versionId: z.string().min(1) }),
])

export type CaddyApplyPayload = z.infer<typeof CaddyApplyPayloadSchema>

/** 应用依赖；生产用默认实现，测试注入临时目标、替身与临时库。 */
export type CaddyApplyDeps = Omit<
  CaddyApplyOptions,
  "expectedSignature" | "rules" | "report"
>

export type CaddyApplyTaskOutcome = CaddyApplyOutcome & { error: string | null }

/**
 * 任务侧入口。
 *
 * 恢复模式先把历史版本的规则写回数据库，再走同一条应用流程：这样「文件里
 * 写什么」永远由数据库决定，恢复与应用不会各写一套。
 */
export const runCaddyApplyTask = async (options: {
  payload: unknown
  report: (progress: TaskProgress) => void
  deps?: CaddyApplyDeps
}): Promise<CaddyApplyTaskOutcome> => {
  const parsed = CaddyApplyPayloadSchema.safeParse(options.payload)
  if (!parsed.success) throw new Error("Caddy 应用载荷非法")
  const deps = options.deps ?? {}

  if (parsed.data.mode === "restore") {
    const store = deps.store ?? getCaddyStore()
    const version = store.findApplyRecord(parsed.data.versionId)
    if (version === null) {
      throw new PublicOperationError(404, "找不到要恢复的版本")
    }
    store.replaceAllRules(version.rules)
  }

  try {
    const outcome = await applyCaddyRules({
      ...deps,
      ...(parsed.data.mode === "apply"
        ? { expectedSignature: parsed.data.expectedSignature }
        : {}),
      report: options.report,
    })
    return {
      result: outcome.result,
      message: outcome.message,
      status: outcome.status,
      error: outcome.status === "unknown" ? outcome.message : null,
    }
  } catch (error) {
    // reload 超时：文件已写入但结果无法确认，按 unknown 返回而不是当成失败。
    if (error instanceof CaddyUnknownResultError) {
      return {
        result: error.outcome.result,
        message: error.outcome.message,
        status: "unknown",
        error: error.outcome.message,
      }
    }
    throw error
  }
}
