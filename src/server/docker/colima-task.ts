import { PublicOperationError } from "@server/common/public-error"
import {
  type ActionResponse,
  TASK_KINDS,
  type TaskProgress,
} from "@shared/api-contract"
import { dockerColimaTaskTarget } from "@shared/task-targets"
import { z } from "zod"
import { type DockerCli, dockerCli } from "./cli"

/** Colima 动作单独一种任务种类：作用域是整台虚拟机，与容器动作不共享锁。 */
export const COLIMA_ACTION_KIND = TASK_KINDS.dockerColimaAction

/**
 * 载荷只有动作枚举：不接受命令、参数或任何可透传字段。
 * 真正的 colima 调用由执行层按固定参数拼装。
 */
export const ColimaActionPayloadSchema = z
  .object({ action: z.enum(["start", "stop", "restart"]) })
  .strict()

export type ColimaActionPayload = z.infer<typeof ColimaActionPayloadSchema>

/** 执行器只需要这几个能力，测试可以只实现它们。 */
export type ColimaActionCli = Pick<
  DockerCli,
  "startColima" | "stopColima" | "getColimaStatus"
>

/** colima start/stop 返回后状态可能还会滞后一小会儿，给几次确认机会。 */
const VERIFY_ATTEMPTS = 3
const VERIFY_DELAY_MS = 500

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * 以 colima status 的核实结果为准：命令退出码为 0 不等于虚拟机真的起来了，
 * 状态没变就如实报错，不谎报成功。
 */
const verifyRunning = async (
  cli: ColimaActionCli,
  expectRunning: boolean
): Promise<void> => {
  let status = await cli.getColimaStatus()
  for (
    let attempt = 1;
    attempt < VERIFY_ATTEMPTS && status.running !== expectRunning;
    attempt += 1
  ) {
    await delay(VERIFY_DELAY_MS)
    status = await cli.getColimaStatus()
  }
  if (status.running === expectRunning) return
  throw new PublicOperationError(
    500,
    expectRunning
      ? `Colima 未能进入运行状态（当前：${status.status}），请重新读取状态确认`
      : `Colima 未能停止（当前：${status.status}），请重新读取状态确认`
  )
}

export const runColimaActionTask = async (options: {
  payload: unknown
  report: (progress: TaskProgress) => void
  /** 默认生产实例；测试注入受控替身。 */
  cli?: ColimaActionCli
}): Promise<{ result: ActionResponse; message: string }> => {
  const parsed = ColimaActionPayloadSchema.safeParse(options.payload)
  if (!parsed.success) throw new Error("Colima 动作载荷非法")
  const { action } = parsed.data
  const cli = options.cli ?? dockerCli
  const target = dockerColimaTaskTarget()
  const report = (stage: string): void =>
    options.report({
      done: 0,
      total: 1,
      bytesDone: null,
      bytesTotal: null,
      stage,
      currentTarget: target,
    })

  let message: string
  if (action === "start") {
    report("正在启动 Colima 虚拟机")
    await cli.startColima()
    report("正在等待 Colima 就绪")
    await verifyRunning(cli, true)
    message = "Colima 已启动"
  } else if (action === "stop") {
    report("正在停止 Colima 虚拟机")
    await cli.stopColima()
    report("正在等待 Colima 停止")
    await verifyRunning(cli, false)
    message = "Colima 已停止"
  } else {
    // Colima 没有 restart 子命令：先停再起，顺序不能颠倒
    report("正在停止 Colima 虚拟机")
    await cli.stopColima()
    report("正在等待 Colima 停止")
    await verifyRunning(cli, false)
    report("正在启动 Colima 虚拟机")
    await cli.startColima()
    report("正在等待 Colima 就绪")
    await verifyRunning(cli, true)
    message = "Colima 已重启"
  }

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
