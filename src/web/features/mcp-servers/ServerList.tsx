import { Badge } from "@web/components/ui/badge"
import { Input } from "@web/components/ui/input"
import { cn } from "cn"
import { Search } from "lucide-react"
import { useState } from "react"
import {
  CONNECTION_LABELS,
  CONNECTION_VARIANTS,
  formatRelative,
} from "./format"
import type { McpServer } from "./types"

type ServerListProps = {
  servers: McpServer[]
  selectedId: string | null
  onSelect: (serverId: string) => void
}

const metaOf = (server: McpServer): string => {
  const parts: string[] = [
    server.config.transport === "stdio" ? "stdio" : "http",
  ]
  const toolCount = server.capabilities?.tools.length ?? 0
  parts.push(toolCount > 0 ? `${toolCount} 个工具` : "能力未知")
  if (server.config.tags.length > 0) parts.push(server.config.tags.join(" / "))
  return parts.join(" · ")
}

/**
 * 服务器列表。
 *
 * 只负责选择，不放连接、编辑、删除等动作：动作集中在详情页头部，避免同一份
 * 操作在两处出现两份实现。手机上是整页列表，桌面是左侧栏。
 */
export const ServerList = (props: ServerListProps) => {
  const [keyword, setKeyword] = useState("")
  const normalized = keyword.trim().toLowerCase()
  const visible =
    normalized === ""
      ? props.servers
      : props.servers.filter((server) =>
          [
            server.config.name,
            server.config.description,
            ...server.config.tags,
          ].some((text) => text.toLowerCase().includes(normalized))
        )

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          id="mcp-server-search"
          aria-label="搜索服务器"
          placeholder="按名称、说明或标签搜索"
          autoComplete="off"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Search
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </div>

      {props.servers.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          还没有配置任何 MCP Server。点右上角「添加服务器」开始。
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          没有匹配「{keyword.trim()}」的服务器。
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {visible.map((server) => {
            const selected = server.config.id === props.selectedId
            return (
              <li key={server.config.id} className="min-w-0">
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "flex w-full min-w-0 flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                    selected ? "border-ring bg-muted/60" : "hover:bg-muted/50",
                    !server.config.enabled && "opacity-70"
                  )}
                  onClick={() => props.onSelect(server.config.id)}
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-medium">
                      {server.config.name}
                    </span>
                    <Badge variant={CONNECTION_VARIANTS[server.status.state]}>
                      {CONNECTION_LABELS[server.status.state]}
                    </Badge>
                    {!server.config.enabled ? (
                      <Badge variant="outline">已停用</Badge>
                    ) : null}
                  </span>
                  <span className="text-xs break-words text-muted-foreground">
                    {server.config.description}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {metaOf(server)}
                    {server.status.connectedAt !== null
                      ? ` · ${formatRelative(server.status.connectedAt)}连上`
                      : ""}
                  </span>
                  {server.status.lastError ? (
                    <span className="text-xs break-words text-destructive">
                      {server.status.lastError}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
