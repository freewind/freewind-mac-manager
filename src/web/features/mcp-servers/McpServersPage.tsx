import { describeError } from "@shared/format"
import { PageHeader } from "@web/components/PageHeader"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Skeleton } from "@web/components/ui/skeleton"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { Blocks, Plus, RefreshCw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  useConnectMcpServer,
  useCreateMcpServer,
  useDeleteMcpServer,
  useDisconnectMcpServer,
  useMcpServersQuery,
  useUpdateMcpServer,
} from "./queries"
import { ServerDetail } from "./ServerDetail"
import { ServerFormDialog } from "./ServerFormDialog"
import { ServerList } from "./ServerList"
import type { McpServer, McpServerInput } from "./types"
import { useMcpSelection } from "./useMcpSelection"

/**
 * MCP Servers 页面。
 *
 * 目前是纯前端演示：服务器配置、连接状态、能力清单和调用结果全部来自
 * `./mock` 里的内存实现，不会真的启动进程或发起网络请求，刷新即重置。
 * 页面的数据与动作只经过 `./queries`，接真实后端时替换那一层即可。
 */
export const McpServersPage = () => {
  const isDesktop = useIsDesktop()
  const query = useMcpServersQuery()
  const selection = useMcpSelection()
  const create = useCreateMcpServer()
  const update = useUpdateMcpServer()
  const remove = useDeleteMcpServer()
  const connect = useConnectMcpServer()
  const disconnect = useDisconnectMcpServer()

  const [busyId, setBusyId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [formFailure, setFormFailure] = useState<string | null>(null)

  const servers = query.data ?? []
  const selected =
    servers.find((item) => item.config.id === selection.serverId) ?? null
  const connectedCount = servers.filter(
    (item) => item.status.state === "connected"
  ).length

  const runConnect = async (server: McpServer): Promise<void> => {
    setBusyId(server.config.id)
    try {
      const result = await connect.mutateAsync(server.config.id)
      if (result.status.state === "failed") {
        toast.error(result.status.lastError ?? "连接失败")
      } else {
        toast.success(`已连接「${result.config.name}」`)
      }
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setBusyId(null)
    }
  }

  const runDisconnect = async (server: McpServer): Promise<void> => {
    setBusyId(server.config.id)
    try {
      await disconnect.mutateAsync(server.config.id)
      toast.success(`已断开「${server.config.name}」`)
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setBusyId(null)
    }
  }

  const runDelete = async (server: McpServer): Promise<boolean> => {
    try {
      await remove.mutateAsync(server.config.id)
      toast.success(`已删除配置「${server.config.name}」`)
      if (selection.serverId === server.config.id) selection.selectServer(null)
      return true
    } catch (error) {
      toast.error(describeError(error))
      return false
    }
  }

  const submitForm = async (input: McpServerInput): Promise<boolean> => {
    setFormFailure(null)
    try {
      if (editing === null) {
        const created = await create.mutateAsync(input)
        toast.success(`已添加「${created.config.name}」`)
        selection.selectServer(created.config.id)
      } else {
        await update.mutateAsync({ serverId: editing.config.id, config: input })
        toast.success("配置已保存")
      }
      return true
    } catch (error) {
      // 保存失败的原因留在表单里持续可见，不用一闪而过的 toast。
      setFormFailure(describeError(error))
      return false
    }
  }

  const openCreate = (): void => {
    setFormFailure(null)
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (server: McpServer): void => {
    setFormFailure(null)
    setEditing(server)
    setDialogOpen(true)
  }

  const list = (
    <ServerList
      servers={servers}
      selectedId={selection.serverId}
      onSelect={(serverId) => selection.selectServer(serverId)}
    />
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <PageHeader title="MCP Servers" loading={query.isLoading} />
        <Badge variant="outline">演示数据</Badge>
        {servers.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            共 {servers.length} 台 · {connectedCount} 台已连接
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="px-3"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden="true" />
            刷新
          </Button>
          <Button size="sm" className="px-3" onClick={openCreate}>
            <Plus aria-hidden="true" />
            添加服务器
          </Button>
        </div>
      </header>

      <Alert className="mx-4 mt-3">
        <AlertTitle>本页是纯前端演示</AlertTitle>
        <AlertDescription>
          服务器、连接状态、能力清单与调用结果都来自浏览器内存里的模拟数据，
          不会启动本机进程、不会访问网络，刷新页面即恢复初始状态。
        </AlertDescription>
      </Alert>

      {query.isLoading ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : query.isError ? (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertTitle>读取服务器列表失败</AlertTitle>
            <AlertDescription>
              {query.error?.message ??
                "没有拿到数据，因此不显示服务器与调用记录。"}
            </AlertDescription>
          </Alert>
          <Button
            variant="outline"
            className="mt-3 px-3"
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden="true" />
            重新读取
          </Button>
        </div>
      ) : isDesktop ? (
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[20rem_1fr] overflow-hidden">
          <aside className="min-h-0 min-w-0 overflow-y-auto border-r p-4">
            {list}
          </aside>
          <div className="flex min-h-0 min-w-0 flex-col">
            {selected ? (
              <ServerDetail
                server={selected}
                tab={selection.tab}
                onSelectTab={selection.selectTab}
                onBack={() => selection.selectServer(null)}
                busy={busyId === selected.config.id}
                onConnect={() => void runConnect(selected)}
                onDisconnect={() => void runDisconnect(selected)}
                onEdit={() => openEdit(selected)}
                onDelete={() => runDelete(selected)}
              />
            ) : (
              <Empty className="flex-1">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Blocks />
                  </EmptyMedia>
                  <EmptyTitle>选一台服务器查看详情</EmptyTitle>
                  <EmptyDescription>
                    左侧列出全部 MCP
                    Server；选中后可以连接、查看能力并试用工具。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </div>
      ) : selected ? (
        <ServerDetail
          server={selected}
          tab={selection.tab}
          onSelectTab={selection.selectTab}
          onBack={() => selection.selectServer(null)}
          busy={busyId === selected.config.id}
          onConnect={() => void runConnect(selected)}
          onDisconnect={() => void runDisconnect(selected)}
          onEdit={() => openEdit(selected)}
          onDelete={() => runDelete(selected)}
        />
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">{list}</div>
      )}

      {dialogOpen ? (
        <ServerFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          server={editing}
          busy={create.isPending || update.isPending}
          failure={formFailure}
          onSubmit={submitForm}
        />
      ) : null}
    </div>
  )
}
