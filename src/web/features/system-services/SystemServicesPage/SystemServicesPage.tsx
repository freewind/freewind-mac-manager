import { ActionButton } from "@web/components/ActionButton"
import { PageHeader } from "@web/components/PageHeader"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  AlertDialog,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@web/components/ui/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@web/components/ui/item"
import { ScrollArea } from "@web/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import { domainLabels, stateLabels } from "@web/features/system-services/labels"
import type {
  DomainFilter,
  StateFilter,
} from "@web/features/system-services/store"
import {
  type PendingAction,
  useSystemServices,
} from "@web/features/system-services/useSystemServices"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { ArrowDown, ArrowUp, RefreshCw, Search, Shield } from "lucide-react"
import { useState } from "react"
import { ServiceDetail } from "./service-detail"
import {
  ACTION_LABELS,
  CONFIRM_TEXTS,
  DOMAIN_ORDER,
  filterSummaryOf,
  ServiceStateIcon,
  STATE_ORDER,
  summaryOf,
} from "./service-display"

export const SystemServicesPage = () => {
  const model = useSystemServices()
  const submission = useDialogSubmit(model.cancelPending, model.isPending)
  useHistoryOverlay(model.pending !== null, model.cancelPending)
  const service = model.selected
  const pending: PendingAction | null = model.pending

  const isDesktop = useIsDesktop()
  /** 手机上详情进 Sheet：默认只显示列表，点选后才打开。 */
  const [detailOpen, setDetailOpen] = useState(false)
  // 系统返回先关详情 Sheet，再退页面（与任务 48/52 同一做法）。
  useHistoryOverlay(!isDesktop && detailOpen, () => setDetailOpen(false))
  /** 状态与域的详细筛选按需展开，搜索与筛选摘要常驻。 */
  const [filtersOpen, setFiltersOpen] = useState(false)
  /** 记住 plist 面板属于哪个服务：切换服务就自动收起，不用额外副作用。 */
  const [plistOpenLabel, setPlistOpenLabel] = useState<string | null>(null)

  const selectService = (label: string) => {
    model.selectService(label)
    if (!isDesktop) setDetailOpen(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <PageHeader title="系统服务" loading={model.isLoading} />
          <Badge variant="outline">共 {model.stats.total}</Badge>
          <Badge variant="ghost">运行 {model.stats.running}</Badge>
          <Badge variant="ghost">已停止 {model.stats.stopped}</Badge>
          <Badge variant="ghost">失败 {model.stats.failed}</Badge>
          <Badge variant="ghost">禁用 {model.stats.disabled}</Badge>
          <Badge variant="ghost">需 root {model.stats.requiresRoot}</Badge>
          {model.skipped.length > 0 ? (
            <Badge variant="ghost" title={model.skipped[0]?.reason}>
              跳过 {model.skipped.length}
            </Badge>
          ) : null}
          {model.isFetching ? <Badge variant="ghost">读取中…</Badge> : null}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={model.refresh}
          >
            <RefreshCw />
            重新读取
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="w-full md:w-80">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={model.keyword}
              onChange={(event) => model.setKeyword(event.target.value)}
              placeholder="搜索 label、程序或 plist 路径"
            />
          </InputGroup>
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <CollapsibleTrigger
              render={
                <Button variant="outline" size="sm" aria-expanded={filtersOpen}>
                  {filtersOpen ? (
                    <ArrowUp aria-hidden="true" />
                  ) : (
                    <ArrowDown aria-hidden="true" />
                  )}
                  详细筛选
                </Button>
              }
            />
            {/* 默认收起，展开后占满一行，不挤压搜索框。 */}
            <CollapsibleContent className="flex w-full flex-wrap items-center gap-2">
              <ToggleGroup
                variant="outline"
                size="sm"
                className="flex-wrap"
                value={[model.stateFilter]}
                onValueChange={(values) =>
                  model.setStateFilter((values[0] ?? "all") as StateFilter)
                }
              >
                <ToggleGroupItem value="all">全部状态</ToggleGroupItem>
                {STATE_ORDER.map((state) => (
                  <ToggleGroupItem key={state} value={state}>
                    {stateLabels[state]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <ToggleGroup
                variant="outline"
                size="sm"
                className="flex-wrap"
                value={[model.domainFilter]}
                onValueChange={(values) =>
                  model.setDomainFilter((values[0] ?? "all") as DomainFilter)
                }
              >
                <ToggleGroupItem value="all">全部域</ToggleGroupItem>
                {DOMAIN_ORDER.map((domain) => (
                  <ToggleGroupItem key={domain} value={domain}>
                    {domainLabels[domain]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </CollapsibleContent>
          </Collapsible>
          <span className="text-xs text-muted-foreground">
            {filterSummaryOf(
              model.stateFilter,
              model.domainFilter,
              model.filtered.length
            )}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <aside className="flex min-h-0 w-full flex-1 flex-col border-b md:w-80 md:flex-none md:border-r md:border-b-0">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
            服务列表
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <ItemGroup className="gap-0.5 px-2 pb-2">
              {model.filtered.map((item) => (
                <Item
                  key={item.label}
                  render={
                    <button
                      type="button"
                      onClick={() => selectService(item.label)}
                    />
                  }
                  variant={
                    model.selectedLabel === item.label ? "muted" : "default"
                  }
                  size="xs"
                  className="cursor-pointer"
                >
                  <ItemMedia variant="icon">
                    <ServiceStateIcon state={item.state} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{item.label}</ItemTitle>
                    <ItemDescription>
                      {domainLabels[item.domain]} · {summaryOf(item)}
                    </ItemDescription>
                  </ItemContent>
                  {item.requiresRoot ? (
                    <ItemActions>
                      <Shield className="size-3 text-muted-foreground" />
                    </ItemActions>
                  ) : null}
                </Item>
              ))}
            </ItemGroup>
            {model.filtered.length === 0 ? (
              <Empty className="mx-2 py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Search />
                  </EmptyMedia>
                  <EmptyTitle>没有符合条件的服务</EmptyTitle>
                  <EmptyDescription>
                    换一个搜索词，或把状态与域的筛选放宽。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
          </ScrollArea>
        </aside>

        {isDesktop ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ServiceDetail
              isLoading={model.isLoading}
              service={service}
              model={model}
              plistOpenLabel={plistOpenLabel}
              onPlistOpenChange={setPlistOpenLabel}
            />
          </div>
        ) : null}
        {isDesktop ? null : (
          <Sheet
            open={detailOpen}
            onOpenChange={(open) => {
              if (!open) setDetailOpen(false)
            }}
          >
            <SheetContent side="right" className="gap-0 p-0 sm:max-w-md">
              <SheetHeader className="border-b p-4">
                <SheetTitle className="sr-only">
                  服务详情：{service?.label ?? "未选择服务"}
                </SheetTitle>
              </SheetHeader>
              <ServiceDetail
                isLoading={model.isLoading}
                service={service}
                model={model}
                plistOpenLabel={plistOpenLabel}
                onPlistOpenChange={setPlistOpenLabel}
              />
            </SheetContent>
          </Sheet>
        )}
      </div>

      {model.error ? (
        <Alert
          variant="destructive"
          className="rounded-none border-x-0 border-b-0"
        >
          <AlertTitle>读取服务失败</AlertTitle>
          <AlertDescription>{model.error}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) model.cancelPending()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending
                ? `${ACTION_LABELS[pending.action]} ${pending.label}？`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? CONFIRM_TEXTS[pending.action].detail : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.busy}>
              取消
            </AlertDialogCancel>
            <ActionButton
              busy={submission.busy}
              busyLabel="执行中…"
              variant={
                pending &&
                ["unload", "stop", "disable"].includes(pending.action)
                  ? "destructive"
                  : "default"
              }
              onClick={() => void submission.submit(model.confirmPending)}
            >
              {pending ? CONFIRM_TEXTS[pending.action].ok : ""}
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
