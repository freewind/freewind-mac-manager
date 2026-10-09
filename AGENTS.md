# AGENTS.md — freewind-mac-manager 开发规范

本文档是本项目的唯一开发标准。任何 AI 或人修改本项目前先读这里，所有约定与本文冲突时以本文为准。

## 一、项目定位

Mac 多功能控制面板（工具网站）：把散落在命令行里的 Mac 系统信息（流量、磁盘、进程、端口、服务等）收进一个网页，便于在电脑上查看与操作，也便于人在外面用手机查看和快速操作。

- 每个功能是一个**独立页面**，互不耦合。
- 页面之间**共用**：技术架构、契约层、client-api、后端基础设施、UI 组件与工具函数。
- 新功能按「契约 → client-api → 后端 handler → 前端 feature」的既有套路接入，禁止另起一套。

## 二、技术栈（固定，不得替换）

- 前端：React 19 + Vite 8 + TypeScript（strict）
- 契约：ts-rest（`@ts-rest/core` / `@ts-rest/express`），zod 定义 schema
- 数据库：`node:sqlite`（内置，无第三方驱动）
- UI：shadcn（style `base-mira`，紧凑风格，适合手机）+ Tailwind CSS 4，图标 hugeicons
- 远程状态：TanStack Query；页面共享状态：Zustand；组件内部状态：`useState`
- 后端：Express 5，dev 与生产共用 `createApp()`

## 三、目录结构与职责

```
src/
  shared/            # 前后端共用
    api-path/        # 路径唯一来源：API_BASE + ApiPath
    api-contract/    # 契约：contract.ts 汇总，routes/ 与 schemas/ 按域拆分
    client-api/      # 前端唯一 HTTP 出口，按域拆文件，index.ts 汇总导出
    format.ts        # 通用格式化（formatBytes 等）
  server/            # 后端，按域一目录
    <域>/handlers.ts # 本域路由实现（见 4.4）
    common/          # 跨域后端工具（kill、collect、file-actions）
    app.ts           # 注册所有域的 endpoints
    env.ts           # 端口、目录、数据库路径等唯一定义处
  web/
    components/ui/   # shadcn 组件，禁止手写改造其内部
    components/app-sidebar/  # 全局侧边栏（功能菜单唯一清单）
    features/<域>/   # 每域一套文件，见 4.5
```

模块路径别名固定：`@web` `@server` `@shared`（tsconfig 与 vite alias 一致，勿加第四种）。

## 四、硬规范

### 4.1 契约（契约即接口）

1. 新端点在 `shared/api-contract/routes/<域>.ts` 定义，schema 在 `schemas/<域>.ts`。
2. **路径只写一处**：先加到 `shared/api-path/index.ts` 的 `ApiPath`，routes 里用 `toContractPath(ApiPath[...])` 引用，禁止在 routes 里写字符串路径。
3. `contract.ts` 只做汇总拼接；`app.ts` 只做挂载；业务路由归属各域 handler。
4. 每个端点的 `responses` 必须带 `400/500` 错误响应（`errorResponses` 展开），需要 403 的域另加。

### 4.2 状态码规则（统一后）

- 读操作成功：`200`
- 创建资源：`201`
- 异步/有后续副作用的动作：`202`
- 客户端入参错误：`400`；需要 root：`403`；服务端内部错误：`500`
- 动作类响应体统一 `{ message: string }`（`ActionResponseSchema`），不用 `{ ok: true }`

### 4.3 SQLite

- **单库**：只用 `env.ts` 导出的 `DATABASE_FILE`，禁止各域自拼 `.sqlite3` 路径。
- 各域在自己 store 类里 `CREATE TABLE IF NOT EXISTS` 自建表，表名带域前缀（如 `traffic_samples`）。
- 打开库时统一 `PRAGMA journal_mode=WAL` + `PRAGMA synchronous=NORMAL`；批量写用 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` 包裹。

### 4.4 后端 handler

- 每域一个 `server/<域>/handlers.ts`，导出 `<域>Contract` + `<域>Router`（`s.router(...)`）。
- handler 内 `try/catch`，按 4.2 返回对应状态码，错误文案 `error instanceof Error ? error.message : String(error)`。
- 跨域能力放 `server/common/`，禁止复制粘贴。

### 4.5 前端 feature 结构（每域固定五个文件）

```
features/<域>/
  store.ts      # Zustand：命名统一 use<域>LocalStore，只放跨组件本地状态
  queries.ts    # TanStack Query：导出 query key 常量 <域>Keys，导出 useXxx hook
  use<域>.ts    # 数据入口 hook，命名统一 use<域>（不用 use<域>Page）
  <域>Page/     # 页面组件（PascalCase 目录 + index.ts）
  其余：domain/labels/actions 等纯函数、常量、类型文件
