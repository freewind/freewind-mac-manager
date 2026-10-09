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

/** 当前路径的一串面包屑；最后一段是当前位置，其余可点击回退。 */
export const PathBreadcrumb = ({ crumbs, onNavigate }: PathBreadcrumbProps) => {
  if (crumbs.length === 0) return null

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isCurrent = index === crumbs.length - 1
          return (
            <Fragment key={crumb.path}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem className="min-w-0">
                {isCurrent ? (
                  <BreadcrumbPage className="truncate">
                    {crumb.name}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    href={crumb.path}
                    className="truncate"
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
  )
}
