import { Add01Icon, RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CaddyRule, CaddyRuleInput } from "@shared/api-contract"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { Skeleton } from "@web/components/ui/skeleton"
import { useCaddy } from "@web/features/caddy/useCaddy"
import { useState } from "react"
import { ApplyPanel } from "./ApplyPanel"
import { RuleFormDialog } from "./RuleFormDialog"
import { ExternalRulesSection, RuleList } from "./RuleList"
import { StatusPanel } from "./StatusPanel"
import { VersionPanel } from "./VersionPanel"

/**
 * Caddy 网关页。
 *
 * 手机与桌面共享同一份数据与动作，只有渲染差异（规则列表用卡片还是表格）。
 * 现状、阻塞原因、变更预览、历史版本都在这里，页面本身不直接调后端。
 */
export const CaddyPage = () => {
  const model = useCaddy()
  const data = model.data
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CaddyRule | null>(null)

  const openCreate = (): void => {
    model.clearFormFailure()
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (rule: CaddyRule): void => {
    model.clearFormFailure()
    setEditing(rule)
    setDialogOpen(true)
  }

  const submitForm = (input: CaddyRuleInput): Promise<boolean> =>
    editing === null ? model.create(input) : model.update(editing.id, input)

  if (model.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <p className="text-sm text-muted-foreground">正在读取 Caddy 状态…</p>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  if (model.isError || data === null) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTitle>读取 Caddy 状态失败</AlertTitle>
          <AlertDescription>
            {model.error ?? "没有拿到状态数据，因此不显示规则与预览。"}
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          className="mt-3 min-h-11 px-3"
          onClick={() => void model.refresh()}
        >
          <HugeiconsIcon icon={RefreshIcon} aria-hidden="true" />
          重新读取
        </Button>
      </div>
    )
  }

  // 离线时所有写入口都禁用；原因用持续可见的 Alert 说明，不用 toast。
  const writeDisabledReason = model.online
    ? null
    : "离线状态下不能新增、修改、导入规则，也不能应用或恢复配置。"
  const ruleBusy = model.ruleBusy

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-base font-medium">Caddy 网关</h1>
        <p className="text-xs text-muted-foreground">
          管理受管区域里的转发规则；改动先存数据库，应用后才写进 Caddyfile
        </p>
        <Button
          variant="outline"
          className="ml-auto min-h-11 shrink-0 px-3"
          disabled={model.isFetching}
          onClick={() => void model.refresh()}
        >
          <HugeiconsIcon icon={RefreshIcon} aria-hidden="true" />
          重新读取
        </Button>
      </header>

      {!model.online ? (
        <Alert variant="destructive">
          <AlertTitle>当前处于离线状态</AlertTitle>
          <AlertDescription>{writeDisabledReason}</AlertDescription>
        </Alert>
      ) : null}

      <StatusPanel
        status={data.status}
        hasUnappliedChanges={data.hasUnappliedChanges}
        drifted={data.managedRegionDrifted}
      />

      {data.blockedReason ? (
        <Alert variant="destructive">
          <AlertTitle>现在不能应用变更</AlertTitle>
          <AlertDescription>{data.blockedReason}</AlertDescription>
        </Alert>
      ) : null}

      {model.actionFailure ? (
        <Alert variant="destructive">
          <AlertTitle>刚才的操作没有完成</AlertTitle>
          <AlertDescription>{model.actionFailure}</AlertDescription>
        </Alert>
      ) : null}

      <ExternalRulesSection
        externalRules={data.externalRules}
        unsupportedLines={data.unsupportedLines}
        unsupportedSamples={data.unsupportedSamples}
        busy={ruleBusy}
        disabledReason={writeDisabledReason}
        onImport={model.importExisting}
      />

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">规则</h2>
        <Button
          variant="outline"
          className="ml-auto min-h-11 shrink-0 px-3"
          disabled={ruleBusy || writeDisabledReason !== null}
          onClick={openCreate}
        >
          <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
          新增规则
        </Button>
      </div>

      <RuleList
        rules={data.rules}
        busy={ruleBusy}
        disabledReason={writeDisabledReason}
        onEdit={openEdit}
        onSetEnabled={model.setEnabled}
        onDelete={model.remove}
      />

      <ApplyPanel
        changes={data.changes}
        previewText={data.previewText}
        writable={data.writable}
        blockedReason={data.blockedReason}
        hasUnappliedChanges={data.hasUnappliedChanges}
        busy={model.applyBusy}
        disabledReason={writeDisabledReason}
        onApply={model.apply}
      />

      <VersionPanel
        versions={model.versions}
        isLoading={model.versionsLoading}
        error={model.versionsError}
        busy={model.restoreBusy}
        disabledReason={writeDisabledReason}
        onRestore={model.restore}
      />

      {dialogOpen ? (
        <RuleFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          rule={editing}
          busy={ruleBusy}
          failure={model.formFailure}
          onSubmit={submitForm}
        />
      ) : null}
    </div>
  )
}
