import { fetchAiAssistantSettings, fetchPiModels } from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"

/** 助手域的查询键：设置与模型目录都由这里定义，避免各处重复拼 key。 */
export const aiAssistantKeys = {
  all: ["ai-assistant"] as const,
  settings: () => [...aiAssistantKeys.all, "settings"] as const,
  /**
   * 模型目录来自 Pi 已配置的 models.json，与 Pi 页模型列表同源但独立成键：
   * 助手域不引用 Pi 域的私有查询，两个页面各自刷新互不干扰。
   */
  modelDirectory: () => [...aiAssistantKeys.all, "model-directory"] as const,
}

/**
 * 读取助手设置。只在需要时读取：设置是被动读取的配置，
 * 不做轮询；失败也不自动重试，由界面提示用户重新打开核实。
 */
export const useAiAssistantSettings = (enabled: boolean) =>
  useQuery({
    queryKey: aiAssistantKeys.settings(),
    queryFn: fetchAiAssistantSettings,
    enabled,
    retry: false,
  })

/**
 * 读取 Pi 已配置的模型目录（只读本机配置，不做网络发现）。
 * 目录可能变化，所以支持显式重新读取；失败不自动重试。
 */
export const usePiModelDirectory = (enabled: boolean) =>
  useQuery({
    queryKey: aiAssistantKeys.modelDirectory(),
    queryFn: fetchPiModels,
    enabled,
    retry: false,
  })
