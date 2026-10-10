import {
  Add01Icon,
  CloudSavingDone01Icon,
  Copy01Icon,
  Link01Icon,
  PlayIcon,
  Radar01Icon,
  RefreshIcon,
  Search01Icon,
  StopIcon,
  TrashIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { FrpProxy, FrpProxyType } from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Field, FieldContent, FieldLabel } from "@web/components/ui/field"
import { Input } from "@web/components/ui/input"
import { ScrollArea } from "@web/components/ui/scroll-area"
import { Separator } from "@web/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import { useFrp } from "@web/features/frp/useFrp"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useState } from "react"
import { toast } from "sonner"
import { ProxyFormDialog } from "./ProxyFormDialog"
import { ProxyTable } from "./ProxyTable"

const TYPE_FILTERS: { key: "all" | FrpProxyType; label: string }[] = [
  { key: "all", label: "全部类型" },
  { key: "tcp", label: "TCP" },
  { key: "udp", label: "UDP" },
  { key: "http", label: "HTTP" },
  { key: "https", label: "HTTPS" },
]

const InfoField = (props: { label: string; children: React.ReactNode }) => (
  <Field orientation="horizontal" className="gap-2">
    <FieldLabel className="w-28 shrink-0 text-muted-foreground">
      {props.label}
    </FieldLabel>
    <FieldContent className="text-xs break-all">{props.children}</FieldContent>
  </Field>
)

