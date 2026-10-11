import type { CaddyStatus } from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import type { ReactNode } from "react"

type StatusPanelProps = {
  status: CaddyStatus
  hasUnappliedChanges: boolean
  /** 受管区域被手工改动过：持续可见的提示，不用 toast。 */
  drifted: boolean
}

const Fact = (props: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-1">
    <dt className="text-xs text-muted-foreground">{props.label}</dt>
    <dd className="text-sm break-words">{props.children}</dd>
  </div>
)

/**
 * 现状区。
 *
 * 进程、管理接口、配置文件与运行配置是四件独立的事，因此并列展示，
 * 不合并成一个「正常」总状态——合并会掩盖「文件已生效但接口不可达」这类组合。
 */
export const StatusPanel = (props: StatusPanelProps) => (
  <Card className="gap-3 py-4">
    <CardHeader className="px-4">
      <CardTitle className="text-sm">当前状态</CardTitle>
    </CardHeader>
    <CardContent className="px-4">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Caddy 进程">
          <Badge
            variant={props.status.processRunning ? "secondary" : "outline"}
          >
            {props.status.processRunning ? "运行中" : "未运行"}
          </Badge>
        </Fact>
        <Fact label="Caddy 版本">
          {props.status.version ?? "未知（读不到 caddy 二进制）"}
        </Fact>
        <Fact label="管理接口">
          <Badge
            variant={props.status.adminReachable ? "secondary" : "outline"}
          >
            {props.status.adminReachable ? "可达" : "不可达"}
          </Badge>
          {props.status.adminReachable ? null : (
            <span className="ml-2 text-xs text-muted-foreground">
              配置里 admin off 时无法平滑加载，应用变更会被拒绝
            </span>
          )}
        </Fact>
        <Fact label="受管区域">
          <Badge
            variant={
              props.status.managedRegionPresent ? "secondary" : "destructive"
            }
          >
            {props.status.managedRegionPresent ? "已建立" : "尚未建立"}
          </Badge>
        </Fact>
        <Fact label="未应用的变更">
          <Badge variant={props.hasUnappliedChanges ? "outline" : "secondary"}>
            {props.hasUnappliedChanges ? "有" : "无"}
          </Badge>
        </Fact>
        <Fact label="数据读取时间">{formatTimestamp(props.status.readAt)}</Fact>
      </dl>

      <div className="mt-3 break-all text-xs text-muted-foreground">
        配置文件 {props.status.configFile}；备份目录由服务端管理；launchd 标签{" "}
        {props.status.launchdLabel}
      </div>

      {props.drifted ? (
        <Alert className="mt-3">
          <AlertTitle>受管区域被手工改动过</AlertTitle>
          <AlertDescription>
            文件里受管区域的内容与数据库里的规则不一致。应用变更会用它覆盖这一区域，
            手工改动会丢失；如果手工改动是你想要的，请先按文件内容更新规则。
          </AlertDescription>
        </Alert>
      ) : null}
    </CardContent>
  </Card>
)
