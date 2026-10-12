import {
  type ComponentType,
  createElement,
  lazy,
  type ReactNode,
  Suspense,
} from "react"

type DynamicOptions = {
  ssr?: boolean
  loading?: () => ReactNode
}
type DynamicComponentModule = {
  default: ComponentType<Record<string, unknown>>
}

/**
 * 只实现本项目需要的那点能力：客户端懒加载 + 可选的加载占位。
 *
 * 官方组件里的 `next/dynamic` 只用到「延迟加载一个组件」，
 * 本项目是纯客户端 React，没有 SSR 阶段，所以这里不实现也不承诺
 * Next 的 ssr / loading 语义（`ssr` 参数被忽略）。它只替代宿主环境缺的
 * 那一个能力，不是 next/dynamic 的等价实现。
 *
 * 官方组件源码不做任何改动，适配只发生在宿主侧：由 vite / vitest /
 * tsconfig 的别名把 `next/dynamic` 指到这里。
 */
const dynamic = (loader: () => Promise<unknown>, options?: DynamicOptions) => {
  const LazyComponent = lazy(loader as () => Promise<DynamicComponentModule>)
  const DynamicComponent = (props: Record<string, unknown>) =>
    createElement(
      Suspense,
      { fallback: options?.loading ? options.loading() : null },
      createElement(LazyComponent, props)
    )
  return DynamicComponent
}

export default dynamic
