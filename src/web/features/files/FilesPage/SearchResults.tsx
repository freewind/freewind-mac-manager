import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import { relativeToRoot } from "@web/features/files/domain"
import type { FilesModel } from "@web/features/files/useFiles"

/**
 * 搜索结果面板：只读展示文件名与内容两种命中。
 * 打开某条结果复用现有导航与选择（跳到所在目录并选中），不新增预览页。
 */
export const SearchResults = ({ model }: { model: FilesModel }) => {
  if (!model.search.active) return null
  const result = model.searchResult

  return (
    <div className="flex min-w-0 flex-col gap-2 border-b bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          搜索「{model.search.query}」（
          {model.search.searchContent ? "文件名与内容" : "仅文件名"} ·{" "}
          {model.search.scope === "current" ? "仅当前目录" : "含子目录"}）
        </span>
        {model.searchLoading ? <span>搜索中…</span> : null}
        {result ? (
          <span>
            命中 {result.matches.length} 条 · 已扫描 {result.scannedFiles}{" "}
            个文件
          </span>
        ) : null}
        {result?.truncated ? (
          <span className="text-destructive">结果已截断，只显示前一部分</span>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={model.clearSearch}
        >
          退出搜索
        </Button>
      </div>

      {model.searchError ? (
        <p role="alert" className="text-xs text-destructive">
          搜索失败：
          {model.searchError instanceof Error
            ? model.searchError.message
            : String(model.searchError)}
        </p>
      ) : null}

      {result && result.matches.length === 0 && !model.searchLoading ? (
        <p className="text-xs text-muted-foreground">
          {model.search.scope === "current"
            ? "当前目录没有匹配的文件；子目录里可能有，切到「含子目录」再试。"
            : "这个目录及其子目录都没有匹配的文件。"}
        </p>
      ) : null}

      {result && result.matches.length > 0 ? (
        <ul className="flex max-h-64 min-w-0 flex-col gap-1 overflow-auto">
          {result.matches.map((match) => (
            <li
              key={match.path}
              className="flex min-w-0 flex-wrap items-center gap-2 text-xs"
            >
              <Badge
                variant={match.source === "content" ? "secondary" : "outline"}
              >
                {match.source === "content" ? "内容" : "文件名"}
              </Badge>
              <Button
                variant="link"
                size="sm"
                className="px-1"
                onClick={() => model.openSearchResult(match.path)}
              >
                {match.name}
              </Button>
              <span className="min-w-0 truncate text-muted-foreground">
                {relativeToRoot(result.root, match.path)}
              </span>
              {match.snippet ? (
                <span className="w-full min-w-0 break-all font-mono text-[0.6875rem] text-muted-foreground">
                  第 {match.lineNumber} 行：{match.snippet}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
