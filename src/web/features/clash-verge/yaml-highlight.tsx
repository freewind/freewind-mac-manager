import { File, WorkerPoolContextProvider } from "@pierre/diffs/react"
import { useThemeType } from "@web/hooks/use-theme-type"
import { LoaderCircle } from "lucide-react"
import { Component, type ReactNode, Suspense } from "react"

/** 纯文本展示：高亮不可用、或还没算出来时用它，保证内容总能读。 */
export const PlainYaml = (props: { content: string }) => (
  <pre className="max-h-[70vh] w-full min-w-0 overflow-auto rounded-md border p-2 text-xs">
    {props.content}
  </pre>
)

/**
 * File 高亮会挂起（语法包异步加载）也可能直接抛错，两层都兜住：
 * Suspense 接住挂起，ErrorBoundary 接住异常，两者都回退到纯文本，不会变空白。
 */
class HighlightBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * 高亮放 worker 里算，主线程只管渲染：几十万字符的配置也不会把界面堵死。
 * worker 起不来时库会自己退回主线程，外面还有纯文本兜底。
 */
const HighlightPool = (props: { children: ReactNode }) => (
  <WorkerPoolContextProvider
    poolOptions={{
      workerFactory: () =>
        new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
          type: "module",
        }),
      poolSize: 2,
    }}
    highlighterOptions={{ langs: ["yaml"] }}
  >
    {props.children}
  </WorkerPoolContextProvider>
)

/**
 * YAML 高亮：挂载即可用，高亮没算完时先显示原文与旋转提示。
 *
 * 调用方想控制「默认不占 CPU」就自己决定何时渲染它，
 * 比如配置文件弹窗默认显示 PlainYaml，点了按钮才切成高亮。
 */
export const YamlHighlight = (props: { content: string; fileName: string }) => {
  const themeType = useThemeType()
  return (
    <div className="min-w-0">
      <HighlightBoundary fallback={<PlainYaml content={props.content} />}>
        <HighlightPool>
          <Suspense
            fallback={
              <div className="min-w-0 space-y-1">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <LoaderCircle
                    className="size-3 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  正在添加语法高亮…
                </p>
                <PlainYaml content={props.content} />
              </div>
            }
          >
            <div className="max-h-[70vh] min-w-0 overflow-auto rounded-md border text-xs">
              <File
                key={themeType}
                file={{ name: props.fileName, contents: props.content }}
                options={{
                  theme: { dark: "github-dark", light: "github-light" },
                  themeType,
                  disableFileHeader: true,
                }}
              />
            </div>
          </Suspense>
        </HighlightPool>
      </HighlightBoundary>
    </div>
  )
}
