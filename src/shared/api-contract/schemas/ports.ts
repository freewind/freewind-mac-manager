import { z } from "zod"

export const PortProtocolSchema = z.enum(["TCP", "UDP"])

export const PortFamilySchema = z.enum(["IPv4", "IPv6"])

/** 套接字状态：LISTEN 监听中，ESTABLISHED 已建立连接，UDP 无连接。 */
export const PortStateSchema = z.enum(["LISTEN", "ESTABLISHED", "UDP"])

/** 一个套接字绑定，字段对应 lsof 的一行。 */
export const PortBindingSchema = z.object({
  key: z.string(),
  /** 端口号：监听套接字取本机端口，已建立连接取对端服务端口。 */
  port: z.number().int().positive(),
  protocol: PortProtocolSchema,
  family: PortFamilySchema,
  /** 本机套接字地址，如 `127.0.0.1`、`*`、`[::1]`、`192.168.1.8:52344`。 */
  address: z.string(),
  /** 已建立连接的对端地址；监听套接字为 null。 */
  peer: z.string().nullable(),
  state: PortStateSchema,
  pid: z.number().int().positive(),
  processName: z.string(),
  user: z.string(),
  /** 启动者：父进程名，父进程为 launchd 时即 launchd。 */
  startedBy: z.string(),
  command: z.string(),
  /** 进程工作目录，取不到时为空串。 */
  cwd: z.string(),
  /** 进程启动时间（epoch 秒）。 */
  startedAt: z.number().int(),
})

export const PortBindingsResponseSchema = z.object({
  bindings: z.array(PortBindingSchema),
})

export const KillPortProcessesBodySchema = z.object({
  port: z.number().int().positive(),
  pids: z.array(z.number().int().positive().max(999999)).min(1).max(64),
})

export const KillPortProcessResultSchema = z.object({
  pid: z.number().int(),
  succeeded: z.boolean(),
  message: z.string(),
})

export const KillPortProcessesResponseSchema = z.object({
  results: z.array(KillPortProcessResultSchema),
})
