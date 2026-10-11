import { RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@web/components/ui/button"
import { ConnectionsList } from "./ConnectionsList"
import { ProxyGroups } from "./ProxyGroups"
import { StatusCards } from "./StatusCards"
import { useClashVerge } from "./useClashVerge"

export const ClashVergePage = () => {
  const model = useClashVerge()
  const primaryAvailability = model.status?.availability
  const stale =
    model.status?.availability.state !== "available" ||
    model.statusQueryIsError ||
    model.proxies?.availability.state !== "available" ||
    model.connections?.availability.state !== "available"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h1 className="text-sm font-medium">Clash Verge</h1>
        {stale ? (
          <span
            role="status"
            className="text-xs text-amber-700 dark:text-amber-400"
          >
            {primaryAvailability?.state === "not_configured"
              ? "尚未配置本机只读控制接口"
              : primaryAvailability?.state === "unauthorized"
                ? "控制接口认证失败；请检查服务端配置"
                : primaryAvailability?.state === "unavailable"
                  ? "控制接口不可用；当前数据可能过期"
                  : "数据未完整更新；请核对各区块时间"}
          </span>
        ) : null}
        <Button
          size="sm"
          className="ml-auto min-h-11 min-w-11"
          variant="outline"
          onClick={model.refresh}
          disabled={model.isFetching}
        >
          <HugeiconsIcon icon={RefreshIcon} />
          刷新
        </Button>
      </header>

      {model.isLoading ? (
        <p className="p-4 text-sm text-muted-foreground">
          正在读取 Clash Verge 内核状态…
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <StatusCards status={model.status} />
          {model.status?.sampledAt ? (
            <p className="-mt-4 text-xs text-muted-foreground">
              状态采集于 {new Date(model.status.sampledAt).toLocaleTimeString()}
              {model.status.availability.state !== "available"
                ? " · 状态不可用，数据可能过期"
                : ""}
            </p>
          ) : null}
          <ProxyGroups
            proxies={model.proxies?.proxies ?? []}
            sampledAt={model.proxies?.sampledAt}
          />
          <ConnectionsList
            connections={model.connections?.connections ?? []}
            total={model.connections?.total ?? 0}
            truncated={model.connections?.truncated ?? false}
            sampledAt={model.connections?.sampledAt}
          />
        </div>
      )}
    </div>
  )
}
