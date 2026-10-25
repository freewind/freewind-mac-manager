import { SAMPLE_CLASH_CONFIG } from "./clash-config-sample"
import { YamlHighlight } from "./yaml-highlight"

/**
 * 配置详细：一份带中文注释的示例配置，用来说明各选项的含义。
 *
 * 内容取自仓库里的常量，不读磁盘、不发请求，所以打开即用；
 * 高亮交给 worker 计算，不会阻塞滚动与切页。
 */
export const ConfigDetailPanel = () => (
  <section className="space-y-3" aria-label="配置详细">
    <div>
      <h2 className="text-sm font-medium">配置详细</h2>
      <p className="text-xs text-muted-foreground">
        一份字段尽量全、值尽量小的示例配置，每个选项都写了中文注释：作用、取值与常见坑。
        它只用来读懂配置，不参与你机器的实际运行；真正生效的是订阅文件与合并生成的
        freewind-merged.yaml
      </p>
    </div>
    <YamlHighlight content={SAMPLE_CLASH_CONFIG} fileName="clash-config.yaml" />
  </section>
)