export const FrpPage = () => {
  const model = useFrp()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FrpProxy | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FrpProxy | null>(null)

  useHistoryOverlay(formOpen || pendingDelete !== null, () => {
    setFormOpen(false)
    setEditing(null)
    setPendingDelete(null)
  })

  const server = model.server

  const openCreate = () => {
    if (model.saving) return
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (proxy: FrpProxy) => {
    if (model.saving) return
    setEditing(proxy)
    setFormOpen(true)
  }

  const copyToml = async () => {
    try {
      await navigator.clipboard.writeText(model.toml)
      toast.success("已复制 frpc 配置内容")
    } catch {
      toast.error("复制失败：浏览器拒绝了剪贴板访问")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon icon={Link01Icon} className="size-4" />
          <h1 className="text-sm font-medium">FRP 内网穿透</h1>
          {server ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {server.serverAddr}:{server.serverPort}
              <Badge
                variant={server.state === "running" ? "secondary" : "outline"}
              >
                {server.state === "running" ? "运行中" : "已停止"}
              </Badge>
            </span>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={model.saving}
              onClick={openCreate}
            >
              <HugeiconsIcon icon={Add01Icon} />
              新增隧道
            </Button>
            <ActionButton
              variant="outline"
              size="sm"
              busy={model.probing}
              busyLabel="探测中…"
              onClick={() => void model.probeAll()}
            >
              <HugeiconsIcon icon={Radar01Icon} />
              探测全部
            </ActionButton>
            <ActionButton
              variant="outline"
              size="sm"
              busy={model.isFetching}
              busyLabel="读取中…"
              onClick={model.refresh}
              disabled={model.saving}
            >
              <HugeiconsIcon icon={RefreshIcon} />
              重新读取
            </ActionButton>
            <ActionButton
              size="sm"
              busy={model.saving}
              busyLabel="保存中…"
              disabled={!model.dirty || formOpen || pendingDelete !== null}
              onClick={model.save}
            >
              <HugeiconsIcon icon={CloudSavingDone01Icon} />
              保存
            </ActionButton>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full md:w-80">
            <HugeiconsIcon
              icon={Search01Icon}
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={model.search}
              onChange={(event) => model.setSearch(event.target.value)}
              placeholder="搜索隧道名、本地或远程端口"
              className="pl-7"
            />
          </div>
          <ToggleGroup
            value={[model.typeFilter]}
            onValueChange={(values) =>
              model.setTypeFilter((values[0] ?? "all") as "all" | FrpProxyType)
            }
          >
            {TYPE_FILTERS.map((item) => (
              <ToggleGroupItem key={item.key} value={item.key}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className="text-xs text-muted-foreground">
            显示 {model.visibleProxies.length} / {model.summary.total} 条
          </span>
          {model.dirty ? (
            <Badge variant="outline" className="text-amber-600">
              有未保存的改动
            </Badge>
          ) : model.hasConfig ? (
            <Badge variant="ghost">已保存</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              配置未读到
            </Badge>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col gap-4 p-4">
          {model.error ? (
            <Alert variant="destructive">
              <AlertTitle>读取 frpc 配置失败</AlertTitle>
              <AlertDescription>{model.error}</AlertDescription>
            </Alert>
          ) : null}
          {server ? (
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm">服务端</CardTitle>
                <CardDescription>frpc 连接的服务端与运行环境</CardDescription>
                <CardAction>
                  <Badge
                    variant={
                      server.state === "running" ? "secondary" : "destructive"
                    }
                  >
                    <HugeiconsIcon
                      icon={server.state === "running" ? PlayIcon : StopIcon}
                    />
                    {server.state === "running" ? "运行中" : "已停止"}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 lg:grid-cols-2">
                <InfoField label="服务地址">
                  <span className="font-mono">
                    {server.serverAddr}:{server.serverPort}
                  </span>
                </InfoField>
                <InfoField label="鉴权方式">
                  {server.authMethod} /{" "}
                  <span className="font-mono">******</span>
                </InfoField>
                <InfoField label="配置文件">
                  <span className="font-mono">{server.configPath}</span>
                </InfoField>
                <InfoField label="frpc 路径">
                  <span className="font-mono">{server.binaryPath}</span>
                </InfoField>
                <InfoField label="launchd">
                  <span className="font-mono">{server.launchdLabel}</span>
                </InfoField>
                <InfoField label="PID">
                  {server.pid === null ? "—" : server.pid}
                </InfoField>
                <InfoField label="启动时间">
                  {server.startedAt === null
                    ? "—"
                    : formatTimestamp(server.startedAt)}
                </InfoField>
                <InfoField label="探测结果">
                  可达 {model.summary.reachable} · 不可达{" "}
                  {model.summary.unreachable}
                </InfoField>
              </CardContent>
            </Card>
          ) : null}

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">隧道列表</CardTitle>
              <CardDescription>
                每条隧道把本机端口映射到公网远程端口
              </CardDescription>
            </CardHeader>
            <Separator />
            <ProxyTable
              model={model}
              onEdit={openEdit}
              onDelete={setPendingDelete}
            />
          </Card>

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">frpc 配置预览</CardTitle>
              <CardDescription>
                保存时写入 {server?.configPath ?? "配置文件"}
              </CardDescription>
              <CardAction>
                <Button variant="outline" size="xs" onClick={copyToml}>
                  <HugeiconsIcon icon={Copy01Icon} />
                  复制
                </Button>
              </CardAction>
            </CardHeader>
            <Separator />
            <ScrollArea className="max-h-72">
              <pre className="p-3 font-mono text-[0.6875rem] leading-relaxed">
                {model.toml}
              </pre>
            </ScrollArea>
          </Card>
        </div>
      </div>

      {formOpen ? (
        <ProxyFormDialog
          key={editing?.name ?? "__new__"}
          onOpenChange={setFormOpen}
          editing={editing}
          existingNames={model.existingNames}
          onSubmit={(proxy) => {
            if (editing) {
              model.update(editing.name, proxy)
            } else {
              model.create(proxy)
            }
          }}
        />
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除隧道 {pendingDelete?.name}？
            </AlertDialogTitle>
            <AlertDialogDescription>
              删除后该映射从配置中移除；需保存并重载 frpc
              才会生效，删除不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) model.remove(pendingDelete.name)
                setPendingDelete(null)
              }}
            >
              <HugeiconsIcon icon={TrashIcon} />
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
