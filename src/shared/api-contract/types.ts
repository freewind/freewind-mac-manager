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
  DiskSnapshotDeleteResultSchema,
  TaskListQuerySchema,
  TaskListResponseSchema,
  TaskProgressSchema,
  TaskStatusSchema,
} from "./schemas/tasks"
export type ScanSnapshot = z.infer<typeof ScanSnapshotSchema>
export type GrowthEntry = z.infer<typeof GrowthEntrySchema>
export type ScansResponse = z.infer<typeof ScansResponseSchema>
export type EntriesResponse = z.infer<typeof EntriesResponseSchema>
export type ScanStartResponse = z.infer<typeof ScanStartResponseSchema>

import type {
  SnapshotMutationResultSchema,
  SnapshotSaveResultSchema,
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

import type {
  ClashVergeAvailabilitySchema,
  ClashVergeConnectionSchema,
  ClashVergeConnectionsResponseSchema,
  ClashVergeProxiesResponseSchema,
  ClashVergeProxySchema,
  ClashVergeStatusSchema,
} from "./schemas/clash-verge"

export type ClashVergeAvailability = z.infer<
  typeof ClashVergeAvailabilitySchema
>
export type ClashVergeStatus = z.infer<typeof ClashVergeStatusSchema>
export type ClashVergeProxy = z.infer<typeof ClashVergeProxySchema>
export type ClashVergeProxiesResponse = z.infer<
  typeof ClashVergeProxiesResponseSchema
>
export type ClashVergeConnection = z.infer<typeof ClashVergeConnectionSchema>
export type ClashVergeConnectionsResponse = z.infer<
  typeof ClashVergeConnectionsResponseSchema
>

export type KillProcessesBody = z.infer<typeof KillProcessesBodySchema>
export type KillProcessesResponse = z.infer<typeof KillProcessesResponseSchema>

export type ApiError = z.infer<typeof ApiErrorSchema>
export type ActionResponse = z.infer<typeof ActionResponseSchema>
export type TaskAccepted = z.infer<typeof TaskAcceptedSchema>
export type TaskProgress = z.infer<typeof TaskProgressSchema>
export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>
/** 请求侧的入参类型：带默认值的字段在这里是可选的。 */
export type TaskListQueryInput = z.input<typeof TaskListQuerySchema>
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>
export type FileBatchResult = z.infer<typeof FileBatchResultSchema>
export type SnapshotSaveResult = z.infer<typeof SnapshotSaveResultSchema>
export type DiskSnapshotDeleteResult = z.infer<
  typeof DiskSnapshotDeleteResultSchema
>
export type SnapshotMutationResult = z.infer<
  typeof SnapshotMutationResultSchema
>
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

import type { HardwareOverviewSchema } from "./schemas/hardware"

export type HardwareOverview = z.infer<typeof HardwareOverviewSchema>

import type {
  AiAssistantSessionListSchema,
  AiAssistantSessionSchema,
  AiAssistantSettingsMutationSchema,
  AiAssistantSettingsResponseSchema,
  AiAssistantSettingsSchema,
} from "./schemas/ai-assistant"
import type {
  PiBenchmarkDeleteSchema,
  PiBenchmarkErrorSchema,
  PiBenchmarkListSchema,
  PiBenchmarkRequestSchema,
  PiBenchmarkResultSchema,
  PiBenchmarkStartSchema,
  PiBenchmarkTaskPayloadSchema,
  PiModelSchema,
  PiModelsResponseSchema,
  PiProviderInputSchema,
  PiProviderSchema,
  PiSettingsDocumentSchema,
  PiSettingsMutationSchema,
  PiSettingsResponseSchema,
} from "./schemas/pi"
import type {
  PiModelGroupInputSchema,
  PiModelGroupsResponseSchema,
} from "./schemas/pi-model-groups"
import type {
  ProcessEntrySchema,
  ProcessKindSchema,
  ProcessListResponseSchema,
  ProcessStateSchema,
} from "./schemas/processes"

export type PiModel = z.infer<typeof PiModelSchema>
export type PiBenchmarkRequest = z.input<typeof PiBenchmarkRequestSchema>
export type PiBenchmarkTaskPayload = z.infer<
  typeof PiBenchmarkTaskPayloadSchema
>
export type PiBenchmarkResult = z.infer<typeof PiBenchmarkResultSchema>
export type PiBenchmarkStart = z.infer<typeof PiBenchmarkStartSchema>
export type PiBenchmarkList = z.infer<typeof PiBenchmarkListSchema>
export type PiBenchmarkDelete = z.infer<typeof PiBenchmarkDeleteSchema>
export type PiBenchmarkError = z.infer<typeof PiBenchmarkErrorSchema>
export type PiProvider = z.infer<typeof PiProviderSchema>
export type PiProviderInput = z.infer<typeof PiProviderInputSchema>
export type PiModelsResponse = z.infer<typeof PiModelsResponseSchema>
export type PiSettingsResponse = z.infer<typeof PiSettingsResponseSchema>
export type PiSettingsDocument = z.infer<typeof PiSettingsDocumentSchema>
export type PiSettingsInput = z.input<typeof PiSettingsMutationSchema>
export type PiModelGroupInput = z.input<typeof PiModelGroupInputSchema>
export type PiModelGroupsResponse = z.infer<typeof PiModelGroupsResponseSchema>
export type AiAssistantSettingsResponse = z.infer<
  typeof AiAssistantSettingsResponseSchema
>
export type AiAssistantSettingsInput = z.input<
  typeof AiAssistantSettingsMutationSchema
>
export type AiAssistantSessionList = z.infer<
  typeof AiAssistantSessionListSchema
>
export type AiAssistantSettingsDocument = z.infer<
  typeof AiAssistantSettingsSchema
>
export type AiAssistantSessionSummary = z.infer<typeof AiAssistantSessionSchema>

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

import type {
  CaddyApplyInputSchema,
  CaddyApplyResultSchema,
  CaddyApplyStatusSchema,
  CaddyExternalRuleSchema,
  CaddyMatchKindSchema,
  CaddyRuleChangesSchema,
  CaddyRuleImportResultSchema,
  CaddyRuleInputSchema,
  CaddyRuleSchema,
  CaddyRulesResponseSchema,
  CaddyStatusSchema,
  CaddyVersionListSchema,
  CaddyVersionSummarySchema,
} from "./schemas/caddy"

export type CaddyMatchKind = z.infer<typeof CaddyMatchKindSchema>
export type CaddyRule = z.infer<typeof CaddyRuleSchema>
export type CaddyExternalRule = z.infer<typeof CaddyExternalRuleSchema>
export type CaddyRuleInput = z.infer<typeof CaddyRuleInputSchema>
export type CaddyRuleChanges = z.infer<typeof CaddyRuleChangesSchema>
export type CaddyRuleImportResult = z.infer<typeof CaddyRuleImportResultSchema>
export type CaddyApplyStatus = z.infer<typeof CaddyApplyStatusSchema>
export type CaddyApplyResult = z.infer<typeof CaddyApplyResultSchema>
export type CaddyApplyInput = z.infer<typeof CaddyApplyInputSchema>
export type CaddyVersionSummary = z.infer<typeof CaddyVersionSummarySchema>
export type CaddyVersionList = z.infer<typeof CaddyVersionListSchema>
export type CaddyStatus = z.infer<typeof CaddyStatusSchema>
export type CaddyRulesResponse = z.infer<typeof CaddyRulesResponseSchema>

import type {
  DockerColimaActionBodySchema,
  DockerColimaStatusSchema,
  DockerContainerActionBodySchema,
  DockerContainerCreateBodySchema,
  DockerContainerCreatedSchema,
  DockerContainerDeleteBodySchema,
  DockerContainerLogsQuerySchema,
  DockerContainerLogsResponseSchema,
  DockerContainerSchema,
  DockerContainerStateSchema,
  DockerContainersResponseSchema,
  DockerImageDeleteBodySchema,
  DockerImagePullBodySchema,
  DockerImageSchema,
  DockerImagesResponseSchema,
  DockerMountSchema,
  DockerNetworkDeleteBodySchema,
  DockerNetworkSchema,
  DockerNetworksResponseSchema,
  DockerOverviewSchema,
  DockerPortMappingSchema,
  DockerVolumeDeleteBodySchema,
  DockerVolumeSchema,
  DockerVolumesResponseSchema,
} from "./schemas/docker"

export type DockerContainerState = z.infer<typeof DockerContainerStateSchema>
export type DockerPortMapping = z.infer<typeof DockerPortMappingSchema>
export type DockerMount = z.infer<typeof DockerMountSchema>
export type DockerContainer = z.infer<typeof DockerContainerSchema>
export type DockerContainersResponse = z.infer<
  typeof DockerContainersResponseSchema
>
export type DockerContainerCreated = z.infer<
  typeof DockerContainerCreatedSchema
>
export type DockerColimaStatus = z.infer<typeof DockerColimaStatusSchema>
export type DockerOverview = z.infer<typeof DockerOverviewSchema>
export type DockerImage = z.infer<typeof DockerImageSchema>
export type DockerImagesResponse = z.infer<typeof DockerImagesResponseSchema>
export type DockerVolume = z.infer<typeof DockerVolumeSchema>
export type DockerVolumesResponse = z.infer<typeof DockerVolumesResponseSchema>
export type DockerNetwork = z.infer<typeof DockerNetworkSchema>
export type DockerNetworksResponse = z.infer<
  typeof DockerNetworksResponseSchema
>
export type DockerContainerLogsQuery = z.infer<
  typeof DockerContainerLogsQuerySchema
>
export type DockerContainerLogsResponse = z.infer<
  typeof DockerContainerLogsResponseSchema
>
export type DockerContainerCreateBody = z.infer<
  typeof DockerContainerCreateBodySchema
>
export type DockerContainerActionBody = z.infer<
  typeof DockerContainerActionBodySchema
>
export type DockerContainerDeleteBody = z.infer<
  typeof DockerContainerDeleteBodySchema
>
export type DockerImagePullBody = z.infer<typeof DockerImagePullBodySchema>
export type DockerImageDeleteBody = z.infer<typeof DockerImageDeleteBodySchema>
export type DockerVolumeDeleteBody = z.infer<
  typeof DockerVolumeDeleteBodySchema
>
export type DockerNetworkDeleteBody = z.infer<
  typeof DockerNetworkDeleteBodySchema
>
export type DockerColimaActionBody = z.infer<
  typeof DockerColimaActionBodySchema
>
