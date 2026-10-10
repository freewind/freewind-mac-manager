import type { z } from "zod"
import type {
  ActionResponseSchema,
  ApiErrorSchema,
  KillProcessesBodySchema,
  KillProcessesResponseSchema,
  TaskAcceptedSchema,
} from "./schemas/common"
import type {
  EntriesResponseSchema,
  GrowthEntrySchema,
  ScanSnapshotSchema,
  ScanStartResponseSchema,
  ScanStatusSchema,
  ScansResponseSchema,
  ScanTaskResultSchema,
  TreeNodeWire,
  TreeResponseSchema,
} from "./schemas/disk-growth"
import type {
  DirectoryResponseSchema,
  FileBatchResultSchema,
  FileContentResponseSchema,
  FileEntrySchema,
  UploadResponseSchema,
} from "./schemas/files"
import type {
  TaskListQuerySchema,
  TaskListResponseSchema,
  TaskProgressSchema,
  TaskStatusSchema,
} from "./schemas/tasks"
export type ScanSnapshot = z.infer<typeof ScanSnapshotSchema>
export type GrowthEntry = z.infer<typeof GrowthEntrySchema>
export type ScanStatus = z.infer<typeof ScanStatusSchema>
export type ScansResponse = z.infer<typeof ScansResponseSchema>
export type EntriesResponse = z.infer<typeof EntriesResponseSchema>
export type ScanStartResponse = z.infer<typeof ScanStartResponseSchema>

import type {
  TrafficChildSchema,
  TrafficGroupSchema,
  TrafficGroupsResponseSchema,
  TrafficSnapshotResponseSchema,
  TrafficSnapshotSchema,
  TrafficSnapshotsResponseSchema,
  TrafficStatusSchema,
} from "./schemas/traffic"

export type TrafficChild = z.infer<typeof TrafficChildSchema>
export type TrafficGroup = z.infer<typeof TrafficGroupSchema>
export type TrafficSnapshot = z.infer<typeof TrafficSnapshotSchema>
export type TrafficStatus = z.infer<typeof TrafficStatusSchema>
export type TrafficSnapshotsResponse = z.infer<
  typeof TrafficSnapshotsResponseSchema
>
export type TrafficSnapshotResponse = z.infer<
  typeof TrafficSnapshotResponseSchema
>
export type TrafficGroupsResponse = z.infer<typeof TrafficGroupsResponseSchema>
export type KillProcessesBody = z.infer<typeof KillProcessesBodySchema>
export type KillProcessesResponse = z.infer<typeof KillProcessesResponseSchema>

export type ApiError = z.infer<typeof ApiErrorSchema>
export type ActionResponse = z.infer<typeof ActionResponseSchema>
export type TaskAccepted = z.infer<typeof TaskAcceptedSchema>
export type TaskProgress = z.infer<typeof TaskProgressSchema>
export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>
export type FileBatchResult = z.infer<typeof FileBatchResultSchema>
export type ScanTaskResult = z.infer<typeof ScanTaskResultSchema>
/** 任务记录与种类只在 schemas/tasks.ts 定义一份，这里只转发。 */
export type { TaskKind, TaskRecord } from "./schemas/tasks"
export type TreeResponse = z.infer<typeof TreeResponseSchema>
export type TreeNode = TreeNodeWire
export type FileEntry = z.infer<typeof FileEntrySchema>
export type DirectoryResponse = z.infer<typeof DirectoryResponseSchema>
export type FileContentResponse = z.infer<typeof FileContentResponseSchema>
export type UploadResponse = z.infer<typeof UploadResponseSchema>

import type {
  CpuInfoSchema,
  DiskVolumeSchema,
  MachineOverviewSchema,
  MemoryInfoSchema,
  NetworkInfoSchema,
  PortInfoSchema,
  PortsResponseSchema,
  ProcessesResponseSchema,
  ProcessInfoSchema,
  SystemInfoSchema,
} from "./schemas/dashboard"

export type SystemInfo = z.infer<typeof SystemInfoSchema>
export type CpuInfo = z.infer<typeof CpuInfoSchema>
export type MemoryInfo = z.infer<typeof MemoryInfoSchema>
export type DiskVolume = z.infer<typeof DiskVolumeSchema>
export type NetworkInfo = z.infer<typeof NetworkInfoSchema>
export type MachineOverview = z.infer<typeof MachineOverviewSchema>
export type ProcessInfo = z.infer<typeof ProcessInfoSchema>
export type PortInfo = z.infer<typeof PortInfoSchema>
export type ProcessesResponse = z.infer<typeof ProcessesResponseSchema>
export type PortsResponse = z.infer<typeof PortsResponseSchema>

import type {
  KillPortProcessesBodySchema,
  KillPortProcessesResponseSchema,
  KillPortProcessResultSchema,
  PortBindingSchema,
  PortBindingsResponseSchema,
} from "./schemas/ports"

export type PortBinding = z.infer<typeof PortBindingSchema>
export type PortBindingsResponse = z.infer<typeof PortBindingsResponseSchema>
export type KillPortProcessesBody = z.infer<typeof KillPortProcessesBodySchema>
export type KillPortProcessResult = z.infer<typeof KillPortProcessResultSchema>
export type KillPortProcessesResponse = z.infer<
  typeof KillPortProcessesResponseSchema
>

import type {
  ProcessEntrySchema,
  ProcessKindSchema,
  ProcessListResponseSchema,
  ProcessStateSchema,
} from "./schemas/processes"

export type ProcessEntry = z.infer<typeof ProcessEntrySchema>
export type ProcessState = z.infer<typeof ProcessStateSchema>
export type ProcessKind = z.infer<typeof ProcessKindSchema>
export type ProcessListResponse = z.infer<typeof ProcessListResponseSchema>

import type {
  ServiceDomainSchema,
  ServiceEnabledBodySchema,
  ServiceStateSchema,
  ServicesResponseSchema,
  ServiceTargetBodySchema,
  ServiceTargetQuerySchema,
  SystemServiceSchema,
} from "./schemas/system-services"

export type SystemService = z.infer<typeof SystemServiceSchema>
export type ServiceDomain = z.infer<typeof ServiceDomainSchema>
export type ServiceState = z.infer<typeof ServiceStateSchema>
export type ServicesResponse = z.infer<typeof ServicesResponseSchema>
export type ServiceTargetBody = z.infer<typeof ServiceTargetBodySchema>
export type ServiceTargetQuery = z.infer<typeof ServiceTargetQuerySchema>
export type ServiceEnabledBody = z.infer<typeof ServiceEnabledBodySchema>

import type {
  FrpConfigInputSchema,
  FrpConfigSchema,
  FrpProbeBodySchema,
  FrpProbeSchema,
  FrpProxySchema,
  FrpProxyTypeSchema,
  FrpServerSchema,
} from "./schemas/frp"

export type FrpProxyType = z.infer<typeof FrpProxyTypeSchema>
export type FrpProxy = z.infer<typeof FrpProxySchema>
export type FrpServer = z.infer<typeof FrpServerSchema>
export type FrpConfig = z.infer<typeof FrpConfigSchema>
export type FrpConfigInput = z.infer<typeof FrpConfigInputSchema>
export type FrpProbeBody = z.infer<typeof FrpProbeBodySchema>
export type FrpProbe = z.infer<typeof FrpProbeSchema>
