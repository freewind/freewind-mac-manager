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
  FileSearchMatchSchema,
  FileSearchQuerySchema,
  FileSearchResponseSchema,
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
  ClashMergeConfigSchema,
  ClashMergeRuleSchema,
  ClashVergeAvailabilitySchema,
  ClashVergeConnectionSchema,
  ClashVergeConnectionsResponseSchema,
  ClashVergeGeositeCategorySchema,
  ClashVergeGeositeSchema,
  ClashVergeMergeFileSchema,
  ClashVergeProfileFileSchema,
  ClashVergeProfileNodeSchema,
  ClashVergeProfileSchema,
  ClashVergeProfilesResponseSchema,
  ClashVergeProxiesResponseSchema,
  ClashVergeProxySchema,
  ClashVergeStatusSchema,
  GeositeRuleSchema,
  MergeClashProfilesBodySchema,
  SaveClashMergeConfigBodySchema,
  SaveClashVergeMergeBodySchema,
  SetClashVergeCurrentProfileBodySchema,
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
export type ClashVergeProfileNode = z.infer<typeof ClashVergeProfileNodeSchema>
export type ClashVergeProfile = z.infer<typeof ClashVergeProfileSchema>
export type ClashVergeProfileFile = z.infer<typeof ClashVergeProfileFileSchema>
export type ClashVergeGeosite = z.infer<typeof ClashVergeGeositeSchema>
export type ClashVergeGeositeCategory = z.infer<
  typeof ClashVergeGeositeCategorySchema
>
export type GeositeRule = z.infer<typeof GeositeRuleSchema>
export type ClashVergeProfilesResponse = z.infer<
  typeof ClashVergeProfilesResponseSchema
>
export type ClashVergeMergeFile = z.infer<typeof ClashVergeMergeFileSchema>
export type SaveClashVergeMergeBody = z.infer<
  typeof SaveClashVergeMergeBodySchema
>
export type SetClashVergeCurrentProfileBody = z.infer<
  typeof SetClashVergeCurrentProfileBodySchema
>
export type ClashMergeRule = z.infer<typeof ClashMergeRuleSchema>
export type ClashMergeConfig = z.infer<typeof ClashMergeConfigSchema>
export type SaveClashMergeConfigBody = z.infer<
  typeof SaveClashMergeConfigBodySchema
>
export type MergeClashProfilesBody = z.infer<
  typeof MergeClashProfilesBodySchema
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
export type FileSearchQuery = z.infer<typeof FileSearchQuerySchema>
export type FileSearchMatch = z.infer<typeof FileSearchMatchSchema>
export type FileSearchResponse = z.infer<typeof FileSearchResponseSchema>
export type DirectoryResponse = z.infer<typeof DirectoryResponseSchema>
export type FileContentResponse = z.infer<typeof FileContentResponseSchema>
export type UploadResponse = z.infer<typeof UploadResponseSchema>

