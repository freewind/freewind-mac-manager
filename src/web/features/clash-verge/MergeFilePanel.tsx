import { CLASH_VERGE_MERGE_MAX_CHARS } from "@shared/api-contract/schemas/clash-verge"
import { ApiRequestError } from "@shared/client-api"
import { describeError, formatBytes, formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { useState } from "react"
import { toast } from "sonner"
import { LineTextarea, MergeContentPreview } from "./MergeEditor"
import { MERGE_ALIAS_TEMPLATE } from "./merge-template"
import { useClashVergeMergeFileQuery, useSaveClashVergeMerge } from "./queries"

/**
 * 全局 Merge 规则面板（查看 + 编辑 + 保存）。
 *
 * 编辑器选型：monaco-editor 实测后降级为带行号的 textarea——
 * 安装 102MB；Vite 产出 editor.api 3.5MB + 高对比主题 1.5MB + CSS 381KB
 * （gzip 约 1.1MB）另加 150KB codicon 字体，对手机优先的 PWA 首载负担过重；
 * YAML 校验还需再装 monaco-yaml；jsdom 缺 matchMedia 需全局 polyfill
 * 才能在测试里初始化。见任务 20 实测记录。
 *
 * 写操作约束：保存中禁止重复提交；超时/中断显示「结果未知」并禁止继续
 * 提交，只允许重新读取核实；保存前预检 modified，外部修改不静默覆盖。
 */

/** 保存只落盘，重载才生效；不触碰订阅专属 merge（服务端同名限制）。 */
const RELOAD_NOTICE =
  "保存只落盘：需在 Clash Verge 内重载配置才生效；本面板不修改订阅专属 merge"

export const MergeFilePanel = () => {
  const fileQuery = useClashVergeMergeFileQuery()
  const save = useSaveClashVergeMerge()
  const file = fileQuery.data

  const [draft, setDraft] = useState<string | null>(null)
  /** 进入编辑时的 modified 基线：与磁盘不一致即外部修改。 */
  const [baseline, setBaseline] = useState<number | null>(null)
  /** 预检发现的外部修改时间；存在时禁止普通保存，直到用户重载或显式覆盖。 */
  const [precheckConflict, setPrecheckConflict] = useState<number | null>(null)
  /** 结果未知（超时/中断）：已发出但未确认，禁止再提交，只能重新读取核实。 */
  const [unknown, setUnknown] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const editing = draft !== null
  const fileOverLimit =
    file !== undefined && file.content.length > CLASH_VERGE_MERGE_MAX_CHARS
  const draftOverLimit =
    draft !== null && draft.length > CLASH_VERGE_MERGE_MAX_CHARS

  // 冲突两个来源取并：预检结果（查询可能未刷新）与查询数据刷新后的
  // modified 对比，纯推导不额外触发 effect。
  const conflict =
    editing &&
    file !== undefined &&
    baseline !== null &&
    file.modified !== baseline
      ? file.modified
      : precheckConflict

  const startEdit = () => {
    if (!file || fileOverLimit || unknown) return
    setDraft(file.content)
    setBaseline(file.modified)
    setPrecheckConflict(null)
    setFailure(null)
  }

  const cancelEdit = () => {
    setDraft(null)
    setBaseline(null)
    setPrecheckConflict(null)
    setFailure(null)
  }

  const runSave = (overwrite: boolean) => {
    if (
      draft === null ||
      baseline === null ||
      save.isPending ||
      draftOverLimit ||
      unknown ||
      // 冲突时普通保存被拦，只有显式覆盖（overwrite）能继续。
      (conflict !== null && !overwrite)
    ) {
      return
    }
    setFailure(null)
    save.mutate(
      { content: draft, baselineModified: baseline, overwrite },
      {
        onSuccess: (result) => {
          if (result.kind === "conflict") {
            setPrecheckConflict(result.remoteModified)
            return
          }
          // 成功：回到只读，modified 由查询失效后拉取的最新值展示。
          setDraft(null)
          setBaseline(null)
          setPrecheckConflict(null)
          setUnknown(false)
          // 动作编排处只触发一次成功提示；文案自带重载限制。
          toast.success(result.message)
        },
        onError: (error) => {
          if (error instanceof ApiRequestError && error.resultUnknown) {
            // 结果未知不是失败：不谎报成功，也不允许重发。
            setUnknown(true)
            return
          }
          setFailure(describeError(error))
        },
      }
    )
  }

  /** 结果未知后的核实：重新读取，比对磁盘内容与本次编辑，如实报告。 */
  const verifyUnknown = async () => {
    setFailure(null)
    try {
      const latest = await fileQuery.refetch()
      const remote = latest.data
      if (remote === undefined) return
      if (draft === null) {
        // 已退出编辑（只剩结果未知标记）：对齐磁盘即可，无需比对文案。
        setUnknown(false)
        setBaseline(remote.modified)
        return
      }
      if (remote.content === draft) {
        setDraft(null)
        setBaseline(null)
        setPrecheckConflict(null)
        setUnknown(false)
        toast.success("已核实：修改已写入磁盘")
        return
      }
      // 未写入或被改动：基线对齐当前磁盘，后续保存由预检再次把关。
      setUnknown(false)
      setBaseline(remote.modified)
      setFailure("重新读取完成：磁盘内容与当前编辑不一致，请核对后再决定")
    } catch (error) {
      // 核实请求本身失败：结果仍未知，保留状态等下一次核实。
      setFailure(`重新读取失败：${describeError(error)}`)
    }
  }

  const reloadFromDisk = () => {
    cancelEdit()
    setUnknown(false)
    void fileQuery.refetch()
  }

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(MERGE_ALIAS_TEMPLATE)
      toast.success("已复制别名行模板到剪贴板")
    } catch {
      toast.error("复制失败：浏览器拒绝了剪贴板访问")
    }
  }

  return (
    <section className="space-y-3" aria-label="全局 Merge 规则">
      <div>
        <h2 className="text-sm font-medium">全局 Merge 规则</h2>
        <p className="text-xs text-muted-foreground">
          Clash Verge 全局 Merge（uid: Merge），对所有订阅生效
        </p>
      </div>

      <Alert>
        <AlertTitle>保存前必读</AlertTitle>
        <AlertDescription>{RELOAD_NOTICE}</AlertDescription>
      </Alert>

      {file !== undefined ? (
        <>
          {/* 有数据时优先展示数据；刷新失败只提示，不丢掉编辑态。 */}
          {fileQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>刷新失败</AlertTitle>
              <AlertDescription>
                {`${describeError(fileQuery.error)}（当前显示上次读取的内容）`}
              </AlertDescription>
            </Alert>
          ) : null}
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>
              <dt className="inline">路径：</dt>
              <dd className="inline break-all">{file.path}</dd>
            </div>
            <div>
              <dt className="inline">大小：</dt>
              <dd className="inline">{formatBytes(file.size)}</dd>
            </div>
            <div>
              <dt className="inline">修改于：</dt>
              <dd className="inline">{formatTimestamp(file.modified)}</dd>
            </div>
          </dl>

          {conflict !== null ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>检测到外部修改</AlertTitle>
              <AlertDescription>
                {`文件已在别处被修改（磁盘修改时间 ${formatTimestamp(conflict)}），不会静默覆盖。请重新加载放弃本地修改，或显式覆盖保存。`}
                <span className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    onClick={reloadFromDisk}
                    disabled={save.isPending}
                  >
                    重新加载
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="min-h-11"
                    onClick={() => runSave(true)}
                    disabled={save.isPending || draftOverLimit || unknown}
                  >
                    显式覆盖保存
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}

          {unknown ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>结果未知</AlertTitle>
              <AlertDescription>
                保存请求超时或中断：可能已写入，也可能没有。不自动重试；请重新读取核实后再决定。
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 min-h-11"
                  onClick={() => void verifyUnknown()}
                  disabled={save.isPending}
                >
                  重新读取核实
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {failure !== null ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>操作失败</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}

          {editing ? (
            <div className="space-y-2">
              <LineTextarea
                value={draft ?? ""}
                onChange={setDraft}
                ariaLabel="编辑 Merge 规则内容"
              />
              {draftOverLimit ? (
                <p className="text-xs text-destructive" role="alert">
                  {`内容超过 ${CLASH_VERGE_MERGE_MAX_CHARS} 字符上限，已禁用保存；请拆分后再保存`}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="min-h-11"
                  onClick={() => runSave(false)}
                  disabled={
                    save.isPending ||
                    draftOverLimit ||
                    conflict !== null ||
                    unknown ||
                    draft === file.content
                  }
                >
                  {save.isPending ? "保存中…" : "保存"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  onClick={cancelEdit}
                  disabled={save.isPending}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => void copyTemplate()}
                >
                  复制别名行模板
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {file.content.length === 0 ? (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                  文件为空，可点击「编辑」添加规则
                </p>
              ) : (
                <MergeContentPreview content={file.content} />
              )}
              {fileOverLimit ? (
                <p className="text-xs text-destructive" role="alert">
                  {`文件超过 ${CLASH_VERGE_MERGE_MAX_CHARS} 字符上限，已禁用编辑；请在本地编辑器中处理`}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="min-h-11"
                  onClick={startEdit}
                  disabled={fileOverLimit || unknown}
                >
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void copyTemplate()}
                >
                  复制别名行模板
                </Button>
              </div>
            </div>
          )}
        </>
      ) : fileQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>读取失败</AlertTitle>
          <AlertDescription>
            {describeError(fileQuery.error)}
            <Button
              size="sm"
              variant="outline"
              className="mt-2 min-h-11"
              onClick={() => void fileQuery.refetch()}
            >
              重新读取
            </Button>
          </AlertDescription>
        </Alert>
      ) : fileQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">
          正在读取全局 Merge 文件…
        </p>
      ) : (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          没有可显示的 Merge 内容
        </p>
      )}
    </section>
  )
}
