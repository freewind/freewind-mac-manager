import { contract } from "@shared/api-contract"
import {
  getClashVergeConnections,
  getClashVergeProxies,
  getClashVergeStatus,
} from "./service"

/**
 * 路由从汇总契约取，与其它域一致：只有汇总时才会补上 /api 前缀。
 * 直接用 routes/ 下的原始定义会漏掉前缀，三个端点全部 404，
 * dev 下落到 Vite 兜底返回 index.html，前端把页面当数据渲染就白屏。
 */
export const clashVergeContract = {
  getClashVergeStatus: contract.getClashVergeStatus,
  getClashVergeProxies: contract.getClashVergeProxies,
  getClashVergeConnections: contract.getClashVergeConnections,
}

export const clashVergeRouter = {
  getClashVergeStatus: async () => ({
    status: 200 as const,
    body: await getClashVergeStatus(),
  }),
  getClashVergeProxies: async () => ({
    status: 200 as const,
    body: await getClashVergeProxies(),
  }),
  getClashVergeConnections: async () => ({
    status: 200 as const,
    body: await getClashVergeConnections(),
  }),
}
