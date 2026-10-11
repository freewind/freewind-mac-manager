import type {
  CaddyRule,
  CaddyRuleImportResult,
  CaddyRuleInput,
  CaddyRulesResponse,
  CaddyStatus,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

/** 读取 Caddy 进程、管理接口与配置文件的真实状态。 */
export const fetchCaddyStatus = async (): Promise<CaddyStatus> =>
  unwrap<CaddyStatus>(await apiClient.getCaddyStatus())

/** 读取受管规则、文件里未接管的规则与应用前预览。 */
export const fetchCaddyRules = async (): Promise<CaddyRulesResponse> =>
  unwrap<CaddyRulesResponse>(await apiClient.getCaddyRules())

/** 新增规则：只写数据库，改配置文件要另行应用。 */
export const createCaddyRule = async (
  input: CaddyRuleInput
): Promise<CaddyRule> =>
  unwrap<CaddyRule>(await apiClient.createCaddyRule({ body: input }))

export const updateCaddyRule = async (
  id: string,
  input: CaddyRuleInput
): Promise<CaddyRule> =>
  unwrap<CaddyRule>(
    await apiClient.updateCaddyRule({ params: { id }, body: input })
  )

export const deleteCaddyRule = async (id: string): Promise<void> => {
  unwrap<null>(await apiClient.deleteCaddyRule({ params: { id } }))
}

/** 把文件里尚未接管的规则一次性纳入管理；只写数据库。 */
export const importCaddyRules = async (): Promise<CaddyRuleImportResult> =>
  unwrap<CaddyRuleImportResult>(await apiClient.importCaddyRules())
