import { publicSystemError } from "@server/common/public-error"
import { contract } from "@shared/api-contract"
import { initServer } from "@ts-rest/express"
import type { McpServersService } from "./service"

const s = initServer()

/**
 * 路由从汇总契约取，与其它域一致：只有汇总时才会补上 /api 前缀。
 * 直接用 routes/ 下的原始定义会漏掉前缀，端点全部 404。
 */
export const mcpServersContract = {
  listMcpServers: contract.listMcpServers,
  listMcpCalls: contract.listMcpCalls,
  createMcpServer: contract.createMcpServer,
  updateMcpServer: contract.updateMcpServer,
  deleteMcpServer: contract.deleteMcpServer,
  connectMcpServer: contract.connectMcpServer,
  disconnectMcpServer: contract.disconnectMcpServer,
  getMcpCapabilities: contract.getMcpCapabilities,
  getMcpLogs: contract.getMcpLogs,
  callMcpTool: contract.callMcpTool,
  readMcpResource: contract.readMcpResource,
  getMcpPrompt: contract.getMcpPrompt,
}

/**
 * handler 只做入参到服务的映射。
 * 已知错误（400/404/409）由服务层抛 PublicOperationError，公共兜底会按语义
 * 映射；未预期异常不回传内部路径与堆栈。
 */
export const createMcpServersRouter = (service: McpServersService) =>
  s.router(mcpServersContract, {
    listMcpServers: async () => {
      try {
        return { status: 200 as const, body: service.listServers() }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    listMcpCalls: async ({ query }) => {
      try {
        return { status: 200 as const, body: service.listCalls(query) }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    createMcpServer: async ({ body }) => {
      try {
        return { status: 201 as const, body: service.createServer(body) }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    updateMcpServer: async ({ params, body }) => {
      try {
        return {
          status: 200 as const,
          body: await service.updateServer(params.id, body),
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    deleteMcpServer: async ({ params }) => {
      try {
        await service.deleteServer(params.id)
        return { status: 204 as const, body: null }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    // 连不上不是请求失败：返回 200 与 failed 状态，由页面持续展示原因。
    connectMcpServer: async ({ params }) => {
      try {
        return {
          status: 200 as const,
          body: await service.connectServer(params.id),
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    disconnectMcpServer: async ({ params }) => {
      try {
        return {
          status: 200 as const,
          body: await service.disconnectServer(params.id),
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    getMcpCapabilities: async ({ params }) => {
      try {
        return {
          status: 200 as const,
          body: service.getCapabilities(params.id),
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    getMcpLogs: async ({ params }) => {
      try {
        return { status: 200 as const, body: service.getLogs(params.id) }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    callMcpTool: async ({ params, body }) => {
      try {
        return {
          status: 200 as const,
          body: await service.callTool(params.id, body),
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    readMcpResource: async ({ params, body }) => {
      try {
        return {
          status: 200 as const,
          body: await service.readResource(params.id, body),
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },

    getMcpPrompt: async ({ params, body }) => {
      try {
        return {
          status: 200 as const,
          body: await service.getPrompt(params.id, body),
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
  })
