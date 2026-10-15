/**
 * MCP Servers 域的大小、数量与时限边界。
 *
 * 连接与调用都会启动本机进程或访问远程地址，所以每一项都要有明确上限，
 * 不能依赖「只在本机」来放弃约束。
 */

/** 建立连接（initialize + 拉能力）的等待上限。 */
export const MCP_CONNECT_TIMEOUT_MS = 20_000

/**
 * 单次调用的等待上限。
 * 它是「等多久就不再等」而不是「执行多久」：超时只解除等待，服务端可能已经
 * 执行，因此超时结果记为结果未知，既不报失败也不自动重试。
 */
export const MCP_REQUEST_TIMEOUT_MS = 60_000

/** 关闭 stdio 子进程时等待退出的时间，超过就 SIGKILL。 */
export const MCP_CLOSE_TIMEOUT_MS = 2_000

/** 单条 JSON-RPC 消息上限，防止异常服务端把内存撑爆。 */
export const MCP_MAX_MESSAGE_BYTES = 8 * 1024 * 1024

/** 采集的 stderr 上限（滚动保留尾部）与返回给页面的行数。 */
export const MCP_MAX_STDERR_BYTES = 16 * 1024
export const MCP_LOG_LINES = 60

/** 内容归一化上限：单块文本、单张图片、单次结果的内容块数量。 */
export const MCP_MAX_TEXT_BYTES = 128 * 1024
export const MCP_MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const MCP_MAX_CONTENT_BLOCKS = 32

/** 单条调用记录落库的 JSON 上限；超出时截断内容并在记录里说明。 */
export const MCP_MAX_RECORD_BYTES = 512 * 1024

/** 每台服务器保留的调用记录条数，控制库规模。 */
export const MCP_CALLS_KEEP = 200

/** 调用记录列表的默认与最大返回条数。 */
export const MCP_CALLS_DEFAULT_LIMIT = 50
export const MCP_CALLS_MAX_LIMIT = 200

/** 能力清单上限：异常服务端可能返回极长的列表。 */
export const MCP_MAX_TOOLS = 500
export const MCP_MAX_RESOURCES = 500
export const MCP_MAX_RESOURCE_TEMPLATES = 200
export const MCP_MAX_PROMPTS = 200

/** 单个工具入参 schema 的属性数上限。 */
export const MCP_MAX_SCHEMA_PROPERTIES = 64

/** 工具描述与提示词描述的展示长度上限。 */
export const MCP_MAX_DESCRIPTION_CHARS = 2000

/** 客户端标识：发给服务端用于识别调用方。 */
export const MCP_CLIENT_NAME = "freewind-mac-manager"
export const MCP_CLIENT_VERSION = "0.0.1"
