import type { CaddyRule, CaddyRuleInput } from "@shared/api-contract"
import { PageHeader } from "@web/components/PageHeader"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { Skeleton } from "@web/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import { useCaddy } from "@web/features/caddy/useCaddy"
import {
  CADDY_TABS,
  type CaddyTab,
  useCaddyTab,
} from "@web/features/caddy/useCaddyTab"
import { Plus, RefreshCw } from "lucide-react"
import { useState } from "react"
import { changeSummaryOf } from "../format"
import { ApplyPanel } from "./ApplyPanel"
import { RuleFormDialog } from "./RuleFormDialog"
import { ExternalRulesSection, RuleList } from "./RuleList"
import { StatusPanel } from "./StatusPanel"
import { VersionPanel } from "./VersionPanel"

/**
 * Caddy 网关页。
 *
 * 手机与桌面共享同一份数据与动作，只有渲染差异（规则列表用卡片还是表格）。
 * 主体按「规则 / 变更预览 / 版本历史」分区，每个分区只有一个滚动区；
 * 顶部只留一句话状态与关键阻塞提示，详细现状在「变更预览」里。
 */
export const CaddyPage = () => {
  const model = useCaddy()
  const { tab, selectTab } = useCaddyTab()
  const data = model.data
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CaddyRule | null>(null)
  // 搜索词放在页面：切到别的标签时列出卸载，筛选不能被清掉。
  const [ruleSearch, setRuleSearch] = useState("")

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
        <PageHeader title="Caddy 网关" titleClassName="text-base" loading />
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
          className="mt-3 px-3"
          onClick={() => void model.refresh()}
        >
          <RefreshCw aria-hidden="true" />
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
  const changeSummary = changeSummaryOf(data.changes)

  /** 顶部一句话状态：详细现状（进程、接口、受管区域）在「变更预览」里。 */
  const statusSummary = [
    data.status.processRunning ? "Caddy 运行中" : "Caddy 未运行",
    data.status.adminReachable ? "管理接口可达" : "管理接口不可达",
    data.status.managedRegionPresent ? "受管区域已建立" : "受管区域未建立",
    changeSummary.total > 0
      ? `未应用变更 ${changeSummary.total} 处`
      : "没有未应用变更",
  ].join(" · ")

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <PageHeader
            title="Caddy 网关"
            titleClassName="text-base"
            loading={model.isLoading}
          />
          <p className="truncate text-xs text-muted-foreground">
            {statusSummary}
          </p>
          <Button
            variant="outline"
            className="ml-auto shrink-0 px-3"
            disabled={model.isFetching}
            onClick={() => void model.refresh()}
          >
            <RefreshCw aria-hidden="true" />
            重新读取
          </Button>
        </div>
        <CaddyTabNav tab={tab} selectTab={selectTab} />
      </header>

      {!model.online ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertTitle>当前处于离线状态</AlertTitle>
          <AlertDescription>{writeDisabledReason}</AlertDescription>
        </Alert>
      ) : null}

      {data.blockedReason ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertTitle>现在不能应用变更</AlertTitle>
          <AlertDescription>{data.blockedReason}</AlertDescription>
        </Alert>
      ) : null}

      {model.actionFailure ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertTitle>刚才的操作没有完成</AlertTitle>
          <AlertDescription>{model.actionFailure}</AlertDescription>
        </Alert>
      ) : null}

      {data.managedRegionDrifted ? (
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          受管区域被手工改动过，应用变更会覆盖手工改动；详细说明在「变更预览」。
        </p>
      ) : null}

      {/* 每个标签只有一个主体滚动区，滚动不再把整页内容往下推 */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        {tab === "rules" ? (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">规则</h2>
              <Button
                variant="outline"
                className="ml-auto shrink-0 px-3"
                disabled={ruleBusy || writeDisabledReason !== null}
                onClick={openCreate}
              >
                <Plus aria-hidden="true" />
                新增规则
              </Button>
            </div>

            <ExternalRulesSection
              externalRules={data.externalRules}
              unsupportedLines={data.unsupportedLines}
              unsupportedSamples={data.unsupportedSamples}
              busy={ruleBusy}
              disabledReason={writeDisabledReason}
              onImport={model.importExisting}
            />

            <RuleList
              rules={data.rules}
              busy={ruleBusy}
              disabledReason={writeDisabledReason}
              search={ruleSearch}
              onSearchChange={setRuleSearch}
              onEdit={openEdit}
              onSetEnabled={model.setEnabled}
              onDelete={model.remove}
            />
          </div>
        ) : null}

        {tab === "preview" ? (
          <div className="flex min-w-0 flex-col gap-4">
            <StatusPanel
              status={data.status}
              hasUnappliedChanges={data.hasUnappliedChanges}
              drifted={data.managedRegionDrifted}
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
          </div>
        ) : null}

        {tab === "versions" ? (
          <VersionPanel
            versions={model.versions}
            isLoading={model.versionsLoading}
            error={model.versionsError}
            busy={model.restoreBusy}
            disabledReason={writeDisabledReason}
            onRestore={model.restore}
          />
        ) : null}
      </div>

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

/**
 * 分区导航。
 * 分区状态放 URL（?caddyTab=preview），刷新、分享与浏览器返回都能恢复。
 */
const CaddyTabNav = (props: {
  tab: CaddyTab
  selectTab: (tab: CaddyTab) => void
}) => (
  <ToggleGroup
    variant="outline"
    className="flex-wrap"
    value={[props.tab]}
    onValueChange={(values) => {
      const next = values[0]
      if (next) props.selectTab(next as CaddyTab)
    }}
  >
    {CADDY_TABS.map((item) => (
      <ToggleGroupItem key={item.key} value={item.key} className="px-3">
        {item.label}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
)
