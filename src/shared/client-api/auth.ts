import type { AuthStatus } from "./auth-types"
import { apiClient } from "./client"

export const fetchAuthStatus = async (): Promise<AuthStatus> => {
  const result = await apiClient.getAuthStatus()
  if (result.status !== 200) throw new Error("无法检查登录状态")
  return result.body
}

export const login = async (password: string): Promise<void> => {
  const result = await apiClient.login({ body: { password } })
  if (result.status !== 200) {
    const body = result.body as { message?: string }
    throw new Error(body.message ?? "登录失败")
  }
}