```

- **query key**：一律 `export const <域>Keys = { ... } as const`，禁止私有 `KEYS`。
- **HTTP**：queryFn/mutationFn 只调 `@shared/client-api`，禁止组件直接 `fetch`/碰 contract。
- **`unwrap` 只有一份**：放 `client-api/client.ts` 导出，各域导入，禁止再复制。
- **远程数据永远走 TanStack Query**，不进 Zustand，不在组件里 `useEffect` 拉数。
- **新增功能必须有真实后端**：禁止 `mock-data.ts`、禁止 demo 回退（历史 mock 已全部删除，勿回头）。

### 4.6 通知

- 统一用 sonner `toast.success/error/info`（`use<域>.ts` 里调用）。
- 禁止自造 `notice` 状态 + 页内 Alert 展示（历史实现待整改，见 `TODO.md`）。

### 4.7 响应式：只有 768（md）一条线

- 断点只用 Tailwind 默认 `md`（768px）二分：`<768 = 手机`，`≥768 = 桌面`，两套布局直接切换，不做渐进式。
- 禁止页面里使用 `sm:`/`lg:`/`xl:`/`2xl:` 断点（对话框宽度等 shadcn 默认类除外）。
- 桌面/手机需要 JS 判断时用 `useIsMobile()`（`hooks/use-mobile.ts`，同 768）。
- 手机端遵循移动端实践：详情用 Sheet/侧边抽屉、优先支持滑动操作、点击目标 ≥44px。
- shadcn 组件内部（如 sidebar 的 `md:`）不动。

### 4.8 UI 组件

- 优先用 `components/ui/` 已有 shadcn 组件与默认变体；缺组件用 `pnpm dlx shadcn add` 添加，**不手写、不改其内部**。
- 弹层选择：危险操作确认用 `AlertDialog`，编辑/填表用 `Dialog`，移动端详情用 `Sheet`。
- 图标用 hugeicons（`@hugeicons/core-free-icons`），不混用其他图标库。
- 组件内小状态用 `useState`；表格排序、弹窗开关等单组件状态留组件内，不进 store。

### 4.9 代码风格

- 导出一律 `export const xxx = ...` / `export const Xxx = () => ...`（除 shadcn 生成的组件）。
- 格式化交给 Prettier（无分号、双引号、2 空格、printWidth 80），改动后跑 `pnpm format`。
- 中文注释解释「为什么」，不写「是什么」的废话注释。
- 禁止 `console.log` 上生产路径（后端启动日志用 `main.ts`/`env` 约定的 `[mac-manager]` 前缀）、禁止 `any`/`ts-ignore`/`eslint-disable`。

### 4.10 常用命令

```bash
pnpm dev        # 生成 openapi + vite dev（端口 51510，固定，被占用即失败）
pnpm build      # typecheck + vite build + SSR 构建
pnpm typecheck  # tsc --noEmit
pnpm lint       # eslint
pnpm format     # prettier 格式化 src
```

提交前至少跑 `pnpm typecheck` + `pnpm lint`。一个任务一个 commit，信息中文。

## 五、新功能接入 checklist

1. `shared/api-path/index.ts` 加路径
2. `shared/api-contract/schemas/<域>.ts` 写 schema，`routes/<域>.ts` 写路由
3. `contract.ts` 汇总；`client-api/<域>.ts` 写调用（复用 `unwrap`），`client-api/index.ts` 导出
4. `server/<域>/handlers.ts` 实现（数据存取经自己的 store，库用 `env.DATABASE_FILE`），`app.ts` 挂载
5. `web/features/<域>/` 建 store/queries/use<域>/<域>Page 五件套
6. `AppSidebar.tsx` 加菜单项 + `App.tsx` 加挂载
7. `pnpm typecheck && pnpm lint` 通过后提交
