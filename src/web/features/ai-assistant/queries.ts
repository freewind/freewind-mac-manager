import { fetchAiAssistantSettings } from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"

/** 助手设置的查询键：跨组件复用同一份缓存。 */
export const aiAssistantKeys = {
  all: ["ai-assistant"] as const,
  settings: () => [...aiAssistantKeys.all, "settings"] as const,
}

/**
 * 读取助手设置。只在浮层打开时读取：设置是被动读取的配置，
 * 不做轮询；失败也不自动重试，由界面提示用户重新打开核实。
 */
export const useAiAssistantSettings = (enabled: boolean) =>
  useQuery({
    queryKey: aiAssistantKeys.settings(),
    queryFn: fetchAiAssistantSettings,
    enabled,
    retry: false,
  })
