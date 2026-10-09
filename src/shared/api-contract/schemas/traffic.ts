import { z } from "zod"

/** 展开后的明细行：某个进程名下的具体脚本与启动者。 */
export const TrafficChildSchema = z.object({
  label: z.string(),
  scriptName: z.string(),
  parent: z.string(),
  pids: z.array(z.number().int().max(999999)).max(64),
  ports: z.array(z.number().int()),
  running: z.boolean(),
  bytesIn: z.number().int().nonnegative(),
  bytesOut: z.number().int().nonnegative(),
  command: z.string(),
})

/** 折叠状态下的一行：按进程名聚合。 */
export const TrafficGroupSchema = z.object({
  name: z.string(),
  bytesIn: z.number().int().nonnegative(),
  bytesOut: z.number().int().nonnegative(),
  children: z.array(TrafficChildSchema),
})

/** 一份增量快照：覆盖 [fromAt, toAt) 区间内各进程新增的流量。 */
export const TrafficSnapshotSchema = z.object({
  id: z.string(),
  savedAt: z.number().int(),
  fromAt: z.number().int(),
  toAt: z.number().int(),
  rangeText: z.string(),
  savedBy: z.enum(["scheduled", "manual"]),
  bytesIn: z.number().int().nonnegative(),
  bytesOut: z.number().int().nonnegative(),
  groups: z.array(TrafficGroupSchema),
})

export const TrafficStatusSchema = z.object({
  running: z.boolean(),
  intervalSeconds: z.number(),
  sampledAt: z.number().int().nullable(),
  downloadRate: z.number().nonnegative(),
  uploadRate: z.number().nonnegative(),
})

export const TrafficSnapshotsResponseSchema = z.object({
  snapshots: z.array(TrafficSnapshotSchema),
})

export const TrafficSnapshotResponseSchema = z.object({
  snapshot: TrafficSnapshotSchema,
})

/** query 里的 id 数组：普通 query string 下可能是单值或重复键。 */
const idListQuery = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))

/** 读进程明细：传快照 id 列表（多选即合计），或 realtime=1 看当前。 */
export const TrafficGroupsQuerySchema = z.object({
  ids: idListQuery.optional(),
  realtime: z.string().optional(),
})

export const TrafficGroupsResponseSchema = z.object({
  scope: z.string(),
  groups: z.array(TrafficGroupSchema),
})

export const MergeSnapshotsBodySchema = z.object({
  ids: z.array(z.string()).min(2),
})

export const DeleteSnapshotsQuerySchema = z.object({
  ids: idListQuery,
})
