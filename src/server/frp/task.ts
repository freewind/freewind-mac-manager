import { type ActionResponse, TASK_KINDS } from "@shared/api-contract"
import { frpConfigTaskTarget } from "@shared/task-targets"
import { z } from "zod"
import { saveFrpConfig } from "./service"

export const FRP_SAVE_KIND = TASK_KINDS.frpConfigSave

export { frpConfigTaskTarget }

/** 执行器入参：只接受已解析过的配置结构，不接受模块、命令或 shell 片段。 */
export const SaveFrpPayloadSchema = z.object({
  server: z.record(z.string(), z.unknown()),
  proxies: z.array(z.record(z.string(), z.unknown())),
})

export const runSaveFrpTask = async (options: {
  payload: unknown
  report: (progress: {
    done: number
    total: number | null
    bytesDone: number | null
    bytesTotal: number | null
    stage: string
    currentTarget: string | null
  }) => void
}): Promise<{ result: ActionResponse; message: string }> => {
  const parsed = SaveFrpPayloadSchema.safeParse(options.payload)
  if (!parsed.success) throw new Error("FRP 配置载荷非法")
  options.report({
    done: 0,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: "写入配置",
    currentTarget: null,
  })
  const message = await saveFrpConfig(
    parsed.data as unknown as Parameters<typeof saveFrpConfig>[0]
  )
  options.report({
    done: 1,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: "完成",
    currentTarget: null,
  })
  return { result: { message }, message }
}
