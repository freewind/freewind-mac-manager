import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@web/components/ui/breadcrumb"
import type { PathCrumb } from "@web/features/files/domain"
import { Fragment } from "react"

type PathBreadcrumbProps = {
  crumbs: PathCrumb[]
  onNavigate: (path: string) => void
}

/**
 * 当前路径的一串面包屑；最后一段是当前位置，其余可点击回退。
 * 外层横向滚动 + 内容一行展开，长路径不会把顶部撑成多行；
 * 每段用原生 title 给出完整路径。
 */
export const PathBreadcrumb = ({ crumbs, onNavigate }: PathBreadcrumbProps) => {
  if (crumbs.length === 0) return null

  return (
    <div className="min-w-0 overflow-x-auto">
      <Breadcrumb>
        <BreadcrumbList className="w-max">
          {crumbs.map((crumb, index) => {
            const isCurrent = index === crumbs.length - 1
            return (
              <Fragment key={crumb.path}>
                {index > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem className="min-w-0">
                  {isCurrent ? (
                    <BreadcrumbPage
                      className="max-w-[40ch] truncate"
                      title={crumb.path}
                    >
                      {crumb.name}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      href={crumb.path}
                      className="max-w-[24ch] truncate"
                      title={crumb.path}
                      onClick={(event) => {
                        event.preventDefault()
                        onNavigate(crumb.path)
                      }}
                    >
                      {crumb.name}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}
