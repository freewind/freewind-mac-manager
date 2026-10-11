import type { CaddyRulesResponse, CaddyStatus } from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

/** 读取 Caddy 进程、管理接口与配置文件的真实状态。 */
export const fetchCaddyStatus = async (): Promise<CaddyStatus> =>
  unwrap<CaddyStatus>(await apiClient.getCaddyStatus())

/** 读取配置文件里识别到的转发规则与无法识别行的样本。 */
export const fetchCaddyRules = async (): Promise<CaddyRulesResponse> =>
  unwrap<CaddyRulesResponse>(await apiClient.getCaddyRules())