import type {
  CpuInfoSchema,
  DashboardOverviewSchema,
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
export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>
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
  AiAssistantExecutionResponseSchema,
  AiAssistantExecutionSchema,
  AiAssistantHistoryMessageSchema,
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
export type AiAssistantExecution = z.infer<typeof AiAssistantExecutionSchema>
export type AiAssistantExecutionResponse = z.infer<
  typeof AiAssistantExecutionResponseSchema
>
export type AiAssistantHistoryMessage = z.infer<
  typeof AiAssistantHistoryMessageSchema
>

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

import type {
  DatabaseCapabilitySchema,
  DatabaseColumnAffinitySchema,
  DatabaseColumnSchema,
  DatabaseConstraintsSchema,
  DatabaseDeleteBodySchema,
  DatabaseDeleteResultSchema,
  DatabaseFilterOperatorSchema,
  DatabaseFilterSchema,
  DatabaseIncomingForeignKeySchema,
  DatabaseInsertBodySchema,
  DatabaseOperationDisabledReasonSchema,
  DatabaseOperationSchema,
  DatabaseRecordKeySchema,
  DatabaseRecordLocatorKeySchema,
  DatabaseRecordQuerySchema,
  DatabaseRecordResponseSchema,
  DatabaseRecordSchema,
  DatabaseRecordsQuerySchema,
  DatabaseRecordsResponseSchema,
  DatabaseSortDirectionSchema,
  DatabaseSortSchema,
  DatabaseTableKindSchema,
  DatabaseTablePathParamsSchema,
  DatabaseTableSchema,
  DatabaseTableSummarySchema,
  DatabaseTablesResponseSchema,
  DatabaseUpdateBodySchema,
  SqliteValueSchema,
  SqliteWritableValueSchema,
} from "./schemas/database"

/** database 域的类型全部从 schema 派生，不另建 DTO。 */
export type SqliteValue = z.infer<typeof SqliteValueSchema>
export type SqliteWritableValue = z.infer<typeof SqliteWritableValueSchema>
export type DatabaseColumnAffinity = z.infer<
  typeof DatabaseColumnAffinitySchema
>
export type DatabaseOperation = z.infer<typeof DatabaseOperationSchema>
export type DatabaseOperationDisabledReason = z.infer<
  typeof DatabaseOperationDisabledReasonSchema
>
export type DatabaseCapability = z.infer<typeof DatabaseCapabilitySchema>
export type DatabaseColumn = z.infer<typeof DatabaseColumnSchema>
export type DatabaseConstraints = z.infer<typeof DatabaseConstraintsSchema>
export type DatabaseIncomingForeignKey = z.infer<
  typeof DatabaseIncomingForeignKeySchema
>
export type DatabaseTableKind = z.infer<typeof DatabaseTableKindSchema>
export type DatabaseTableSummary = z.infer<typeof DatabaseTableSummarySchema>
export type DatabaseTable = z.infer<typeof DatabaseTableSchema>
export type DatabaseTablesResponse = z.infer<
  typeof DatabaseTablesResponseSchema
>
export type DatabaseRecordKey = z.infer<typeof DatabaseRecordKeySchema>
export type DatabaseRecordLocatorKey = z.infer<
  typeof DatabaseRecordLocatorKeySchema
>
export type DatabaseRecord = z.infer<typeof DatabaseRecordSchema>
export type DatabaseRecordResponse = z.infer<
  typeof DatabaseRecordResponseSchema
>
export type DatabaseFilterOperator = z.infer<
  typeof DatabaseFilterOperatorSchema
>
export type DatabaseFilter = z.infer<typeof DatabaseFilterSchema>
export type DatabaseSortDirection = z.infer<typeof DatabaseSortDirectionSchema>
export type DatabaseSort = z.infer<typeof DatabaseSortSchema>
export type DatabaseRecordsQuery = z.infer<typeof DatabaseRecordsQuerySchema>
export type DatabaseRecordQuery = z.infer<typeof DatabaseRecordQuerySchema>
export type DatabaseRecordsResponse = z.infer<
  typeof DatabaseRecordsResponseSchema
>
export type DatabaseInsertBody = z.infer<typeof DatabaseInsertBodySchema>
export type DatabaseUpdateBody = z.infer<typeof DatabaseUpdateBodySchema>
export type DatabaseDeleteBody = z.infer<typeof DatabaseDeleteBodySchema>
export type DatabaseDeleteResult = z.infer<typeof DatabaseDeleteResultSchema>
export type DatabaseTablePathParams = z.infer<
  typeof DatabaseTablePathParamsSchema
>

export type {
  CollaborationComment,
  CollaborationCommentList,
  CollaborationCommentPath,
  CollaborationCommentResponse,
  CollaborationCreateThread,
  CollaborationCreateTopic,
  CollaborationEditComment,
  CollaborationEvent,
  CollaborationReorder,
  CollaborationSearchComment,
  CollaborationSearchQuery,
  CollaborationSearchResult,
  CollaborationSendComment,
  CollaborationThreadDetail,
  CollaborationThreadList,
  CollaborationThreadPath,
  CollaborationTopicDetail,
  CollaborationTopicList,
  CollaborationTopicPath,
  CollaborationUpdateThread,
  CollaborationUpdateTopic,
} from "./schemas/collaboration"

import type {
  DatabaseBackupCreatedSchema,
  DatabaseBackupDeleteBodySchema,
  DatabaseBackupDeleteItemSchema,
  DatabaseBackupDeleteResultSchema,
  DatabaseBackupErrorCodeSchema,
  DatabaseBackupErrorSchema,
  DatabaseBackupIdPathParamsSchema,
  DatabaseBackupSchema,
  DatabaseBackupSourceSchema,
  DatabaseBackupsQuerySchema,
  DatabaseBackupsResponseSchema,
  DatabaseRestorePlanBodySchema,
  DatabaseRestorePlanSchema,
  DatabaseRestoreStateSchema,
  DatabaseRestoreStatusSchema,
} from "./schemas/database-backups"

/** database 备份域的类型全部从 schema 派生，不另建 DTO。 */
export type DatabaseBackup = z.infer<typeof DatabaseBackupSchema>
export type DatabaseBackupSource = z.infer<typeof DatabaseBackupSourceSchema>
export type DatabaseBackupsQuery = z.infer<typeof DatabaseBackupsQuerySchema>
/** 请求侧入参：带默认值的字段在这里是可选的。 */
export type DatabaseBackupsQueryInput = z.input<
  typeof DatabaseBackupsQuerySchema
>
export type DatabaseBackupsResponse = z.infer<
  typeof DatabaseBackupsResponseSchema
>
export type DatabaseBackupCreated = z.infer<typeof DatabaseBackupCreatedSchema>
export type DatabaseBackupDeleteItem = z.infer<
  typeof DatabaseBackupDeleteItemSchema
>
export type DatabaseBackupDeleteBody = z.infer<
  typeof DatabaseBackupDeleteBodySchema
>
export type DatabaseBackupDeleteResult = z.infer<
  typeof DatabaseBackupDeleteResultSchema
>
export type DatabaseBackupErrorCode = z.infer<
  typeof DatabaseBackupErrorCodeSchema
>
export type DatabaseBackupError = z.infer<typeof DatabaseBackupErrorSchema>
export type DatabaseRestoreStatus = z.infer<typeof DatabaseRestoreStatusSchema>
export type DatabaseRestorePlan = z.infer<typeof DatabaseRestorePlanSchema>
export type DatabaseRestorePlanBody = z.infer<
  typeof DatabaseRestorePlanBodySchema
>
export type DatabaseRestorePlanBodyInput = z.input<
  typeof DatabaseRestorePlanBodySchema
>
export type DatabaseRestoreState = z.infer<typeof DatabaseRestoreStateSchema>
export type DatabaseBackupIdPathParams = z.infer<
  typeof DatabaseBackupIdPathParamsSchema
>

import type {
  McpCallKindSchema,
  McpCallRecordSchema,
  McpCallStatusSchema,
  McpCallsQuerySchema,
  McpCallsResponseSchema,
  McpCapabilitiesResponseSchema,
  McpCapabilitiesSchema,
  McpConnectionStateSchema,
  McpContentBlockSchema,
  McpJsonSchemaPropertySchema,
  McpJsonSchemaSchema,
  McpKeyValueSchema,
  McpLogsResponseSchema,
  McpPromptArgumentSchema,
  McpPromptGetInputSchema,
  McpPromptSchema,
  McpResourceReadInputSchema,
  McpResourceSchema,
  McpResourceTemplateSchema,
  McpServerConfigSchema,
  McpServerInfoSchema,
  McpServerInputSchema,
  McpServerSchema,
  McpServerStatusSchema,
  McpServersResponseSchema,
  McpToolAnnotationsSchema,
  McpToolCallInputSchema,
  McpToolSchema,
  McpTransportSchema,
} from "./schemas/mcp-servers"

export type McpTransport = z.infer<typeof McpTransportSchema>
export type McpConnectionState = z.infer<typeof McpConnectionStateSchema>
export type McpKeyValue = z.infer<typeof McpKeyValueSchema>
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>
export type McpServerInfo = z.infer<typeof McpServerInfoSchema>
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>
export type McpJsonSchemaProperty = z.infer<typeof McpJsonSchemaPropertySchema>
export type McpJsonSchema = z.infer<typeof McpJsonSchemaSchema>
export type McpToolAnnotations = z.infer<typeof McpToolAnnotationsSchema>
export type McpTool = z.infer<typeof McpToolSchema>
export type McpResource = z.infer<typeof McpResourceSchema>
export type McpResourceTemplate = z.infer<typeof McpResourceTemplateSchema>
export type McpPromptArgument = z.infer<typeof McpPromptArgumentSchema>
export type McpPrompt = z.infer<typeof McpPromptSchema>
export type McpCapabilities = z.infer<typeof McpCapabilitiesSchema>
export type McpServer = z.infer<typeof McpServerSchema>
export type McpContentBlock = z.infer<typeof McpContentBlockSchema>
export type McpCallKind = z.infer<typeof McpCallKindSchema>
export type McpCallStatus = z.infer<typeof McpCallStatusSchema>
export type McpCallRecord = z.infer<typeof McpCallRecordSchema>
export type McpServersResponse = z.infer<typeof McpServersResponseSchema>
export type McpCapabilitiesResponse = z.infer<
  typeof McpCapabilitiesResponseSchema
>
export type McpCallsQuery = z.infer<typeof McpCallsQuerySchema>
export type McpCallsQueryInput = z.input<typeof McpCallsQuerySchema>
export type McpCallsResponse = z.infer<typeof McpCallsResponseSchema>
export type McpLogsResponse = z.infer<typeof McpLogsResponseSchema>
export type McpServerInput = z.infer<typeof McpServerInputSchema>
export type McpToolCallInput = z.infer<typeof McpToolCallInputSchema>
export type McpResourceReadInput = z.infer<typeof McpResourceReadInputSchema>
export type McpPromptGetInput = z.infer<typeof McpPromptGetInputSchema>
