import { z } from "zod"
import {
  DirectoryResponseSchema,
  FileContentResponseSchema,
  FileEntrySchema,
  OkResponseSchema,
  UploadResponseSchema,
} from "./schemas/files"
import {
  ActionResponseSchema,
  ApiErrorSchema,
  EntriesResponseSchema,
  GrowthEntrySchema,
  ScanSnapshotSchema,
  ScanStartResponseSchema,
  ScanStatusSchema,
  TreeResponseSchema,
  type TreeNodeWire,
  ScansResponseSchema,
} from "./schemas/disk-growth"

export type ScanSnapshot = z.infer<typeof ScanSnapshotSchema>
export type GrowthEntry = z.infer<typeof GrowthEntrySchema>
export type ScanStatus = z.infer<typeof ScanStatusSchema>
export type ScansResponse = z.infer<typeof ScansResponseSchema>
export type EntriesResponse = z.infer<typeof EntriesResponseSchema>
export type ScanStartResponse = z.infer<typeof ScanStartResponseSchema>
import {
  KillProcessesBodySchema,
  KillProcessesResponseSchema,
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
export type TreeResponse = z.infer<typeof TreeResponseSchema>
export type TreeNode = TreeNodeWire
export type FileEntry = z.infer<typeof FileEntrySchema>
export type DirectoryResponse = z.infer<typeof DirectoryResponseSchema>
export type FileContentResponse = z.infer<typeof FileContentResponseSchema>
export type OkResponse = z.infer<typeof OkResponseSchema>
export type UploadResponse = z.infer<typeof UploadResponseSchema>

import {
  CpuInfoSchema,
  DiskVolumeSchema,
  MachineOverviewSchema,
  MemoryInfoSchema,
  NetworkInfoSchema,
  PortInfoSchema,
  PortsResponseSchema,
  ProcessInfoSchema,
  ProcessesResponseSchema,
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

import {
  KillPortProcessResultSchema,
  KillPortProcessesBodySchema,
  KillPortProcessesResponseSchema,
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

import {
  ProcessEntrySchema,
  ProcessKindSchema,
  ProcessListResponseSchema,
  ProcessStateSchema,
} from "./schemas/processes"

export type ProcessEntry = z.infer<typeof ProcessEntrySchema>
export type ProcessState = z.infer<typeof ProcessStateSchema>
export type ProcessKind = z.infer<typeof ProcessKindSchema>
export type ProcessListResponse = z.infer<typeof ProcessListResponseSchema>

import {
  ServiceDomainSchema,
  ServiceEnabledBodySchema,
  ServiceStateSchema,
  ServiceTargetBodySchema,
  ServiceTargetQuerySchema,
  ServicesResponseSchema,
  SystemServiceSchema,
} from "./schemas/system-services"

export type SystemService = z.infer<typeof SystemServiceSchema>
export type ServiceDomain = z.infer<typeof ServiceDomainSchema>
export type ServiceState = z.infer<typeof ServiceStateSchema>
export type ServicesResponse = z.infer<typeof ServicesResponseSchema>
export type ServiceTargetBody = z.infer<typeof ServiceTargetBodySchema>
export type ServiceTargetQuery = z.infer<typeof ServiceTargetQuerySchema>
export type ServiceEnabledBody = z.infer<typeof ServiceEnabledBodySchema>
