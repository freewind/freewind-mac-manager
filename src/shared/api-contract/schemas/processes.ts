import { z } from "zod"
import { MachineOverviewSchema } from "./dashboard"

/** 进程状态，取自 `ps` 的 STAT 首字母。 */
export const ProcessStateSchema = z.enum([
  "running",
  "sleeping",
  "idle",
  "stopped",
  "zombie",
])

/** 进程归属，由可执行文件路径与父进程推导，仅用于图标与文案。 */
export const ProcessKindSchema = z.enum([
  "kernel",
  "daemon",
  "app",
  "helper",
  "service",
])

/** 一行进程采样。数值语义与 `ps -axo pid,ppid,user,pcpu,rss,state,etime,args` 对齐。 */
export const ProcessEntrySchema = z.object({
  pid: z.number(),
  ppid: z.number(),
  name: z.string(),
  command: z.string(),
  /** 可执行文件路径（命令行的第一个 token）。 */
  path: z.string(),
  user: z.string(),
  state: ProcessStateSchema,
  kind: ProcessKindSchema,
  /** 占单个核心的百分比，多线程进程可超过 100。 */
  cpu: z.number(),
  memoryBytes: z.number(),
  /** 线程数；`ps` 取不到时为 null。 */
  threads: z.number().nullable(),
  /** 正在监听的端口。 */
  ports: z.array(z.number()),
  /** 启动时刻（epoch 秒）。 */
  startedAt: z.number(),
})

/** 进程列表与整机概览来自同一次采样，保证卡片与表格数据自洽。 */
export const ProcessListResponseSchema = z.object({
  processes: z.array(ProcessEntrySchema),
  overview: MachineOverviewSchema,
  /** 服务进程的登录用户，前端用它筛「我的进程」。 */
  currentUser: z.string(),
})
