import type {
  CaddyApplyInput,
  CaddyApplyResult,
  CaddyRule,
  CaddyRuleImportResult,
  CaddyRuleInput,
  CaddyRulesResponse,
  CaddyStatus,
  CaddyVersionList,
} from "@shared/api-contract"
import { apiClient, taskRequestHeaders, unwrap } from "./client"
import { type Execution, runExecution } from "./execution"

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

/**
 * 应用规则到真实配置：写文件、平滑加载并核实。
 * 请求标识由服务端用来复用任务，网络重试不会变成第二次应用。
 */
export const applyCaddyConfig = async (
  requestId: string,
  input: CaddyApplyInput
): Promise<Execution<CaddyApplyResult>> =>
  runExecution<CaddyApplyResult>(() =>
    apiClient.applyCaddyConfig({
      body: input,
      headers: taskRequestHeaders(requestId),
    })
  )

/** 历史应用版本（倒序），供页面选择恢复目标。 */
export const fetchCaddyVersions = async (): Promise<CaddyVersionList> =>
  unwrap<CaddyVersionList>(await apiClient.listCaddyVersions())

/** 恢复到某个历史版本：同样要写文件与重新加载。 */
export const restoreCaddyVersion = async (
  requestId: string,
  id: string
): Promise<Execution<CaddyApplyResult>> =>
  runExecution<CaddyApplyResult>(() =>
    apiClient.restoreCaddyVersion({
      params: { id },
      headers: taskRequestHeaders(requestId),
    })
  )
