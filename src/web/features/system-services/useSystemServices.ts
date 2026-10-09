import { useCallback, useMemo, useRef, useState } from "react"
import {
  isMockMode,
  mockServices,
  type LaunchService,
  type ServiceDomain,
  type ServiceState,
} from "@web/features/system-services/mock-data"

export type ServiceAction =
  "start" | "stop" | "restart" | "load" | "unload" | "disable" | "enable"

export type StateFilter = "all" | ServiceState
export type DomainFilter = "all" | ServiceDomain

export type PendingAction = { action: ServiceAction; label: string }

/** 会改状态、可能影响开机行为的操作，先让用户确认。 */
const CONFIRM_REQUIRED: ServiceAction[] = [
  "stop",
  "restart",
  "unload",
  "disable",
]

const nowSeconds = (): number => Math.round(Date.now() / 1000)

export const useSystemServices = () => {
  const mock = useMemo(() => isMockMode(), [])
  const initial = useMemo(() => (mock ? mockServices() : []), [mock])
  const [services, setServices] = useState<LaunchService[]>(initial)
  const [selectedLabel, setSelectedLabel] = useState<string | null>(
    initial[0]?.label ?? null
  )
  const [keyword, setKeyword] = useState("")
  const [stateFilter, setStateFilter] = useState<StateFilter>("all")
  const [domainFilter, setDomainFilter] = useState<DomainFilter>("all")
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const nextPid = useRef(7200)

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    return services.filter((service) => {
      if (stateFilter !== "all" && service.state !== stateFilter) return false
      if (domainFilter !== "all" && service.domain !== domainFilter)
        return false
      if (needle.length === 0) return true
      return (
        service.label.toLowerCase().includes(needle) ||
        service.program.toLowerCase().includes(needle) ||
        service.filePath.toLowerCase().includes(needle)
      )
    })
  }, [services, keyword, stateFilter, domainFilter])

  const selected =
    services.find((service) => service.label === selectedLabel) ?? null

  const stats = useMemo(
    () => ({
      total: services.length,
      running: services.filter((item) => item.state === "running").length,
      stopped: services.filter((item) => item.state === "stopped").length,
      failed: services.filter((item) => item.state === "failed").length,
      disabled: services.filter((item) => item.state === "disabled").length,
      requiresRoot: services.filter((item) => item.requiresRoot).length,
    }),
    [services]
  )

  /** 计算某个操作执行后该服务的新状态与反馈文案。 */
  const applyAction = useCallback(
    (
      target: LaunchService,
      action: ServiceAction
    ): { next: LaunchService; message: string } => {
      const stamp = nowSeconds()
      if (action === "start" || action === "restart" || action === "load") {
        const pid = nextPid.current
        nextPid.current += 1
        const verb =
          action === "start"
            ? "已启动"
            : action === "restart"
              ? "已重启"
              : "已加载并启动"
        return {
          next: {
            ...target,
            exists: true,
            loaded: true,
            disabled: false,
            state: "running",
            pid,
            lastExitCode: null,
            startedAt: stamp,
            lastAction: `${verb}（pid ${pid}）`,
          },
          message: `${verb} ${target.label}，pid ${pid}`,
        }
      }
      if (action === "stop") {
        return {
          next: {
            ...target,
            state: "stopped",
            pid: null,
            lastExitCode: 0,
            startedAt: null,
            lastAction: "已停止（退出码 0）",
          },
          message: `已停止 ${target.label}`,
        }
      }
      if (action === "unload") {
        return {
          next: {
            ...target,
            exists: false,
            loaded: false,
            state: "stopped",
            pid: null,
            lastExitCode: 0,
            startedAt: null,
            lastAction: "已卸载，plist 已移入废纸篓",
          },
          message: `已卸载 ${target.label}：停止运行，plist 已移入废纸篓`,
        }
      }
      if (action === "disable") {
        return {
          next: {
            ...target,
            disabled: true,
            state: "disabled",
            pid: null,
            lastExitCode: 0,
            startedAt: null,
            lastAction: "已禁用，开机不再自动启动",
          },
          message: `已禁用 ${target.label}，开机不再自动启动`,
        }
      }
      return {
        next: {
          ...target,
          disabled: false,
          state: "stopped",
          pid: null,
          lastExitCode: null,
          startedAt: null,
          lastAction: "已启用，等下次登录或手动启动",
        },
        message: `已启用 ${target.label}`,
      }
    },
    []
  )

  const run = useCallback(
    (action: ServiceAction, label: string) => {
      const target = services.find((service) => service.label === label)
      if (!target) return
      if (target.requiresRoot) {
        setNotice(`${label} 位于系统域，需要 root 权限；此处只提供查看与复制。`)
        return
      }
      const { next, message } = applyAction(target, action)
      setServices((previous) =>
        previous.map((service) => (service.label === label ? next : service))
      )
      setSelectedLabel(label)
      setNotice(message)
    },
    [applyAction, services]
  )

  /** 入口：需要确认的先弹窗，其余直接执行。 */
  const requestAction = useCallback(
    (action: ServiceAction, label: string) => {
      if (CONFIRM_REQUIRED.includes(action)) {
        setPending({ action, label })
        return
      }
      run(action, label)
    },
    [run]
  )

  const confirmPending = useCallback(() => {
    if (!pending) return
    run(pending.action, pending.label)
    setPending(null)
  }, [pending, run])

  const refresh = useCallback(() => {
    setServices((previous) =>
      previous.map((service) =>
        service.requiresRoot ? service : { ...service, lastAction: null }
      )
    )
    setNotice(`已重新读取 ${services.length} 个 plist 与 launchd 状态`)
  }, [services.length])

  const reveal = useCallback((target: LaunchService) => {
    setNotice(
      target.exists
        ? `已在访达中显示：${target.filePath}`
        : `plist 已不在原处：${target.filePath}`
    )
  }, [])

  const copy = useCallback((text: string, what: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => setNotice(`已复制${what}`))
      .catch((error) => setNotice(`复制失败：${String(error)}`))
  }, [])

  return {
    services,
    filtered,
    selected,
    stats,
    selectedLabel: selected?.label ?? null,
    select: setSelectedLabel,
    keyword,
    setKeyword,
    stateFilter,
    setStateFilter,
    domainFilter,
    setDomainFilter,
    notice,
    clearNotice: () => setNotice(null),
    pending,
    requestAction,
    cancelPending: () => setPending(null),
    confirmPending,
    refresh,
    reveal,
    copy,
  }
}
