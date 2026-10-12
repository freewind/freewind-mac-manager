import { z } from "zod"

export const SystemInfoSchema = z.object({
  hostname: z.string(),
  model: z.string(),
  chip: z.string(),
  osVersion: z.string(),
  uptimeSeconds: z.number(),
  userCount: z.number(),
})

export const CpuInfoSchema = z.object({
  loadAverage: z.array(z.number()),
  coreCount: z.number(),
  coreUsage: z.array(z.number()),
})

export const MemoryInfoSchema = z.object({
  total: z.number(),
  used: z.number(),
  wired: z.number(),
  compressed: z.number(),
  free: z.number(),
  swapTotal: z.number(),
  swapUsed: z.number(),
})

export const DiskVolumeSchema = z.object({
  name: z.string(),
  mount: z.string(),
  total: z.number(),
  used: z.number(),
  free: z.number(),
})

export const NetworkInfoSchema = z.object({
  interfaceName: z.string(),
  address: z.string(),
  downloadRate: z.number(),
  uploadRate: z.number(),
  totalDown: z.number(),
  totalUp: z.number(),
})

/** sampledAt 为毫秒时间戳。 */
export const MachineOverviewSchema = z.object({
  sampledAt: z.number(),
  system: SystemInfoSchema,
  cpu: CpuInfoSchema,
  memory: MemoryInfoSchema,
  disk: z.array(DiskVolumeSchema),
  network: NetworkInfoSchema,
})

/**
 * 概览页的机器状态：机器概览 + 该页自动刷新的秒数。
 *
 * 刷新秒数由服务端定义并随响应返回，前端轮询与文案都读它，避免前后端各写一份。
 * 进程列表与监听端口是另外两个端点，各自有自己的节奏，这里不带。
 */
export const DashboardOverviewSchema = MachineOverviewSchema.extend({
  refreshIntervalSeconds: z.number().int().positive(),
})

export const ProcessInfoSchema = z.object({
  pid: z.number(),
  name: z.string(),
  user: z.string(),
  cpu: z.number(),
  memory: z.number(),
  command: z.string(),
})

export const PortInfoSchema = z.object({
  port: z.number(),
  process: z.string(),
  pid: z.number(),
  address: z.string(),
})

export const ProcessesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(6),
})

export const ProcessesResponseSchema = z.object({
  processes: z.array(ProcessInfoSchema),
})

export const PortsResponseSchema = z.object({
  ports: z.array(PortInfoSchema),
})
