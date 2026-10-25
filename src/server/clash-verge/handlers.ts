import { publicSystemError } from "@server/common/public-error"
import { contract } from "@shared/api-contract"
import {
  getClashVergeConnections,
  getClashVergeProxies,
  getClashVergeStatus,
  mergeClashProfiles,
  readClashMergeConfig,
  readClashVergeGeosite,
  readClashVergeGeositeCategory,
  readClashVergeMergeFile,
  readClashVergeProfileFile,
  readClashVergeProfiles,
  saveClashMergeConfig,
  saveClashVergeMergeFile,
  setClashVergeCurrentProfile,
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
  getClashVergeProfiles: contract.getClashVergeProfiles,
  getClashVergeProfileFile: contract.getClashVergeProfileFile,
  getClashVergeGeosite: contract.getClashVergeGeosite,
  getClashVergeGeositeCategory: contract.getClashVergeGeositeCategory,
  setClashVergeCurrentProfile: contract.setClashVergeCurrentProfile,
  getClashMergeConfig: contract.getClashMergeConfig,
  saveClashMergeConfig: contract.saveClashMergeConfig,
  mergeClashProfiles: contract.mergeClashProfiles,
  getClashVergeMergeFile: contract.getClashVergeMergeFile,
  saveClashVergeMergeFile: contract.saveClashVergeMergeFile,
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
  // 订阅清单：只读解析本地 profiles.yaml，404/500 按语义回显。
  getClashVergeProfiles: async () => {
    try {
      return { status: 200 as const, body: await readClashVergeProfiles() }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  // 单个订阅的配置文件原文：只读，uid 由服务端查证，404/400 按语义回显。
  getClashVergeProfileFile: async ({ query }: { query: { uid: string } }) => {
    try {
      return {
        status: 200 as const,
        body: await readClashVergeProfileFile(query.uid),
      }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  // geosite 数据库：只读本地 geosite.dat，分类名大小写不敏感。
  getClashVergeGeosite: async () => {
    try {
      return { status: 200 as const, body: await readClashVergeGeosite() }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  getClashVergeGeositeCategory: async ({
    params,
  }: {
    params: { code: string }
  }) => {
    try {
      return {
        status: 200 as const,
        body: await readClashVergeGeositeCategory(params.code),
      }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  // 切换订阅：写操作 + 重启 App，当前订阅、订阅不存在、改写失败都按语义回显。
  setClashVergeCurrentProfile: async ({ body }: { body: { uid: string } }) => {
    try {
      return {
        status: 200 as const,
        body: { message: await setClashVergeCurrentProfile(body.uid) },
      }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  // 合并订阅设置：写本应用的库，不碰 Clash Verge 的配置。
  getClashMergeConfig: async () => ({
    status: 200 as const,
    body: readClashMergeConfig(),
  }),
  saveClashMergeConfig: async ({
    body,
  }: {
    body: { rules: { pattern: string; target: string }[] }
  }) => {
    try {
      return {
        status: 200 as const,
        body: { message: saveClashMergeConfig(body) },
      }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  // 生成合并配置：写 Profiles 目录并登记，已知错误按语义回显。
  mergeClashProfiles: async ({
    body,
  }: {
    body: { selected: string[]; rules: { pattern: string; target: string }[] }
  }) => {
    try {
      return {
        status: 200 as const,
        body: { message: await mergeClashProfiles(body) },
      }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  // Merge 文件读写：已知错误（404/403/400/409）按语义回显，其余异常走公共兜底。
  getClashVergeMergeFile: async () => {
    try {
      return { status: 200 as const, body: await readClashVergeMergeFile() }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  saveClashVergeMergeFile: async ({ body }: { body: { content: string } }) => {
    try {
      return {
        status: 200 as const,
        body: { message: await saveClashVergeMergeFile(body.content) },
      }
    } catch (error) {
      return publicSystemError(error)
    }
  },
}
