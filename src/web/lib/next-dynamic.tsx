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
 * 本应用是 Vite 而不是 Next：装进来的官方组件里有一处 `next/dynamic`，
 * 这里按它的公开语义（懒加载、跳过 SSR）给一个等价实现，
 * 由 vite / vitest / tsconfig 的别名把 `next/dynamic` 指到这里。
 *
 * 这样做是为了不改动官方组件源码（项目实验约束），只在宿主环境侧补齐。
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
