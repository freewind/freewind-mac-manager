# TODO — 待整改与待建设清单

以 [AGENTS.md](./AGENTS.md) 为准；本文件记录未完成事项，不是实现现状说明。每条落实前核对代码与影响面，按可独立验证的任务实施、提交与推送，验收后删除对应项。

不再把目录深度、固定五件套、每组件一个目录、handler 必须单文件或职责文件名不同视为偏差。以下条目需要业务改动，本次规范更新没有完成它们。

## 一、优先建立验证与安全边界

- [ ] **登录与后端鉴权**（AGENTS 5.3）：建设登录页与服务端会话，覆盖敏感 JSON API、文件上传、下载等独立端点；包含密码哈希、会话过期与撤销、CSRF 防护、登录限流。统一客户端 401 处理，退出或失效后清除敏感缓存、停止相关查询与动作；补未登录、过期、退出后不可访问的测试。
- [ ] **危险操作和 IO 边界审查**（AGENTS 5.1、5.4）：逐域审查文件删除/覆盖、杀进程、服务重启和配置写入。验证范围、符号链接、目标变化、命令参数、请求大小和超时；明确危险确认、重复提交保护与批量部分失败结果，避免把所有失败视为同一异常。

## 二、契约、后端与存储一致性

- [ ] **状态码、动词与动作响应**（AGENTS 四）：核对 routes、schemas、handler、client-api 四层。200 表示完成，201 表示已创建，202 仅表示未完成且有状态查询途径，204 无正文；错误按 400/401/403/404/409/429/500 的实际语义声明。消息型动作用 `ActionResponseSchema` 替换 `OkResponse { ok: true }`，资源/任务/批量结果保留强类型响应，不统一强改为 202 或 message。
- [ ] **公共 schema 归位**（AGENTS 4.1）：`ApiErrorSchema`、`ActionResponseSchema` 当前在 `schemas/disk-growth.ts`，`KillProcesses*` 在 `schemas/traffic.ts` 且被跨域引用；迁到 `schemas/common.ts` 并更新调用方，消除其他域对业务 schema 的寄生依赖。
- [ ] **统一 SQLite，保留历史数据**（AGENTS 5.2）：traffic 当前自行拼接 `traffic.sqlite3`，disk-growth 使用 `snapshots.sqlite3`；改为统一 `env.DATABASE_FILE`，核对 WAL、事务与表名边界。实施前制定已有 traffic 数据迁移及失败回滚方式，验证迁移后历史记录可读；不能只更换路径让旧数据消失。
- [ ] **后端出口命名与 health 归属**（AGENTS 5.1）：disk-growth 的 `serverRouter` 改为 `diskGrowthRouter`，health 契约与 handler 独立归属。允许 ports 的类型化常量和 disk-growth 的端点拆分，不为写法一致合并所有 handler。
- [ ] **统一应用接线顺序**（AGENTS 3.1、5.1）：明确公共中间件、公开端点、鉴权与各域挂载顺序，各域按稳定顺序注册，`app.ts` 只做接线。`registerUploadEndpoint` 实际属于 files，不是 FRP；保留非 JSON 上传例外，但必须处于同一鉴权和边界校验之下。
- [ ] **API 路径可读键**（AGENTS 4.1）：`api-path/index.ts` 当前键和值重复计算完整路径；改为清楚的语义键并更新引用，保持路径只定义一处，不为删除计算键而再复制路径字符串。

## 三、前端调用与反馈

- [ ] **统一解包**（AGENTS 六）：核对各 `client-api` 中复制的 `unwrap`，提取到 `client-api/client.ts` 并迁移全部调用；覆盖成功、业务错误、非 JSON 响应和网络异常，避免丢失状态信息。
- [ ] **统一错误呈现边界**（AGENTS 六）：各入口 hook 重复的 `error instanceof Error ? ... : String(error)` 提取成通用转换；与客户端解包、后端脱敏错误协同，不能把内部异常细节直接交给用户。
- [ ] **按用途整改通知**（AGENTS 六）：ports、traffic、disk-growth、system-services 的短暂 `notice` + Alert 操作反馈改为 sonner；持续加载错误、离线、表单校验留在对应区域，不把所有 Alert 和业务状态都删除。
- [ ] **本地 store 命名与内容**（AGENTS 六）：核对 `useDiskGrowthStore`、`useDashboardStore`；保留必要共享本地状态时改为 `useDiskGrowthLocalStore`、`useDashboardLocalStore` 并迁移引用，不因命名要求新建空 store。
- [ ] **FRP 入口 hook 命名**（AGENTS 六）：`useFrpPage` 改为 `useFrp`，同步文件名和引用，不扩展为其他无关结构重构。
- [ ] **查询键与公共类型入口**（AGENTS 3.2、六）：disk-growth 私有 `KEYS` 改为导出 `diskGrowthKeys`，核对参数与失效范围；该域从 `@shared/api-contract/types` 的深引用收回公共类型入口，不机械增加其他 barrel。

## 四、手机默认与 PWA

- [ ] **集中响应式与手机操作路径**（AGENTS 8.1）：逐域审查散落的 `sm/lg/xl` 和桌面缩小布局；将真正的结构/交互差异收进布局或数据展示组件，默认采用 md，其他内容门槛有依据才保留。统一业务 `useIsDesktop` 与 CSS 断点来源，不改官方 `use-mobile.ts` 和 sidebar，不要求每页使用 JS。验证 320px 无页面级横向溢出、触控热区、键盘输入、点按详情入口及安全区；手势仅用官方已支持能力，能力不足记录限制。
- [ ] **URL 导航与返回行为**（AGENTS 六、8.2）：当前页面切换只用组件 state；建立可刷新和恢复的 URL/历史导航及可见返回入口。窄屏 Sheet/Dialog 等浮层接入统一返回管理，返回先关闭浮层，反复开关不堆积历史；不能复制手写多套历史处理。
- [ ] **PWA 安装、静态壳与更新**（AGENTS 8.2）：接入 manifest、图标、standalone 形态及 Service Worker；只缓存版本化静态壳，敏感 API、会话和文件不离线缓存，写操作不排队重放。提供离线提示和受控更新，退出清理敏感数据，编辑与执行期间不强制刷新。真实安装与浏览器验证另经明确授权，不以配置文件存在代替验收。
- [ ] **弱网、恢复与后台任务**（AGENTS 5.4、六、8.2）：区分失败与结果未知，核对 mutation 重试、并发提交及长任务查询。页面关闭不丢失后端执行状态；恢复前台核实会话、数据时间和任务结果，旧数据明确标识，禁止乐观误报危险动作成功。

## 五、工具链迁移与提交检查

- [ ] **Biome 替代 ESLint + Prettier**（AGENTS 二、九）：接入官方 recommended 配置与适用团队规则，提供只读 `lint` 和安全修复 `lint:fix`；覆盖手写源码、脚本、测试与配置。移除旧依赖、配置和 Prettier 命令，不保留并行格式化器；Markdown/YAML 不交给 Biome。迁移时处理实际诊断，不关闭手写代码的推荐规则，也不能声称 Biome 自动替代所有 ESLint 能力。
- [ ] **TypeScript 7 与统一类型检查脚本**（AGENTS 二、九）：将当前 TypeScript 6 升级到实施时最新的 7.x 稳定版，锁文件固定；保留 `typecheck: tsc --noEmit`，`build` 调用 `pnpm typecheck`。核实 ts-rest、OpenAPI 生成、Vite、Vitest 及编译器 API 使用者的兼容性，运行真实类型检查与构建，不假设所有旧 API 都兼容。
- [ ] **每次提交检查暂存代码**（AGENTS 九）：接入 Husky + lint-staged，`prepare` 自动安装钩子；提交前对受支持的暂存手写文件运行同一 Biome 检查，有错误阻止提交，不自动修复。验证嵌套文件、部分暂存、文件名空格、纯文档提交与无匹配文件场景，不读取未暂存内容、不改 shadcn、不依赖跳过钩子完成迁移。
- [ ] **官方代码检查边界与存量 lint 冲突**（AGENTS 七、九）：迁移前 ESLint 在官方 `web/hooks/use-mobile.ts` 同步 `setState` 处报 `react-hooks/set-state-in-effect`；迁移后以实际 Biome 诊断重新验证。明确只针对官方源码的排除范围，不修改官方 hook、不用行内禁用、不放宽手写代码规则；原错误不能仅靠删除记录就宣称修复。
- [ ] **保护 shadcn 源码免于自动改写**（AGENTS 七、九）：当前 `pnpm format` 覆盖全部源码；在 Biome 配置、`lint:fix` 和提交检查中统一排除官方 UI、官方 hook 与生成物，移除旧 Prettier 格式化链路。检查组件添加不会覆盖已有文件；不改源码、不复制改造组件、不用内部补丁规避约束。
